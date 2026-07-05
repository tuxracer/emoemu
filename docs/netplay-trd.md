# RetroArch Netplay Support - Technical Requirements Document

## Overview

This document outlines the implementation plan for adding RetroArch-compatible netplay support to emoemu. The implementation will allow emoemu to act as both a netplay server (host) and client, enabling multiplayer gaming over the network with other emoemu instances and potentially RetroArch clients.

**Scope**: Libretro cores only. Native NES core is explicitly excluded from netplay support.

## Implementation Status

| Milestone | Status | Description |
|-----------|--------|-------------|
| 1. Protocol Foundation | ✅ Complete | Protocol constants, command encoding/decoding, TCP connection wrapper |
| 2. Frame Buffer & State Management | ✅ Complete | CRC32, frame buffer ring, input buffer with prediction |
| 3. Sync Manager & Rollback | ✅ Complete | Rollback coordination, desync detection, input merging |
| 4. Server Implementation | ✅ Complete | NetplayServer class with handshake, input relay, client management |
| 5. Client Implementation | ✅ Complete | NetplayClient class with handshake, input exchange, rollback integration |
| 6. Emulator Integration | ✅ Complete | CLI arguments, status bar, notifications, ROM CRC validation |
| 7. Testing & Polish | ✅ Complete | 212 tests passing, documentation updated |
| 8. Documentation & Release | ✅ Complete | CLAUDE.md and README.md updated |

**Total Tests**: 212 passing (49 protocol + 57 frame buffer + 30 sync manager + 76 other)

## Background

### RetroArch Netplay Protocol

RetroArch's netplay uses a deterministic lockstep model with rollback:

- **Transport**: TCP on port 55435 (reliable, in-order delivery required)
- **Architecture**: Server is canonical for synchronization; supports up to 32 clients
- **Synchronization**: Input delay + rollback/replay when delayed input arrives
- **State Format**: Raw binary savestates from `retro_serialize()`

### Key Protocol Concepts

1. **Frame Buffer Ring**: Maintains history of frames with input and serialized state
2. **Three Frame Pointers**:
   - `self`: Current local execution frame
   - `other`: Last perfectly synchronized frame
   - `unread`: First frame with incomplete remote input
3. **Rollback**: When late input arrives, rewind to `other`, replay with correct input

### Command Protocol

Each command consists of:
- 32-bit command ID (network byte order)
- 32-bit payload size (network byte order)
- Variable payload

Key commands:
| Command | ID | Description |
|---------|-----|-------------|
| `INPUT` | 0x0003 | Per-frame input data (required every frame) |
| `NOINPUT` | 0x0004 | Server frame advance without input |
| `NICK` | 0x0020 | Nickname exchange |
| `PASSWORD` | 0x0021 | Authentication (SHA-256 hash) |
| `INFO` | 0x0022 | Core name, version, content CRC |
| `SYNC` | 0x0023 | Initial state synchronization |
| `MODE` | 0x0026 | Player mode changes (play/spectate) |
| `CRC` | 0x0040 | Frame hash for desync detection |
| `LOAD_SAVESTATE` | 0x0042 | State synchronization |
| `PAUSE` | 0x0043 | Pause notification |
| `RESUME` | 0x0044 | Resume notification |

## Requirements

### Functional Requirements

#### Server (Host) Mode
- FR-1: Accept incoming TCP connections on configurable port (default: 55435)
- FR-2: Perform handshake with clients (header, nick, password, info, sync)
- FR-3: Validate client compatibility (core name, core version, content CRC)
- FR-4: Send initial savestate to synchronize new clients
- FR-5: Relay input from all clients to all other clients
- FR-6: Periodically send CRC commands for desync detection
- FR-7: Handle client disconnection gracefully
- FR-8: Support optional password protection
- FR-9: Support spectator mode (receive state/input, no input sent)

