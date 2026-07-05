/**
 * Main UI App Component
 *
 * Entry point for the Ink-based terminal UI.
 */

import { useState, useEffect, useCallback } from 'react';
import { Box, Text, render } from 'ink';
import { Spinner } from '@inkjs/ui';
import { RomBrowser } from '../RomBrowser';
import type { RomInfo } from '../../frontend/romScanner';
import { getPlaylistsDirectory, DEFAULT_CONFIG } from '../../frontend/config';
import type { Config, CliOverride } from '../../frontend/config';
import { cleanupInkInstance, detectCellPixelSize } from '../../utils/terminal';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { GamepadProvider } from '../GamepadContext';
import { AppCapabilitiesProvider, type AppCapabilities } from '../AppCapabilities';
import { ConfigProvider } from '../ConfigContext';
import { AddRomsPrompt } from '../AddRomsPrompt';
import {
  loadRomsFromPlaylists,
  findPlaylistsInDirectory,
} from '../../frontend/playlist';
import type { PlaylistInfo } from '../../frontend/playlist';
import { detectKittyGraphicsSupport } from '../../utils/kitty';
import { getWindowManager, isFensterAvailable } from '../../rendering/nativeUi';
import { logger } from '../../utils/logger';
import { LOADING_INDICATOR_DELAY_MS } from './consts';

export * from './consts';


interface AppProps {
  scanDepth: number;          // Max depth for scanning subdirectories (0=only dir, 1=+subdirs, -1=unlimited)
  onRomSelected: (rom: RomInfo, filter: string, resumeGame?: boolean, netplay?: NetplayOptions) => void;
  onExit: (filter: string) => void;
  onRefresh: (filter: string) => void;  // Trigger a refresh of the ROM list
  initialSelection?: string;  // Path of ROM to select initially
  initialFilter?: string;     // Initial search filter to apply
  config: Config;             // Current configuration
  configPath?: string;        // Path to config file
  showSettingsOnMount?: boolean;  // Show settings panel immediately on mount
  lastPlayedRom?: RomInfo;        // ROM that was just played (for Resume Game option)
  showNetplayOnMount?: boolean;   // Show netplay panel immediately on mount
  kittyGraphicsSupported: boolean;  // Whether Kitty graphics protocol is supported
  onScaleFactorChange?: (scaleFactor: number | null) => void;  // Callback for native UI scale changes
  cliOverrides?: CliOverride[];  // Config keys locked by CLI flags
}

const LoadingState = ({ message = "Scanning for ROMs..." }: { message?: string }) => (
  <Box padding={1}>
    <Spinner label={message} />
  </Box>
);

type AppState = 'loading' | 'prompt' | 'browser' | 'error';

