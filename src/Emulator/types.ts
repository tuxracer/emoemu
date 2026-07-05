import type { CoreFactory } from '../frontend/coreRegistry';
import type { Config } from '../frontend/config';
import type { SettingsManager } from '../frontend/SettingsManager';

// Re-export RenderMode from SettingsManager for external consumers
export type { RenderMode } from '../frontend/SettingsManager';

// Post-processing mode type
export type PostProcessingMode = 'off' | 'custom' | 'crt';

// Effect values structure
export interface EffectValues {
  gamma: number;
  scanlines: number;
  saturation: number;
  brightness: number;
  contrast: number;
  vignette: number;
  bloom: number;
  bloomThreshold: number;
  ntsc: number;
  curvature: number;
  chromaticAberration: number;
}

// Common renderer interface
export interface Renderer {
  renderRgb15(frameBuffer: Uint16Array): string;  // For RGB15 cores (GBC, SNES)
  renderRgb24(frameBuffer: Uint8Array): string;   // For RGB24 cores (libretro)
  clearScreen(): string;
  hideCursor(): string;
  showCursor(): string;
  getStatusRow(): number;
  moveCursorToRow(row: number): string;
  setDimensions?(width: number, height: number): void;
  // Attach a sink for asynchronously rendered output (worker offload).
  // Renderers that support it return '' from renderRgb* and deliver
  // encoded frames to the sink instead.
  setOutputSink?(sink: (chunk: string) => void): void;
  destroy?(): void;  // Cleanup resources (native window, encode worker, etc.)
  isWindowBased?: boolean;  // True for window-based renderers (native)
  shouldClose?(): boolean;  // Check if window close was requested (native)
}

export interface EmulatorOptions {
  romPath: string;
  coreFactory: CoreFactory;  // Core factory for creating the emulator core
  width?: number;
  height?: number;
  colorEnabled?: boolean;
  renderMode?: import('../frontend/SettingsManager').RenderMode;
  scale?: number;  // For Kitty renderer
  enableGamepad?: boolean;  // Enable gamepad/controller support
  enableAudio?: boolean;  // Enable audio output (default: true)
  startMuted?: boolean;  // Start with audio muted (default: false)
  enableSaveState?: boolean;  // Enable save state loading/saving (default: true)
  enableBatterySave?: boolean;  // Enable battery save loading/saving (default: true)
  showStatusBar?: boolean;  // Show status bar (default: true)
  fpsLimit?: number;  // Override FPS limit (0 = uncapped, undefined = core native)
  enableDiffRendering?: boolean;  // Enable diff-based rendering optimization (default: true)
  noRender?: boolean;  // Disable video rendering output (for debugging, default: false)
  frameLimit?: number;  // Limit rendering to N fps (0=off/unlimited, default: 0)
  pngCompressionLevel?: number;  // PNG compression level 1-9 for Kitty mode (default: 1)
  gamma?: number;  // Gamma correction for Kitty mode (default: 1.0, CRT-like: 1.1-1.4)
  scanlines?: number;  // Scanline intensity for Kitty mode (default: 0.0 = disabled, 0.2-0.4 = subtle)
  saturation?: number;  // Color saturation for Kitty mode (default: 1.0, CRT-like: 1.1-1.3)
  brightness?: number;  // Brightness multiplier for Kitty mode (default: 1.0)
  contrast?: number;  // Contrast multiplier for Kitty mode (default: 1.0)
  vignette?: number;  // Vignette intensity for Kitty mode (default: 0.0 = disabled)
  bloom?: number;  // Bloom/glow intensity for Kitty mode (default: 0.0 = disabled)
  bloomThreshold?: number;  // Brightness threshold for bloom (default: 0.6)
  ntsc?: number;  // NTSC artifact intensity for Kitty mode (default: 0.0 = disabled)
  curvature?: number;  // CRT curvature for Kitty mode (default: 0.0 = disabled)
  chromaticAberration?: number;  // Chromatic aberration for Kitty mode (default: 0.0 = disabled)
  hasUserEffects?: boolean;  // Whether user explicitly specified post-processing effects (default: false)
  config?: Config;  // Current config for saving preference changes
  configPath?: string;  // Path to config file for saving
  settingsManager?: SettingsManager;  // Centralized settings manager (if provided, handles settings sync)
  // Netplay options
  netplayHost?: boolean;  // Start as netplay host/server
  netplayConnect?: string;  // Connect to netplay server (hostname or hostname:port)
  netplayPort?: number;  // Netplay port (default: 55435)
  netplayPassword?: string;  // Netplay password
  netplaySpectate?: boolean;  // Join as spectator
  netplayNickname?: string;  // Player nickname
  netplayInputDelay?: number;  // Input delay frames (0-16, default: 0)
}