#### Client Mode
- FR-10: Connect to server via hostname/IP and port
- FR-11: Perform handshake with server
- FR-12: Load initial savestate from server
- FR-13: Send local input every frame
- FR-14: Receive and apply remote input
- FR-15: Perform rollback/replay when input arrives late. The SyncManager emits `restore-state`/`run-frame` events; `netplay/rollbackReplay` wires them to the core (restore savestate, apply corrected input, re-run the frame, re-capture the state into the ring) with audio suppressed during replay. The Emulator connects this wiring for both host and client via `getSyncManager()`
- FR-16: Request savestate resync on desync detection
- FR-17: Support spectator mode

#### Input Handling
- FR-18: Buffer local input with configurable delay (0-16 frames)
- FR-19: Simulate remote input when not yet received (repeat last input)
- FR-20: Support all libretro input devices (joypad, analog)

#### State Management
- FR-21: Maintain ring buffer of recent frame states (configurable depth); each ring slot owns a pooled backing buffer that per-frame states are copied into (no per-frame allocation)
- FR-22: Serialize/deserialize state via libretro API; per-frame capture serializes into a reused scratch buffer (`Core.getStateInto`)
- FR-23: Compute CRC32 for desync comparison, lazily on first `getCrc()` (CRCs are only consumed every `crcCheckInterval` frames). The CRC hashes the core's system RAM (`RETRO_MEMORY_SYSTEM_RAM`) when exposed, falling back to the full serialized state: some cores (mGBA) normalize a few volatile audio/IO latch bytes on savestate load, so full-state CRCs falsely desync any peer that ever loaded a state. Note this basis differs from RetroArch's full-state CRC, so cross-frontend sessions may still log CRC warnings with such cores. The frame received via LOAD_SAVESTATE is never CRC-verified (its basis is unknown locally)
- FR-24: Support zlib compression for large state transfers

### Non-Functional Requirements

- NFR-1: Latency: Support playable experience up to 200ms RTT
- NFR-2: Memory: State buffer should not exceed 256MB for typical cores
- NFR-3: CPU: Rollback should complete within frame budget (16ms at 60fps)
- NFR-4: Compatibility: Wire-compatible with RetroArch netplay protocol

### Out of Scope

- Native NES core netplay support
- Lobby server integration (manual IP/hostname entry only)
- NAT traversal / hole punching
- Link-cable emulation (GB/GBA/PSP)
- Hardware-rendered cores (OpenGL/Vulkan)

## Architecture

### New Directory Structure

```
src/
├── netplay/
│   ├── index.ts              # Module exports
│   ├── consts.ts             # Protocol constants and command IDs
│   ├── types.ts              # TypeScript interfaces
│   ├── protocol.ts           # Command serialization/deserialization
│   ├── connection.ts         # TCP connection wrapper
│   ├── server.ts             # NetplayServer class
│   ├── client.ts             # NetplayClient class
│   ├── frame-buffer.ts       # Ring buffer for frame history
│   ├── input-buffer.ts       # Input state management
│   └── sync-manager.ts       # Rollback and replay logic
```

### Core Components

#### 1. Protocol Layer (`protocol.ts`)

Handles command encoding/decoding:

```typescript
interface NetplayCommand {
  cmd: NetplayCommandId;
  payload: Buffer;
}

// Serialize command to wire format
const encodeCommand = (cmd: NetplayCommand): Buffer => { ... };

// Parse command from buffer (handles partial reads)
const decodeCommand = (buffer: Buffer): { command: NetplayCommand; bytesConsumed: number } | null => { ... };

// Specific command builders
const buildInputCommand = (frame: number, clientId: number, input: Uint32Array): Buffer => { ... };
const buildInfoCommand = (coreName: string, coreVersion: string, contentCrc: number): Buffer => { ... };
const buildSyncCommand = (frame: number, state: Buffer, players: number): Buffer => { ... };
// ... etc
```

#### 2. Connection Manager (`connection.ts`)

Wraps TCP socket with buffered reads:

```typescript
interface NetplayConnection {
  readonly id: number;
  readonly address: string;
  readonly port: number;

  send(command: NetplayCommand): Promise<void>;
  receive(): AsyncGenerator<NetplayCommand>;
  close(): void;

  // Connection state
  nickname: string;
  clientNumber: number;
  mode: 'playing' | 'spectating';
  latency: number;
}
```