const App = ({ scanDepth, onRomSelected, onExit, onRefresh, initialSelection, initialFilter, config, configPath, showSettingsOnMount, lastPlayedRom, showNetplayOnMount, kittyGraphicsSupported, onScaleFactorChange, cliOverrides }: AppProps) => {
  const [roms, setRoms] = useState<RomInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appState, setAppState] = useState<AppState>('loading');
  const [showLoadingUI, setShowLoadingUI] = useState(false);

  // App capabilities for context (avoid prop drilling)
  const capabilities: AppCapabilities = {
    kittyGraphicsSupported,
    nativeSupported: isFensterAvailable(),
  };

  // Resolve playlist directory from config (uses platform-specific default)
  const playlistDirectory = getPlaylistsDirectory(config);

  // Delay showing loading indicator to avoid flash for fast loads
  useEffect(() => {
    if (appState !== 'loading') {
      setShowLoadingUI(false);
      return;
    }

    const timer = setTimeout(() => {
      setShowLoadingUI(true);
    }, LOADING_INDICATOR_DELAY_MS);

    return () => clearTimeout(timer);
  }, [appState]);

  useEffect(() => {
    const loadRoms = () => {
      try {
        // Check if there are any playlists
        const playlists = findPlaylistsInDirectory(playlistDirectory);

        if (playlists.length > 0) {
          // Load all ROMs from playlists
          const playlistRoms = loadRomsFromPlaylists(playlistDirectory, {
            validateFiles: true,
            checkSaveStates: true,
          });

          setRoms(playlistRoms);
          setAppState('browser');
        } else {
          // No playlists found - show import prompt
          setAppState('prompt');
        }
      } catch (err) {
        setError(getErrorMessage(err));
        setAppState('error');
      }
    };

    loadRoms();
  }, [playlistDirectory]);

  // Handle playlist generation (after adding ROMs)
  const handlePlaylistGenerated = useCallback((playlists: PlaylistInfo[]) => {
    if (playlists.length > 0) {
      // Load all ROMs from playlists
      const playlistRoms = loadRomsFromPlaylists(playlistDirectory, {
        validateFiles: true,
        checkSaveStates: true,
      });

      setRoms(playlistRoms);
      setAppState('browser');
    }
  }, [playlistDirectory]);

  // Handle exit from prompt
  const handlePromptExit = useCallback(() => {
    onExit('');
  }, [onExit]);

  if (appState === 'error') {
    return (
      <AppCapabilitiesProvider capabilities={capabilities}>
        <ConfigProvider initialConfig={config} configPath={configPath} cliOverrides={cliOverrides}>
          <GamepadProvider>
            <Box flexDirection="column" padding={1}>
              <Text color="red">{'\u2717'} Error: {error}</Text>
              <Text color="gray" dimColor>Press any key to exit</Text>
            </Box>
          </GamepadProvider>
        </ConfigProvider>
      </AppCapabilitiesProvider>
    );
  }

  if (appState === 'loading') {
    // Only show loading indicator after delay to avoid flash for fast loads
    if (!showLoadingUI) {
      return null;
    }
    return (
      <AppCapabilitiesProvider capabilities={capabilities}>
        <ConfigProvider initialConfig={config} configPath={configPath} cliOverrides={cliOverrides}>
          <GamepadProvider>
            <LoadingState message="Loading game library..." />
          </GamepadProvider>
        </ConfigProvider>
      </AppCapabilitiesProvider>
    );
  }

  if (appState === 'prompt') {
    return (
      <AppCapabilitiesProvider capabilities={capabilities}>
        <ConfigProvider initialConfig={config} configPath={configPath} cliOverrides={cliOverrides}>
          <GamepadProvider>
            <AddRomsPrompt
              directory={process.cwd()}
              playlistDirectory={playlistDirectory}
              scanDepth={scanDepth}
              onPlaylistGenerated={handlePlaylistGenerated}
              onExit={handlePromptExit}
              exitAppOnCancel={true}
            />
          </GamepadProvider>
        </ConfigProvider>
      </AppCapabilitiesProvider>
    );
  }

  return (
    <AppCapabilitiesProvider capabilities={capabilities}>
      <ConfigProvider initialConfig={config} configPath={configPath} cliOverrides={cliOverrides}>
        <GamepadProvider>
          <RomBrowser
            roms={roms ?? []}
            playlistDirectory={playlistDirectory}
            scanDepth={scanDepth}
            onSelect={onRomSelected}
            onExit={onExit}
            onRefresh={onRefresh}
            initialSelection={initialSelection}
            initialFilter={initialFilter}
            showSettingsOnMount={showSettingsOnMount}
            lastPlayedRom={lastPlayedRom}
            showNetplayOnMount={showNetplayOnMount}
            onScaleFactorChange={onScaleFactorChange}
          />
        </GamepadProvider>
      </ConfigProvider>
    </AppCapabilitiesProvider>
  );
};

/** Netplay options selected from the UI */
export interface NetplayOptions {
  mode: 'host' | 'join';    // Host a session or join one
  nickname: string;         // Player nickname
  port: number;             // Port for netplay (default: 55435)
  host?: string;            // Host address (only for join mode)
  password?: string;        // Optional session password
  inputDelay: number;       // Input delay frames (0-16)
  spectate?: boolean;       // Join as spectator
}

/** Result from launching the ROM browser */
export interface BrowserResult {
  path: string | null;      // Selected ROM path, or null if cancelled
  filter: string;           // Search filter that was active
  shouldRefresh?: boolean;  // True if user triggered a refresh (e.g., after adding ROMs)
  resumeGame?: boolean;     // True if user selected "Resume Game" from settings
  resumeCoreId?: string;    // Core ID to use when resuming (bypasses core selector)
  netplay?: NetplayOptions; // Netplay options if starting a netplay session
}

