import { describe, it, expect, afterEach } from 'vitest';
import { createNetplayServer } from '.';
import { createNetplayClient } from '../NetplayClient';
import { NetplayConnection } from '../NetplayConnection';
import { buildNickCommand, buildInfoCommand, buildPlayCommand, buildInputCommand } from '../protocol';
import { NetplayCmd, isKnownCommand, type ParsedCommand } from '..';

const TEST_PORT = 42873;
const PUMP_INTERVAL_MS = 5;
const SYNC_TIMEOUT_MS = 5000;

// Encode a frame number as a distinguishable 4-byte "core state"
const stateForFrame = (frame: number): Buffer => {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(frame, 0);
  return buf;
};

/**
 * A minimal client that enforces RetroArch's frame invariants and records
 * every violation instead of disconnecting:
 * - The tracked server frame is set by SYNC and advanced ONLY by receiving
 *   the server's INPUT/NOINPUT for exactly that frame (consecutive stream).
 * - Server INPUT for a later frame than expected is a violation (RA NAKs).
 * - MODE (you+playing) frame must equal the tracked server frame (RA NAKs).
 * - LOAD_SAVESTATE frame must equal the tracked server frame (RA NAKs).
 */
class StrictProtocolClient {
  violations: string[] = [];
  serverFrame = -1; // RA server_frame_count: the next expected server frame
  modeFrame: number | null = null;
  loadFrame: number | null = null;
  resetFrame: number | null = null;
  stallFrames: number | null = null;
  syncDevices: number[] = [];
  private connection = new NetplayConnection();
  private playSent = false;

  constructor(private readonly playDelayMs: number) {}

  async join(port: number): Promise<void> {
    this.connection.on('command', (cmd: ParsedCommand) => this.handle(cmd));
    await this.connection.connect('127.0.0.1', port);
    this.connection.sendHeader('Strict');
    const header = await this.connection.waitForHeader();
    if (!header) {
      throw new Error('no server header');
    }
    this.connection.send(buildNickCommand('Strict'));
    this.connection.send(buildInfoCommand('testcore', '1.0', 0x1234));
  }

  private handle(cmd: ParsedCommand): void {
    if (!isKnownCommand(cmd)) {
      return;
    }
    switch (cmd.cmd) {
      case NetplayCmd.SYNC:
        this.serverFrame = cmd.frameNumber;
        this.syncDevices = cmd.devices;
        // A real player may open menus etc. before requesting to play;
        // the server input stream must flow regardless
        setTimeout(() => {
          if (!this.playSent) {
            this.playSent = true;
            this.connection.send(buildPlayCommand());
          }
        }, this.playDelayMs);
        break;

      case NetplayCmd.INPUT:
        if (cmd.clientId !== 0) {
          break; // only the server's own input advances the server frame
        }
        // RetroArch sizes INPUT by the sender's declared device: an ANALOG
        // device is exactly 3 words (joypad + 2 sticks); a mismatch is a NAK
        if (this.syncDevices[0] === 5 && cmd.analogLeft === undefined) {
          this.violations.push(`server INPUT for frame ${cmd.frameNumber} missing analog words for ANALOG device`);
        }
        if (cmd.frameNumber > this.serverFrame) {
          this.violations.push(
            `server INPUT for frame ${cmd.frameNumber}, expected ${this.serverFrame}`
          );
          this.serverFrame = cmd.frameNumber + 1; // resync to keep reporting useful
        } else if (cmd.frameNumber === this.serverFrame) {
          this.serverFrame++;
        } // older frames are ignored, per RetroArch
        break;

      case NetplayCmd.NOINPUT:
        if (cmd.frameNumber === this.serverFrame) {
          this.serverFrame++;
        }
        break;

      case NetplayCmd.MODE:
        if (cmd.you && cmd.playing) {
          if (cmd.frameNumber !== this.serverFrame) {
            this.violations.push(
              `MODE join frame ${cmd.frameNumber}, expected ${this.serverFrame}`
            );
          }
          this.modeFrame = cmd.frameNumber;
        }
        break;

      case NetplayCmd.STALL:
        this.stallFrames = cmd.frames;
        break;

      case NetplayCmd.RESET:
        // RetroArch NAKs a RESET whose frame is not its tracked server frame
        if (cmd.frameNumber !== this.serverFrame) {
          this.violations.push(
            `RESET frame ${cmd.frameNumber}, expected ${this.serverFrame}`
          );
        }
        this.resetFrame = cmd.frameNumber;
        break;

      case NetplayCmd.LOAD_SAVESTATE:
        if (cmd.frameNumber !== this.serverFrame) {
          this.violations.push(
            `LOAD_SAVESTATE frame ${cmd.frameNumber}, expected ${this.serverFrame}`
          );
        }
        this.loadFrame = cmd.frameNumber;
        break;
    }
  }