#### 3. Frame Buffer (`frame-buffer.ts`)

Ring buffer storing frame history for rollback:

```typescript
interface FrameState {
  frameNumber: number;
  serializedState: Buffer | null;  // May be null if not yet captured
  localInput: Uint32Array;
  remoteInput: Map<number, Uint32Array>;  // clientId -> input
  crc: number | null;
}

interface FrameBuffer {
  readonly capacity: number;

  // Access frames
  get(frameNumber: number): FrameState | null;
  getCurrent(): FrameState;

  // Frame management
  advance(): FrameState;  // Move to next frame
  setLocalInput(input: Uint32Array): void;
  setRemoteInput(clientId: number, frameNumber: number, input: Uint32Array): void;
  setState(frameNumber: number, state: Buffer): void;

  // Rollback support
  findRollbackFrame(): number;  // Earliest frame needing replay
  getStateForFrame(frameNumber: number): Buffer | null;
}
```

#### 4. Sync Manager (`sync-manager.ts`)

Coordinates rollback and replay:

```typescript
interface SyncManager {
  // Frame tracking
  readonly selfFrame: number;
  readonly otherFrame: number;  // Last synced frame
  readonly unreadFrame: number;  // First frame with missing input

  // State management
  captureState(): void;  // Serialize current core state
  restoreState(frameNumber: number): void;  // Load state for rollback

  // Sync operations
  needsRollback(): boolean;
  performRollback(): void;  // Rewind and replay

  // Input
  getInputForFrame(frameNumber: number, port: number): Uint32Array;
  simulateInput(lastKnown: Uint32Array): Uint32Array;  // Predict input

  // Desync detection
  computeFrameCrc(frameNumber: number): number;
  checkDesync(remoteCrc: number, frameNumber: number): boolean;
}
```

#### 5. Server (`server.ts`)

```typescript
interface NetplayServerOptions {
  port: number;
  password?: string;
  maxClients: number;
  inputLatencyFrames: number;
}

interface NetplayServer {
  // Lifecycle
  start(core: LibretroCore, romPath: string): Promise<void>;
  stop(): void;

  // Client management
  readonly clients: ReadonlyMap<number, NetplayConnection>;
  kick(clientId: number, reason: string): void;

  // Frame execution (called by emulator loop)
  preFrame(): void;   // Gather input, check for new connections
  postFrame(): void;  // Broadcast input, check sync

  // Events
  on(event: 'client-connected', handler: (client: NetplayConnection) => void): void;
  on(event: 'client-disconnected', handler: (client: NetplayConnection) => void): void;
  on(event: 'desync', handler: (clientId: number, frame: number) => void): void;
}
```

#### 6. Client (`client.ts`)

```typescript
interface NetplayClientOptions {
  host: string;
  port: number;
  password?: string;
  nickname: string;
  inputLatencyFrames: number;
}

interface NetplayClient {
  // Lifecycle
  connect(core: LibretroCore): Promise<void>;
  disconnect(): void;

  // State
  readonly connected: boolean;
  readonly serverInfo: { coreName: string; coreVersion: string; contentCrc: number } | null;

  // Frame execution
  preFrame(): void;   // Send input, receive remote input
  postFrame(): void;  // Handle sync, check for rollback

  // Events
  on(event: 'connected', handler: () => void): void;
  on(event: 'disconnected', handler: (reason: string) => void): void;
  on(event: 'desync', handler: (frame: number) => void): void;
  on(event: 'rollback', handler: (frames: number) => void): void;
}
```

### Integration with Emulator

The `Emulator` class will be extended to support netplay:

```typescript
// New methods in Emulator class
interface EmulatorNetplayMethods {
  startNetplayServer(options: NetplayServerOptions): Promise<void>;
  connectToNetplay(options: NetplayClientOptions): Promise<void>;
  disconnectNetplay(): void;
  isNetplayActive(): boolean;
}

// Modified run loop (pseudo-code)
const runFrameWithNetplay = (): void => {
  if (this.netplay) {
    this.netplay.preFrame();  // Gather/exchange input
  }

  if (this.syncManager?.needsRollback()) {
    this.disableAudio();  // Prevent audio artifacts
    this.syncManager.performRollback();
    this.enableAudio();
  }

  this.syncInputToCore();  // Apply merged local+remote input
  this.core.runFrame();

  if (this.netplay) {
    this.netplay.postFrame();  // Broadcast state, check sync
  }
};
```

