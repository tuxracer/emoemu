/**
 * Core operations needed to replay frames during a netplay rollback.
 * Implemented by the Emulator, which owns the core and audio pipeline.
 */
export interface ReplayCoreHooks {
  /** Restore the core to a previously serialized state */
  restoreState(state: Buffer): void;
  /** Apply merged (local + corrected remote) input to the core */
  applyInput(input: number[]): void;
  /** Run the core for one frame */
  runFrame(): void;
  /**
   * Serialize the core's state, reusing `scratch` when possible.
   * The result is copied by the frame ring before the next capture.
   */
  captureState(scratch: Buffer | null): Buffer | null;
  /**
   * Read the stable region used as the desync-CRC basis (e.g. system
   * RAM). Must return the same region regular frame capture uses, so
   * replayed frames hash the same bytes as every other frame.
   */
  captureCrcBasis?(): Uint8Array | null;
  /** Called before the first replayed frame (e.g. suppress audio) */
  beginReplay?(): void;
  /** Called after the last replayed frame (e.g. restore audio) */
  endReplay?(): void;
}
