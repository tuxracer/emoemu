import type { RenderMode } from '../../Emulator';
import type { Config, CliOverride } from '../../frontend/config';

export interface CliOptions {
  romPath?: string;
  width: number | undefined;
  height: number | undefined;
  colorEnabled: boolean;
  renderMode: RenderMode | undefined;  // undefined = Auto (system-specific default)
  cliOverrides: CliOverride[];  // config keys set on the CLI (session locks); drives menu disabling
  scale: number | undefined;
  help: boolean;
  showVersion: boolean;
  listGamepads: boolean;
  listCoresFlag: boolean;
  installCore: string | undefined;
  removeCore: string | undefined;
  core: string | undefined;
  enableGamepad: boolean;
  enableAudio: boolean;
  startMuted: boolean;
  enableSaveState: boolean;
  enableBatterySave: boolean;
  showStatusBar: boolean;
  enableDiffRendering: boolean;
  noRender: boolean;
  debugGamepad: boolean;
  fpsLimit: number | undefined;
  loadRetroArch: boolean;
  pngCompressionLevel: number;
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
  hasUserEffects: boolean;  // Whether user explicitly specified any post-processing effects
  configPath: string | undefined;
  config: Config;
  scanDepth: number;  // Max depth for ROM scanning
  // Playlist generation options
  generatePlaylist: string | boolean;  // Path to scan, or true for cwd, or false for disabled
  playlistOutput: string;
  singlePlaylist: string | undefined;  // Single playlist name, or undefined for per-system
  windowsPaths: boolean;
  // Netplay options
  netplayHost: boolean;  // Host a netplay session
  netplayConnect: string | undefined;  // Connect to server (hostname or hostname:port)
  netplayPort: number;  // Netplay port (default: 55435)
  netplayPassword: string | undefined;  // Netplay password
  netplaySpectate: boolean;  // Join as spectator
  netplayNickname: string;  // Player nickname
  netplayInputDelay: number;  // Input delay frames (0-16)
  clearLogs: boolean;  // Delete all log files and exit
  verbose: boolean;  // Enable verbose logging to stderr
  frameLimit: number;  // Limit rendering to N fps (0=off)
}