### CLI Interface

```bash
# Host a netplay session
emoemu game.sfc --netplay-host [--netplay-port 55435] [--netplay-password secret]

# Connect to a netplay session
emoemu game.sfc --netplay-connect hostname[:port] [--netplay-password secret]

# Additional options
--netplay-spectate        # Join as spectator (no input)
--netplay-nick "Player1"  # Set nickname
--netplay-frames 2        # Input delay frames (0-16, default: 2)
```

## Implementation Plan

### Milestone 1: Protocol Foundation (Week 1-2)

**Goal**: Implement core protocol primitives and basic TCP communication.

**Tasks**:
1. Create `src/netplay/` directory structure
2. Define protocol constants (`consts.ts`)
   - Command IDs (INPUT, NOINPUT, NICK, PASSWORD, INFO, SYNC, etc.)
   - Default port, timing constants, limits
3. Implement command serialization/deserialization (`protocol.ts`)
   - `encodeCommand()` / `decodeCommand()`
   - Individual command builders (buildInputCommand, buildInfoCommand, etc.)
   - Handle network byte order (big-endian)
4. Implement TCP connection wrapper (`connection.ts`)
   - Buffered reads for partial commands
   - Async command iteration
   - Connection state tracking
5. Add TypeScript interfaces (`types.ts`)

**Deliverable**: Protocol layer that can encode/decode all netplay commands.

**Acceptance Criteria**:
- Unit tests for all command types
- Round-trip encode/decode produces identical data
- Handles partial TCP reads correctly

### Milestone 2: Frame Buffer & State Management (Week 2-3)

**Goal**: Implement frame history tracking and state serialization.

**Tasks**:
1. Implement frame buffer ring (`frame-buffer.ts`)
   - Fixed-capacity ring buffer (default: 120 frames = 2 seconds at 60fps)
   - Store serialized state, local input, remote input per frame
   - Frame number wraparound handling
2. Implement input buffer (`input-buffer.ts`)
   - Track input per client per frame
   - Input prediction (repeat last known input)
   - Input delay queue
3. Add CRC32 computation for state comparison
   - Use existing CRC implementation or add lightweight one
4. Implement state compression (optional, for large states)
   - zlib compression for LOAD_SAVESTATE transfers
   - Compression threshold (e.g., only compress if > 64KB)

**Deliverable**: Frame buffer that can track 2+ seconds of frame history.

**Acceptance Criteria**:
- Can store and retrieve frame states by number
- Handles buffer wraparound correctly
- CRC32 matches for identical states

### Milestone 3: Sync Manager & Rollback (Week 3-4)

**Goal**: Implement deterministic rollback and replay.

**Tasks**:
1. Implement sync manager (`sync-manager.ts`)
   - Track self/other/unread frame pointers
   - Detect when rollback is needed
   - Coordinate state capture timing
2. Implement rollback logic
   - Restore state from frame buffer
   - Replay frames with corrected input
   - Re-capture states during replay
3. Implement input merging
   - Combine local + remote input for core
   - Handle missing remote input (simulation)
4. Add desync detection
   - Periodic CRC comparison
   - Trigger state resync on mismatch
5. Handle audio during rollback
   - Mute audio output during replay
   - Resume audio after rollback complete

**Deliverable**: Sync manager that can rollback and replay frames.

**Acceptance Criteria**:
- Single-player rollback test: artificially delay input, verify correct replay
- State restoration produces identical CRC
- Audio doesn't glitch during rollback

### Milestone 4: Server Implementation (Week 4-5)

**Goal**: Implement netplay server (host) functionality.

**Tasks**:
1. Implement server class (`server.ts`)
   - TCP server on configurable port
   - Accept multiple client connections
   - Track client state (nickname, player number, mode)