/**
 * Launch the ROM browser UI.
 * Loads all ROMs from playlists in the configured playlist directory.
 */
export const launchBrowser = async (scanDepth: number = 1, initialSelection?: string, initialFilter?: string, config?: Config, configPath?: string, showSettingsOnMount?: boolean, lastPlayedRom?: RomInfo, lastPlayedCoreId?: string, showNetplayOnMount?: boolean, cliOverrides?: CliOverride[]): Promise<BrowserResult> => {
  // Detect Kitty graphics support before rendering
  // This uses environment variables first (fast), then falls back to protocol query
  const kittyGraphicsSupported = await detectKittyGraphicsSupport();

  // Measure the terminal's actual cell pixel size while stdin is still directly
  // queryable (before Ink takes over), so the Kitty display keeps the correct
  // aspect ratio regardless of the user's font width. No-op if already cached.
  if (kittyGraphicsSupported) {
    await detectCellPixelSize();
  }

  // Use provided config or fall back to defaults
  const effectiveConfig: Config = config ?? DEFAULT_CONFIG;

  // Check if we should use native mode
  const nativeAvailable = isFensterAvailable();
  const useNativeMode = effectiveConfig.video_driver === 'native' && nativeAvailable;

  logger.info(
    `Browser mode check: video_driver=${effectiveConfig.video_driver}, native=${nativeAvailable}, useNative=${useNativeMode}`,
    'Native-UI'
  );

  // Warn if native mode was requested but the backend is unavailable
  if (effectiveConfig.video_driver === 'native' && !useNativeMode) {
    logger.warn('Native mode requested but the native window backend is unavailable, falling back to terminal', 'Native-UI');
  }

  const params: BrowserLaunchParams = {
    scanDepth,
    initialSelection,
    initialFilter,
    config: effectiveConfig,
    configPath,
    showSettingsOnMount,
    lastPlayedRom,
    lastPlayedCoreId,
    showNetplayOnMount,
    kittyGraphicsSupported,
    cliOverrides,
  };

  if (useNativeMode) {
    return launchBrowserNative(params);
  }

  // Terminal mode (default)
  return launchBrowserTerminal(params);
};

/** Shared parameters for browser launch functions */
interface BrowserLaunchParams {
  scanDepth: number;
  initialSelection?: string;
  initialFilter?: string;
  config: Config;
  configPath?: string;
  showSettingsOnMount?: boolean;
  lastPlayedRom?: RomInfo;
  lastPlayedCoreId?: string;
  showNetplayOnMount?: boolean;
  kittyGraphicsSupported: boolean;
  cliOverrides?: CliOverride[];
}

/** Creates the shared handler callbacks and result builder for browser launch */
const createBrowserHandlers = (params: BrowserLaunchParams) => {
  let selectedPath: string | null = null;
  let currentFilter: string = params.initialFilter ?? '';
  let shouldRefresh = false;
  let isResumeGame = false;
  let resumeCoreId: string | undefined = undefined;
  let netplayOptions: NetplayOptions | undefined = undefined;

  const handleSelect = (rom: RomInfo, filter: string, resumeGame?: boolean, netplay?: NetplayOptions) => {
    selectedPath = rom.path;
    currentFilter = filter;
    isResumeGame = resumeGame ?? false;
    netplayOptions = netplay;
    if (isResumeGame && params.lastPlayedCoreId) {
      resumeCoreId = params.lastPlayedCoreId;
    }
  };

  const handleExit = (filter: string) => {
    currentFilter = filter;
  };

  const handleRefresh = (filter: string) => {
    shouldRefresh = true;
    currentFilter = filter;
  };

  const getResult = (): BrowserResult => ({
    path: selectedPath,
    filter: currentFilter,
    shouldRefresh,
    resumeGame: isResumeGame,
    resumeCoreId,
    netplay: netplayOptions,
  });

  return { handleSelect, handleExit, handleRefresh, getResult };
};

/**
 * Launch browser in terminal mode (default)
 */