  sendInput(frame: number, joypad: number): void {
    this.connection.send(buildInputCommand(frame, 1, false, joypad, 1, 0, 0));
  }

  async waitForJoin(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (this.modeFrame === null || this.loadFrame === null) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `join incomplete: mode=${this.modeFrame} load=${this.loadFrame} violations=[${this.violations.join('; ')}]`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  disconnect(): void {
    this.connection.close();
  }
}

describe('NetplayServer <-> NetplayClient state sync', () => {
  let cleanup: Array<() => void> = [];

  afterEach(() => {
    for (const fn of cleanup) {
      fn();
    }
    cleanup = [];
  });

  it('satisfies RetroArch frame invariants during join', async () => {
    const server = createNetplayServer({
      port: TEST_PORT + 3,
      nickname: 'Host',
      maxClients: 2,
      inputDelayFrames: 0,
      requirePassword: false,
      password: '',
    });
    server.setCoreInfo('testcore', '1.0', 0x1234);
    await server.start();
    cleanup.push(() => server.stop());

    const pump = setInterval(() => {
      const pre = server.preFrame([0, 0, 0]);
      if (pre !== null && !pre.shouldStall) {
        server.postFrame(stateForFrame(server.getSyncManager().selfFrame));
      }
    }, PUMP_INTERVAL_MS);
    cleanup.push(() => clearInterval(pump));

    // Delay PLAY so several server frames elapse pre-join: the input
    // stream must flow to synced-but-not-yet-playing clients too
    const strict = new StrictProtocolClient(50);
    cleanup.push(() => strict.disconnect());
    await strict.join(TEST_PORT + 3);
    await strict.waitForJoin(SYNC_TIMEOUT_MS);

    // Observe a stretch of post-join input stream as well
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(strict.violations).toEqual([]);
    // Ports are declared as ANALOG devices so sticks can sync
    expect(strict.syncDevices[0]).toBe(5); // RETRO_DEVICE_ANALOG
  });

  it('broadcasts RESET at the frame boundary when the host resets', async () => {
    const server = createNetplayServer({
      port: TEST_PORT + 6,
      nickname: 'Host',
      maxClients: 2,
      inputDelayFrames: 0,
      requirePassword: false,
      password: '',
    });
    server.setCoreInfo('testcore', '1.0', 0x1234);
    await server.start();
    cleanup.push(() => server.stop());

    const pump = setInterval(() => {
      const pre = server.preFrame([0, 0, 0]);
      if (pre !== null && !pre.shouldStall) {
        server.postFrame(stateForFrame(server.getSyncManager().selfFrame));
      }
    }, PUMP_INTERVAL_MS);
    cleanup.push(() => clearInterval(pump));

    const strict = new StrictProtocolClient(0);
    cleanup.push(() => strict.disconnect());
    await strict.join(TEST_PORT + 6);
    await strict.waitForJoin(SYNC_TIMEOUT_MS);

    const serverReset = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server reset event missing')), SYNC_TIMEOUT_MS);
      server.on('reset', (frame: number) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });

    server.requestReset();
    const localResetFrame = await serverReset;

    // Wait for the client to observe the RESET
    const deadline = Date.now() + SYNC_TIMEOUT_MS;
    while (strict.resetFrame === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(strict.violations).toEqual([]);
    expect(strict.resetFrame).not.toBeNull();
    // Host and clients reset at the same frame
    expect(strict.resetFrame).toBe(localResetFrame);
  });

  it('stalls clients that run too far ahead of the server', async () => {
    const server = createNetplayServer({
      port: TEST_PORT + 7,
      nickname: 'Host',
      maxClients: 2,
      inputDelayFrames: 0,
      requirePassword: false,
      password: '',
    });
    server.setCoreInfo('testcore', '1.0', 0x1234);
    await server.start();
    cleanup.push(() => server.stop());

    // Slow server: ~1 frame per 40ms, so a fast client runs ahead easily
    const pump = setInterval(() => {
      const pre = server.preFrame([0, 0, 0]);
      if (pre !== null && !pre.shouldStall) {
        server.postFrame(stateForFrame(server.getSyncManager().selfFrame));
      }
    }, 40);
    cleanup.push(() => clearInterval(pump));

    const strict = new StrictProtocolClient(0);
    cleanup.push(() => strict.disconnect());
    await strict.join(TEST_PORT + 7);
    await strict.waitForJoin(SYNC_TIMEOUT_MS);

    // Race ahead of the server by many frames
    const start = strict.modeFrame!;
    for (let f = start; f < start + 30; f++) {
      strict.sendInput(f, 0);
    }

    const deadline = Date.now() + SYNC_TIMEOUT_MS;
    while (strict.stallFrames === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(strict.stallFrames).not.toBeNull();
    expect(strict.stallFrames!).toBeGreaterThan(0);
  });

  it('measures round-trip latency with active pings', async () => {
    const server = createNetplayServer({
      port: TEST_PORT + 8,
      nickname: 'Host',
      maxClients: 2,
      inputDelayFrames: 0,
      requirePassword: false,
      password: '',
    });
    server.setCoreInfo('testcore', '1.0', 0x1234);
    await server.start();
    cleanup.push(() => server.stop());

    const pump = setInterval(() => {
      const pre = server.preFrame([0, 0, 0]);
      if (pre !== null && !pre.shouldStall) {
        server.postFrame(stateForFrame(server.getSyncManager().selfFrame));
      }
    }, PUMP_INTERVAL_MS);
    cleanup.push(() => clearInterval(pump));

    const client = createNetplayClient({
      host: '127.0.0.1',
      port: TEST_PORT + 8,
      nickname: 'Player',
      password: '',
      inputDelayFrames: 0,
      spectate: false,
    });
    client.setCoreInfo('testcore', '1.0', 0x1234);
    cleanup.push(() => client.disconnect());
    await client.connect();

    // Both sides ping immediately after the handshake completes
    const deadline = Date.now() + SYNC_TIMEOUT_MS;
    const session = (): { latency: number | null } | undefined => [...server.sessions.values()][0];
    while (
      (typeof client.latency !== 'number' || typeof session()?.latency !== 'number') &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(typeof client.latency).toBe('number');
    expect(client.latency).toBeGreaterThanOrEqual(0);
    expect(typeof session()?.latency).toBe('number');
  });

  it('delivers the host battery RAM to joining clients via SYNC', async () => {
    const sram = Buffer.from('BATTERY-RAM-CONTENTS');
    const server = createNetplayServer({
      port: TEST_PORT + 5,
      nickname: 'Host',
      maxClients: 2,
      inputDelayFrames: 0,
      requirePassword: false,
      password: '',
    });
    server.setCoreInfo('testcore', '1.0', 0x1234);
    server.setSramProvider(() => sram);
    await server.start();
    cleanup.push(() => server.stop());

    const pump = setInterval(() => {
      const pre = server.preFrame([0, 0, 0]);
      if (pre !== null && !pre.shouldStall) {
        server.postFrame(stateForFrame(server.getSyncManager().selfFrame));
      }
    }, PUMP_INTERVAL_MS);
    cleanup.push(() => clearInterval(pump));

    const client = createNetplayClient({
      host: '127.0.0.1',
      port: TEST_PORT + 5,
      nickname: 'Player',
      password: '',
      inputDelayFrames: 0,
      spectate: false,
    });
    client.setCoreInfo('testcore', '1.0', 0x1234);
    cleanup.push(() => client.disconnect());

    const sramLoaded = new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no sram-load event')), SYNC_TIMEOUT_MS);
      client.on('sram-load', (data: Buffer) => {
        clearTimeout(timer);
        resolve(data);
      });
    });

    await client.connect();
    expect([...(await sramLoaded)]).toEqual([...sram]);
  });

  it('carries client analog input through to the server frame ring', async () => {
    const server = createNetplayServer({
      port: TEST_PORT + 4,
      nickname: 'Host',
      maxClients: 2,
      inputDelayFrames: 0,
      requirePassword: false,
      password: '',
    });
    server.setCoreInfo('testcore', '1.0', 0x1234);
    await server.start();
    cleanup.push(() => server.stop());

    const pump = setInterval(() => {
      const pre = server.preFrame([0, 0, 0]);
      if (pre !== null && !pre.shouldStall) {
        server.postFrame(stateForFrame(server.getSyncManager().selfFrame));
      }
    }, PUMP_INTERVAL_MS);
    cleanup.push(() => clearInterval(pump));

    const client = createNetplayClient({
      host: '127.0.0.1',
      port: TEST_PORT + 4,
      nickname: 'Player',
      password: '',
      inputDelayFrames: 0,
      spectate: false,
    });
    client.setCoreInfo('testcore', '1.0', 0x1234);
    cleanup.push(() => client.disconnect());
    await client.connect();

    // Drive client frames with stick input: [joypad, leftWord, rightWord]
    const LEFT_WORD = 0x40003000;
    const RIGHT_WORD = 0x00008111;
    const clientPump = setInterval(() => {
      const pre = client.preFrame([0x10, LEFT_WORD, RIGHT_WORD]);
      if (pre !== null && !pre.shouldStall) {
        client.postFrame(Buffer.from([1]));
      }
    }, PUMP_INTERVAL_MS);
    cleanup.push(() => clearInterval(clientPump));

    // Wait until the server's ring holds the client's analog words
    const ring = server.getSyncManager().getFrameBuffer();
    const deadline = Date.now() + SYNC_TIMEOUT_MS;
    let found = false;
    while (!found && Date.now() < deadline) {
      for (let f = ring.oldestFrame; f <= ring.newestFrame; f++) {
        const input = ring.getRemoteInput(f, 1);
        if (input && input[0] === 0x10 && input[1] === LEFT_WORD && input[2] === RIGHT_WORD) {
          found = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(found).toBe(true);
  });

  it('authenticates a client that presents the correct password', async () => {
    const server = createNetplayServer({
      port: TEST_PORT + 1,
      nickname: 'Host',
      maxClients: 2,
      inputDelayFrames: 0,
      requirePassword: true,
      password: 'hunter2',
    });
    server.setCoreInfo('testcore', '1.0', 0x1234);
    await server.start();
    cleanup.push(() => server.stop());

    const pump = setInterval(() => {
      const pre = server.preFrame([0, 0, 0]);
      if (pre !== null && !pre.shouldStall) {
        server.postFrame(stateForFrame(server.getSyncManager().selfFrame));
      }
    }, PUMP_INTERVAL_MS);
    cleanup.push(() => clearInterval(pump));

    const client = createNetplayClient({
      host: '127.0.0.1',
      port: TEST_PORT + 1,
      nickname: 'Player',
      password: 'hunter2',
      inputDelayFrames: 0,
      spectate: false,
    });
    client.setCoreInfo('testcore', '1.0', 0x1234);
    cleanup.push(() => client.disconnect());

    await expect(client.connect()).resolves.toBeUndefined();
    expect(client.connected).toBe(true);
  });

  it('rejects a client that presents the wrong password', async () => {
    const server = createNetplayServer({
      port: TEST_PORT + 2,
      nickname: 'Host',
      maxClients: 2,
      inputDelayFrames: 0,
      requirePassword: true,
      password: 'hunter2',
    });
    server.setCoreInfo('testcore', '1.0', 0x1234);
    await server.start();
    cleanup.push(() => server.stop());

    const client = createNetplayClient({
      host: '127.0.0.1',
      port: TEST_PORT + 2,
      nickname: 'Player',
      password: 'wrong',
      inputDelayFrames: 0,
      spectate: false,
    });
    client.setCoreInfo('testcore', '1.0', 0x1234);
    cleanup.push(() => client.disconnect());

    await expect(client.connect()).rejects.toThrow();
  });

  it('aligns the client frame ring with the server frame ring after joining', async () => {
    const server = createNetplayServer({
      port: TEST_PORT,
      nickname: 'Host',
      maxClients: 2,
      inputDelayFrames: 0,
      requirePassword: false,
      password: '',
    });
    server.setCoreInfo('testcore', '1.0', 0x1234);
    await server.start();
    cleanup.push(() => server.stop());

    // Pump server frames; each frame's "state" encodes the frame number it
    // was captured AFTER, exactly like a real post-frame serialize
    const pump = setInterval(() => {
      const pre = server.preFrame([0, 0, 0]);
      if (pre !== null && !pre.shouldStall) {
        server.postFrame(stateForFrame(server.getSyncManager().selfFrame));
      }
    }, PUMP_INTERVAL_MS);
    cleanup.push(() => clearInterval(pump));

    const client = createNetplayClient({
      host: '127.0.0.1',
      port: TEST_PORT,
      nickname: 'Player',
      password: '',
      inputDelayFrames: 0,
      spectate: false,
    });
    client.setCoreInfo('testcore', '1.0', 0x1234);
    cleanup.push(() => client.disconnect());

    const stateLoaded = new Promise<{ frameNumber: number; state: Buffer }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for LOAD_SAVESTATE')), SYNC_TIMEOUT_MS);
      client.on('state-load', (frameNumber, state) => {
        clearTimeout(timer);
        resolve({ frameNumber, state });
      });
    });

    await client.connect();
    const { state } = await stateLoaded;
    clearInterval(pump);

    // The state's content tells us which server frame it was captured after
    const capturedAfterFrame = state.readUInt32LE(0);

    // Invariant: both rings must agree — the state captured after server
    // frame N sits at frame N in the client's ring too, so CRC comparisons
    // at any shared frame number compare the same emulated moment
    const serverCrc = server.getSyncManager().getCrcForFrame(capturedAfterFrame);
    const clientCrc = client.getSyncManager().getCrcForFrame(capturedAfterFrame);
    expect(serverCrc).not.toBeNull();
    expect(clientCrc).toBe(serverCrc);

    // And the client's next frame to run is the one after the captured state
    expect(client.getSyncManager().selfFrame).toBe(capturedAfterFrame);
  });
});