2. Implement handshake flow (server side)
   - Receive/verify connection header
   - Exchange nicknames
   - Validate password (if configured)
   - Send INFO (core name, version, content CRC)
   - Receive client INFO, validate compatibility
   - Send SYNC with initial state
3. Implement input relay
   - Receive INPUT from clients
   - Broadcast INPUT to all other clients
   - Send server's own INPUT
4. Implement periodic sync checks
   - Send CRC command every N frames
   - Handle desync (send LOAD_SAVESTATE)
5. Handle client lifecycle
   - New connections during gameplay
   - Graceful disconnection
   - Kick functionality

**Deliverable**: Functional netplay server.

**Acceptance Criteria**:
- Can accept connection from RetroArch client (handshake completes)
- Input reaches clients within expected latency
- New client receives valid initial state

### Milestone 5: Client Implementation (Week 5-6)

**Goal**: Implement netplay client functionality.

**Tasks**:
1. Implement client class (`client.ts`)
   - TCP connection to server
   - Connection state machine
   - Reconnection logic (optional)
2. Implement handshake flow (client side)
   - Send connection header
   - Exchange nicknames
   - Send password (if required)
   - Send INFO, receive server INFO
   - Receive SYNC, load initial state
3. Implement input exchange
   - Send local INPUT every frame
   - Receive and buffer remote INPUT
   - Handle INPUT from other clients (via server relay)
4. Integrate with sync manager
   - Feed received input to frame buffer
   - Trigger rollback when needed
5. Handle connection issues
   - Detect timeout / disconnect
   - Attempt graceful recovery

**Deliverable**: Functional netplay client.

**Acceptance Criteria**:
- Can connect to RetroArch server (handshake completes)
- Gameplay syncs correctly (same visual state)
- Handles moderate packet delay gracefully

### Milestone 6: Emulator Integration (Week 6-7)

**Goal**: Integrate netplay into main emulator loop.

**Tasks**:
1. Modify `Emulator` class
   - Add netplay server/client instance
   - Inject preFrame/postFrame hooks
   - Modify input handling for netplay
2. Add CLI arguments
   - `--netplay-host`, `--netplay-connect`
   - `--netplay-port`, `--netplay-password`
   - `--netplay-spectate`, `--netplay-nick`
   - `--netplay-frames`
3. Add status bar integration
   - Show connection status
   - Show ping/latency
   - Show player count
4. Add notifications
   - Player connected/disconnected
   - Desync detected/recovered
   - Connection lost
5. Handle ROM validation
   - Compute content CRC on load
   - Verify CRC matches server

**Deliverable**: Playable netplay from CLI.

**Acceptance Criteria**:
- Can host and connect via CLI
- Two emoemu instances can play together
- Status bar shows netplay info

### Milestone 7: Testing & Polish (Week 7-8)

**Goal**: Comprehensive testing and edge case handling.

**Tasks**:
1. Unit tests
   - Protocol encoding/decoding
   - Frame buffer operations
   - Sync manager logic
2. Integration tests
   - Server/client handshake
   - Input exchange
   - Rollback scenarios
3. Manual testing
   - Various cores (SNES, Genesis, GBA)
   - Different latency conditions
   - Edge cases (mid-game connect, disconnect)
4. Performance optimization
   - Profile rollback performance
   - Optimize state serialization
   - Reduce memory allocations
5. Documentation
   - Update CLAUDE.md with netplay section
   - Add netplay usage examples
   - Document protocol compatibility notes

**Deliverable**: Production-ready netplay support.

**Acceptance Criteria**:
- All tests pass
- Playable with 100ms+ latency
- No memory leaks during extended sessions

## Protocol Details

### Connection Header

First 4 bytes exchanged by both parties:

```
Offset  Size  Description
0       4     Magic: "RANP" (0x52414E50) - RetroArch Netplay
```

### Handshake Sequence

```
Client                          Server
  |                               |
  |-------- HEADER (RANP) ------->|
  |<------- HEADER (RANP) --------|
  |                               |
  |-------- NICK (nickname) ----->|
  |<------- NICK (nickname) ------|
  |                               |
  |-------- PASSWORD (hash) ----->| (if required)
  |                               |
  |<------- INFO (core info) -----|
  |-------- INFO (core info) ---->|
  |                               |
  |<------- SYNC (state) ---------|
  |                               |
  |======= GAMEPLAY LOOP =========|
```

