import type { RomInfo } from '../../frontend/romScanner';
import type { SaveStateDetails } from '../../frontend/saveServices';
import type { NetplayOptions } from '../App';
import type { Config } from '../../frontend/config';
import type { DiscoverySessionInfo } from '../../netplay/NetplayDiscovery';

export interface RomBrowserProps {
  roms: RomInfo[];
  playlistDirectory: string;  // Directory containing playlists
  scanDepth: number;          // Max depth for scanning subdirectories
  onSelect: (rom: RomInfo, currentFilter: string, resumeGame?: boolean, netplay?: NetplayOptions) => void;
  onExit: (currentFilter: string) => void;
  onRefresh: (currentFilter: string) => void;  // Trigger a refresh of the ROM list
  initialSelection?: string;  // Path of ROM to select initially
  initialFilter?: string;     // Initial search filter to apply
  showSettingsOnMount?: boolean;  // Show settings panel immediately on mount
  lastPlayedRom?: RomInfo;        // ROM that was just played (for Resume Game option)
  showNetplayOnMount?: boolean;   // Show netplay panel immediately on mount
  onScaleFactorChange?: (scaleFactor: number | null) => void;  // Callback for native UI scale changes
}

// Action button definitions (app-wide actions)
export interface ActionButtonDef {
  id: string;
  label: string;
  icon: string;
}

// Settings option definition (discriminated union for type-safe getValue/setValue)
export interface ToggleSettingsOption {
  id: string;
  label: string;
  type: 'toggle';
  options?: undefined;
  getValue: (config: Config) => boolean;
  setValue: (config: Config, value: boolean, configPath?: string) => void;
}

export interface SelectSettingsOption {
  id: string;
  label: string;
  type: 'select';
  options: { value: string; label: string }[];
  getValue: (config: Config) => string;
  setValue: (config: Config, value: string, configPath?: string) => void;
}

export type SettingsOption = ToggleSettingsOption | SelectSettingsOption;

// Settings category definition
export interface SettingsCategory {
  name: string;
  options: SettingsOption[];
}

export interface MetadataPanelProps {
  rom: RomInfo | null | undefined;
  width: number;
  height: number;
  saveStateDetails?: SaveStateDetails;
  thumbnail?: string;
  isKittySupported: boolean;
  panelStartCol: number;
}

/** Discovered host info extended with address */
export type DiscoveredHost = DiscoverySessionInfo & { address: string };
