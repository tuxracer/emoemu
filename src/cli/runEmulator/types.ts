export interface RunEmulatorResult {
  shouldContinue: boolean;  // true = return to browser, false = exit app
  gameWasPlayed: boolean;   // true = emulator ran, false = cancelled before running
  coreId?: string;          // Core ID that was used (for resume game feature)
  sessionSeconds?: number;  // Estimated runtime in seconds based on frame count
  showNetplayOnReturn?: boolean;  // true = show netplay panel when returning to browser
}