### INPUT Command Format

```
Offset  Size  Description
0       4     Frame number (uint32, network byte order)
4       4     Client ID and flags:
              - Bits 0-30: Client number
              - Bit 31: Is server data flag
8       4     Joypad input (RETRO_DEVICE_JOYPAD bitmask)
12      4     Analog left (optional, if device supports)
16      4     Analog right (optional, if device supports)
```

### INFO Command Format

```
Offset  Size  Description
0       32    Core name (null-terminated string)
32      32    Core version (null-terminated string)
64      4     Content CRC32 (uint32, network byte order)
```

### SYNC Command Format

```
Offset  Size  Description
0       4     Frame number (uint32)
4       4     Flags:
              - Bit 0: Paused
              - Bits 1-31: Connected players bitmap
8       4     Flip frame (for player swap)
12      64    Controller devices (uint32[16])
76      32    Client nickname
108     var   Serialized SRAM/state
```

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Protocol incompatibility with RetroArch | Medium | High | Test against multiple RA versions; document known working versions |
| Rollback performance too slow | Medium | Medium | Profile early; optimize state serialization; limit rollback depth |
| State size too large for some cores | Low | Medium | Implement compression; warn users about memory usage |
| Desync issues | High | Medium | Comprehensive CRC checking; detailed logging; state dumps for debugging |
| Network jitter causing poor experience | Medium | Medium | Tunable input delay; clear latency indicators |

## RetroArch Compatibility Gaps (TODO)

Known divergences from RetroArch protocol behavior, in priority order. Items in
the first group can break sessions against real RetroArch peers; later groups
are functional or ecosystem gaps. emoemu↔emoemu sessions are unaffected.

**Compatibility scope**: the targets are emoemu↔emoemu and the *latest*
RetroArch client (protocol v7). Older RetroArch protocol versions (v5/v6
negotiation, raw uncontainered savestates for sub-v7 peers) are explicitly
out of scope.

### Interop breakers

- [x] **Salted password hashing**: RetroArch hashes `sha256(sprintf("%08lX", salt) + password)` using the salt from the connection header. Implemented: the client hashes with the salt from the server's header, and the server verifies against the per-session salt it sent.
- [x] **Join choreography frame invariants**: RetroArch clients enforce that a MODE join frame and a LOAD_SAVESTATE frame equal their *tracked server frame count* (advanced only by received server INPUT/NOINPUT for consecutive frames), and NAK on INPUT for an unexpectedly high frame. Implemented: every synced session (including pre-PLAY) receives the consecutive server input stream from the SYNC frame onward; MODE announcements are deferred to the frame boundary right after the server's INPUT (join frame = currentFrame + 1); the proactive savestate is sent at the same boundary with a matching tag; the future-frame "priming" INPUTs are gone. Enforced by a strict-invariant protocol client in the server integration tests. Final validation against a real RetroArch binary still recommended.
- [x] **Variable-size INPUT / device model (analog)**: INPUT payloads are sized by the sender's declared device (JOYPAD=1 word, ANALOG=3 words) and a size mismatch is a NAK. Implemented: SYNC declares `RETRO_DEVICE_ANALOG` ports by default (`analogEnabled` server option), the server and client both send the 3-word form for ANALOG ports (the client derives its size from the SYNC declaration, so it adapts to hosts that declare JOYPAD), sticks are packed per RetroArch (`(u16)x | ((u16)y << 16)` in `netplay/analogInput`), and the Emulator captures local stick/keyboard analog into netplay input and applies merged analog to the core — during netplay the direct analog side-channel to the core is suppressed. Remaining for full parity: KEYBOARD (5 words) and MOUSE/LIGHTGUN (2 words) devices, and multiple devices per client.

### Functional gaps