const launchBrowserTerminal = (params: BrowserLaunchParams): Promise<BrowserResult> => new Promise((resolve) => {
  const { handleSelect, handleExit, handleRefresh, getResult } = createBrowserHandlers(params);

  const instance = render(
    <App
      scanDepth={params.scanDepth}
      onRomSelected={handleSelect}
      onExit={handleExit}
      onRefresh={handleRefresh}
      initialSelection={params.initialSelection}
      initialFilter={params.initialFilter}
      config={params.config}
      configPath={params.configPath}
      showSettingsOnMount={params.showSettingsOnMount}
      lastPlayedRom={params.lastPlayedRom}
      showNetplayOnMount={params.showNetplayOnMount}
      kittyGraphicsSupported={params.kittyGraphicsSupported}
      cliOverrides={params.cliOverrides}
    />,
    { exitOnCtrlC: false }
  );

  void instance.waitUntilExit().then(() => {
    cleanupInkInstance(instance, resolve, getResult());
  });
});

/**
 * Launch browser in native window mode
 * Creates/reuses the shared native window and routes Ink rendering through ink-native streams
 */
const launchBrowserNative = (params: BrowserLaunchParams): Promise<BrowserResult> => new Promise((resolve) => {
  const { handleSelect, handleExit, handleRefresh, getResult } = createBrowserHandlers(params);
  const windowManager = getWindowManager();
  try {
    if (!windowManager.isInitialized()) {
      windowManager.init({ title: 'emoemu - Game Library', scaleFactor: params.config.menu_scale_factor });
    }
    windowManager.setMode('ui');

    const stdin = windowManager.getStdin();
    const stdout = windowManager.getStdout();
    const window = windowManager.getWindow();
    windowManager.clearScreen();

    const onClose = () => { stdin.push('\x1b'); };
    window.on('close', onClose);
    logger.info('Native UI mode enabled for browser (shared window)', 'Native-UI');

    // NOTE: ink-native has no runtime setScaleFactor. menu_scale_factor is applied
    // at window creation; live changes take effect on next launch.
    const handleScaleFactorChange = (_scaleFactor: number | null) => {
      // Persisted to config by the settings panel; re-render UI to reflect other changes.
      stdout.emit('resize');
    };

    const instance = render(
      <App
        scanDepth={params.scanDepth}
        onRomSelected={handleSelect}
        onExit={handleExit}
        onRefresh={handleRefresh}
        initialSelection={params.initialSelection}
        initialFilter={params.initialFilter}
        config={params.config}
        configPath={params.configPath}
        showSettingsOnMount={params.showSettingsOnMount}
        lastPlayedRom={params.lastPlayedRom}
        showNetplayOnMount={params.showNetplayOnMount}
        kittyGraphicsSupported={params.kittyGraphicsSupported}
        onScaleFactorChange={handleScaleFactorChange}
        cliOverrides={params.cliOverrides}
      />,
      {
        exitOnCtrlC: false,
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
      }
    );

    void instance.waitUntilExit().then(() => {
      // Do NOT close the shared window here — only detach this screen's listener.
      window.off('close', onClose);
      windowManager.getRenderer().reset();
      resolve(getResult());
    });
  } catch (error) {
    logger.warn(`Native UI failed, falling back to terminal: ${error}`, 'Native-UI');
    void launchBrowserTerminal(params).then(resolve);
  }
});

export default App;

/**
 * Import ROMs from a directory with progress UI.
 * Shows a progress bar during scanning, then auto-continues when done.
 */
export const importDirectory = async (directory: string, scanDepth: number, config: Config): Promise<void> => new Promise((resolve) => {
  const playlistDirectory = getPlaylistsDirectory(config);

  const handleComplete = () => {
    // Import complete - resolve immediately
  };

  const handleExit = () => {
    // User cancelled - still resolve (they can try again later)
  };

  const instance = render(
    <GamepadProvider>
      <AddRomsPrompt
        directory={directory}
        playlistDirectory={playlistDirectory}
        scanDepth={scanDepth}
        onPlaylistGenerated={handleComplete}
        onExit={handleExit}
        autoImport={true}
      />
    </GamepadProvider>
  );

  // Wait for the UI to exit, then clean up
  void instance.waitUntilExit().then(() => {
    cleanupInkInstance(instance, resolve, undefined);
  });
});