- [x] **CRC first-mismatch fallback**: like RetroArch, a mismatch before any CRC comparison has ever matched marks CRCs as invalid for the session and disables further checking (logged once), instead of desync-recovering forever. A first comparison that matches proves the peer's CRC basis agrees, after which mismatches trigger normal desync recovery. This lets the system-RAM CRC basis (FR-23) work between emoemu peers while degrading gracefully against peers with a different basis (e.g. real RetroArch's full-state pre-frame CRC).
- [x] **SRAM in SYNC**: the server reads the core's current battery RAM (via an Emulator-wired provider) into the SYNC payload; the client emits `sram-load` and the Emulator applies it with RetroArch's guard (only when sizes agree). The SYNC payload is no longer misused as ring state.
- [x] **Server-initiated STALL**: the server stalls playing clients whose latest input frame is more than 3 frames ahead (stall count = how far ahead + 1), throttled to one STALL per client per 120 frames; clients clamp any requested stall to the 60-frame maximum.
- [x] **RESET broadcast**: host resets are queued and broadcast at the next frame boundary (tagged currentFrame + 1, matching each client's tracked server frame); the host core resets via the server `reset` event and clients reset on the received command. Client-side resets are ignored (only the server may reset).
- [x] **NOINPUT**: receive path implemented on both ends (advances the tracked server frame). The send path only applies when the server is not playing (a spectating host), which emoemu does not support — the host is always player 1 and sends INPUT every frame. Revisit if spectating-host support is added.
- [x] **Input prediction policy**: verified — InputBuffer predicts by repeating the last known input, matching RetroArch. (RetroArch additionally restricts re-simulated predictions to D-pad direction bits during replay to avoid double-firing buttons; not implemented, minor.)
- [x] **Connection header conformance**: the platform magic uses RetroArch's layout (endianness bit + `sizeof(size_t)`/`sizeof(long)`, presented as little-endian 64-bit), and the protocol word is meaningful: the server advertises 7 (RetroArch clients read it as the negotiated protocol and gate v6+ commands on it — the previous constant 5 would have made them NAK our SETTING commands), clients propose 5 with their highest (7) in the salt word.
- [x] **Active PING**: both sides ping every 3s (client immediately after handshake; server per synced session), exposing round-trip latency via `client.latency` and per-session `latency`.

### Ecosystem features

- [ ] **Lobby announce + room list**: HTTP announce to the libretro lobby (every 20s) and room-list JSON parsing — how most internet sessions are discovered. LAN discovery is already wire-compatible.
- [ ] **MITM relay support**: the tunnel protocol (RATS/RATL/RATA/RATP session magics) used by lobby relay servers for NAT-less hosting.
- [ ] **Keyboard device**: 5-word keyboard input encoding (netplay key index bitfield) for keyboard-driven cores.
- [ ] **Device share modes**: digital OR/XOR/VOTE and analog MAX/AVERAGE merging for shared devices; we send all share modes as zero and never merge.
- [ ] **Slave mode**: honor the SLAVE bit in PLAY/MODE (server repeats slave input; slave INPUT bypasses frame-order checks). We parse but ignore it.
- [ ] **Misc conformance**: nick de-duplication in SYNC (server may rename clients), NAK-then-disconnect on malformed commands, MODE_REFUSED with proper reason codes (we substitute MODE playing=0), kick/ban via BANNED_MAGIC header response.

## Future Enhancements (Post-MVP)

1. **Lobby Server Integration**: Announce sessions to libretro lobby (see compatibility TODO above)
2. **NAT Traversal**: UPnP port forwarding, STUN/TURN
3. **Spectator Chat**: Text chat during spectating
4. **Input Display**: Show inputs on screen for spectators
5. **Replay Recording**: Save netplay sessions for replay
6. **Native Core Support**: Extend to native NES core

## References

- [RetroArch Netplay Documentation](https://docs.libretro.com/development/retroarch/netplay/)
- [RetroArch Netplay Source Code](https://github.com/libretro/RetroArch/tree/master/network/netplay)
- [Netplay FAQ](https://docs.libretro.com/guides/netplay-faq/)
- [netplay_private.h](https://github.com/libretro/RetroArch/blob/master/network/netplay/netplay_private.h)
