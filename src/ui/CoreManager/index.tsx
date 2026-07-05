/**
 * Core Manager Component
 *
 * Allows users to view, install, and delete libretro cores.
 * Two tabs: Installed Cores and Download Cores.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Spinner, ProgressBar } from '@inkjs/ui';
import { unlink } from 'fs/promises';
import { listCores, unregisterCore } from '../../frontend/coreRegistry';
import {
  registerLibretroCore,
  unloadLibretroCore,
  isInUserCoresDirectory,
} from '../../cores/libretro';
import { getSystemName } from '../../frontend/playlist';
import {
  fetchAvailableCores,
  downloadCore,
  RECOMMENDED_CORE_NAMES,
  RECOMMENDED_CORES,
  type AvailableCoreInfo,
  type DownloadProgress,
} from '../../frontend/coreDownloader';
import { notify } from '../../frontend/notifications';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { useGamepadContext } from '../GamepadContext';
import { useClearTerminal } from '../hooks/useClearTerminal';
import {
  TAB_INSTALLED,
  TAB_DOWNLOAD,
  MAX_VISIBLE_ITEMS,
  BYTES_PER_KB,
} from './consts';

export * from './consts';

interface CoreManagerProps {
  onClose: () => void;
}

/** Information about an installed core */
interface InstalledCore {
  id: string;
  name: string;
  extensions: string[];
  path: string;
  canDelete: boolean;
  systemDescription: string;
}

/** Progress bar percentage constants */
const PROGRESS_FULL = 100;

export const CoreManager = ({ onClose }: CoreManagerProps) => {
  const ready = useClearTerminal();
  const { exit } = useApp();

  // Tab state
  const [activeTab, setActiveTab] = useState(TAB_INSTALLED);

  // Installed cores state
  const [installedCores, setInstalledCores] = useState<InstalledCore[]>([]);
  const [installedSelectedIndex, setInstalledSelectedIndex] = useState(0);

  // Download cores state
  const [availableCores, setAvailableCores] = useState<AvailableCoreInfo[]>([]);
  const [downloadSelectedIndex, setDownloadSelectedIndex] = useState(0);
  const [isLoadingCores, setIsLoadingCores] = useState(false);
  const [hasAttemptedLoad, setHasAttemptedLoad] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAllCores, setShowAllCores] = useState(false);

  // Download progress state
  const [downloadingCore, setDownloadingCore] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);

  // Delete confirmation state
  const [confirmDelete, setConfirmDelete] = useState<InstalledCore | null>(null);

  // Core info display state (for non-deletable cores)
  const [showCoreInfo, setShowCoreInfo] = useState<InstalledCore | null>(null);

  // Install error state (for showing error screen with retry option)
  const [installError, setInstallError] = useState<{
    core: AvailableCoreInfo;
    message: string;
  } | null>(null);

  // Get system description for a core based on its extensions
  const getSystemDescription = useCallback((coreId: string, extensions: string[]): string => {
    // Check if it's a known recommended core
    // Core IDs now match buildbot names directly (e.g., "mgba", "mupen64plus-next")
    const recommended = RECOMMENDED_CORES.find(c => c.name === coreId);
    if (recommended) {
      return recommended.description;
    }

    // Fall back to system name from first extension
    if (extensions.length > 0) {
      const systemName = getSystemName(extensions[0]);
      // Remove "Nintendo - " or similar prefixes for brevity
      return systemName.replace(/^[^-]+ - /, '');
    }

    return 'Unknown system';
  }, []);

  // Load installed cores
  const loadInstalledCores = useCallback(() => {
    const cores = listCores();
    const processed: InstalledCore[] = cores.map(core => ({
      id: core.id,
      name: core.name,
      extensions: core.extensions,
      path: core.path,
      canDelete: isInUserCoresDirectory(core.path),
      systemDescription: getSystemDescription(core.id, core.extensions),
    }));
    setInstalledCores(processed);
  }, [getSystemDescription]);

  // Load available cores from buildbot
  const loadAvailableCores = useCallback(async () => {
    setIsLoadingCores(true);
    setLoadError(null);
    setHasAttemptedLoad(true);
    try {
      const cores = await fetchAvailableCores();
      setAvailableCores(cores);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setIsLoadingCores(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadInstalledCores();
  }, [loadInstalledCores]);

  // Load available cores when switching to download tab (only once)
  useEffect(() => {
    if (activeTab === TAB_DOWNLOAD && !hasAttemptedLoad && !isLoadingCores) {
      void loadAvailableCores();
    }
  }, [activeTab, hasAttemptedLoad, isLoadingCores, loadAvailableCores]);

  // Get installed core names for filtering available cores
  // Core IDs now match buildbot names directly (e.g., "mgba", "mupen64plus-next")
  const installedCoreNames = useMemo(() => {
    return new Set(installedCores.map(c => c.id));
  }, [installedCores]);

  // Filter available cores (exclude installed, optionally show only recommended)
  const filteredAvailableCores = useMemo(() => {
    let coresToShow = availableCores.filter(c => !installedCoreNames.has(c.name));
    if (!showAllCores) {
      coresToShow = coresToShow.filter(c => c.isRecommended);
    }

    // Sort: recommended first, then alphabetically
    return coresToShow.sort((a, b) => {
      if (a.isRecommended && !b.isRecommended) { return -1; }
      if (!a.isRecommended && b.isRecommended) { return 1; }
      return a.name.localeCompare(b.name);
    });
  }, [availableCores, installedCoreNames, showAllCores]);

  // Count of available but not shown cores
  const hiddenCoresCount = useMemo(() => {
    if (showAllCores) { return 0; }
    const allNotInstalled = availableCores.filter(c => !installedCoreNames.has(c.name));
    return allNotInstalled.length - filteredAvailableCores.length;
  }, [availableCores, installedCoreNames, filteredAvailableCores.length, showAllCores]);

  // Handle core deletion
  const handleDeleteCore = useCallback(async (core: InstalledCore) => {
    try {
      await unlink(core.path);
      unregisterCore(core.id);
      unloadLibretroCore(core.path, core.id);
      notify({ message: `Deleted ${core.name}`, severity: 'info' });
      loadInstalledCores();
      setConfirmDelete(null);
      // Reset selection if needed
      setInstalledSelectedIndex(prev => Math.min(prev, installedCores.length - 2));
    } catch (error) {
      notify({
        message: `Failed to delete ${core.name}: ${getErrorMessage(error)}`,
        severity: 'error',
      });
      setConfirmDelete(null);
    }
  }, [loadInstalledCores, installedCores.length]);

  // Handle core download
  const handleDownloadCore = useCallback(async (core: AvailableCoreInfo) => {
    setDownloadingCore(core.name);
    setDownloadProgress(null);

    try {
      const corePath = await downloadCore(core.name, (progress) => {
        setDownloadProgress(progress);
      });

      // Dynamically register the newly downloaded core
      const coreId = registerLibretroCore(corePath);
      if (coreId) {
        notify({ message: `Installed ${core.name}`, severity: 'info' });
        // Refresh installed cores list to show the new core
        loadInstalledCores();
      } else {
        notify({ message: `Downloaded ${core.name} (already registered)`, severity: 'info' });
      }

      // Remove from available cores list
      setAvailableCores(prev => prev.filter(c => c.name !== core.name));

      // Reset selection if needed
      setDownloadSelectedIndex(prev => Math.min(prev, filteredAvailableCores.length - 2));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error(`Failed to install core ${core.name}: ${errorMessage}`, 'CoreManager');
      console.error(`Failed to install ${core.name}: ${errorMessage}`);
      setInstallError({ core, message: errorMessage });
    } finally {
      setDownloadingCore(null);
      setDownloadProgress(null);
    }
  }, [loadInstalledCores]);

  // Calculate scroll offset for lists
  const getScrollOffset = (selectedIndex: number, totalItems: number): number => {
    if (totalItems <= MAX_VISIBLE_ITEMS) { return 0; }
    const halfVisible = Math.floor(MAX_VISIBLE_ITEMS / 2);
    if (selectedIndex <= halfVisible) { return 0; }
    if (selectedIndex >= totalItems - halfVisible) { return totalItems - MAX_VISIBLE_ITEMS; }
    return selectedIndex - halfVisible;
  };

  // Keyboard input handling
  useInput((input, key) => {
    // CTRL-C exits the app
    if (input === '\x03' || (key.ctrl && input === 'c')) {
      exit();
      return;
    }

    // Handle delete confirmation dialog
    if (confirmDelete) {
      if (key.escape || input.toLowerCase() === 'n') {
        setConfirmDelete(null);
        return;
      }
      if (key.return || input.toLowerCase() === 'y') {
        void handleDeleteCore(confirmDelete);
        return;
      }
      return;
    }

    // Handle core info dialog (for non-deletable cores)
    if (showCoreInfo) {
      if (key.escape || key.return) {
        setShowCoreInfo(null);
        return;
      }
      return;
    }

    // Handle install error screen
    if (installError) {
      if (key.escape || input.toLowerCase() === 'c') {
        setInstallError(null);
        return;
      }
      if (key.return || input.toLowerCase() === 'r') {
        const coreToRetry = installError.core;
        setInstallError(null);
        void handleDownloadCore(coreToRetry);
        return;
      }
      return;
    }

    // Downloading - ignore most input
    if (downloadingCore) {
      if (key.escape) {
        // Could implement cancel here if needed
      }
      return;
    }

    // Close panel
    if (key.escape) {
      onClose();
      return;
    }

    // Tab switching
    if (key.tab || key.leftArrow || key.rightArrow) {
      setActiveTab(prev => prev === TAB_INSTALLED ? TAB_DOWNLOAD : TAB_INSTALLED);
      return;
    }

    // Navigation
    if (activeTab === TAB_INSTALLED) {
      if (key.upArrow) {
        setInstalledSelectedIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setInstalledSelectedIndex(prev => Math.min(installedCores.length - 1, prev + 1));
        return;
      }
      // Select core with Enter to show delete confirmation or core info
      if (key.return && installedCores[installedSelectedIndex]) {
        const core = installedCores[installedSelectedIndex];
        if (core.canDelete) {
          setConfirmDelete(core);
        } else {
          setShowCoreInfo(core);
        }
        return;
      }
    } else {
      // Download tab
      if (key.upArrow) {
        setDownloadSelectedIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setDownloadSelectedIndex(prev => Math.min(filteredAvailableCores.length - 1, prev + 1));
        return;
      }
      // Download with Enter
      if (key.return && filteredAvailableCores[downloadSelectedIndex]) {
        void handleDownloadCore(filteredAvailableCores[downloadSelectedIndex]);
        return;
      }
      // Toggle show all cores
      if (input === 'a' || input === 'A') {
        setShowAllCores(prev => !prev);
        setDownloadSelectedIndex(0);
        return;
      }
      // Refresh available cores
      if (input === 'r' || input === 'R') {
        setHasAttemptedLoad(false);
        setLoadError(null);
        void loadAvailableCores();
        return;
      }
    }
  });

  // Gamepad support
  useGamepadContext({
    onUp: () => {
      if (confirmDelete || downloadingCore || installError) { return; }
      if (activeTab === TAB_INSTALLED) {
        setInstalledSelectedIndex(prev => Math.max(0, prev - 1));
      } else {
        setDownloadSelectedIndex(prev => Math.max(0, prev - 1));
      }
    },
    onDown: () => {
      if (confirmDelete || downloadingCore || installError) { return; }
      if (activeTab === TAB_INSTALLED) {
        setInstalledSelectedIndex(prev => Math.min(installedCores.length - 1, prev + 1));
      } else {
        setDownloadSelectedIndex(prev => Math.min(filteredAvailableCores.length - 1, prev + 1));
      }
    },
    onLeft: () => {
      if (confirmDelete || downloadingCore || installError) { return; }
      setActiveTab(TAB_INSTALLED);
    },
    onRight: () => {
      if (confirmDelete || downloadingCore || installError) { return; }
      setActiveTab(TAB_DOWNLOAD);
    },
    onConfirm: () => {
      if (confirmDelete) {
        void handleDeleteCore(confirmDelete);
        return;
      }
      if (showCoreInfo) {
        setShowCoreInfo(null);
        return;
      }
      if (installError) {
        const coreToRetry = installError.core;
        setInstallError(null);
        void handleDownloadCore(coreToRetry);
        return;
      }
      if (downloadingCore) { return; }
      if (activeTab === TAB_INSTALLED && installedCores[installedSelectedIndex]) {
        const core = installedCores[installedSelectedIndex];
        if (core.canDelete) {
          setConfirmDelete(core);
        } else {
          setShowCoreInfo(core);
        }
      } else if (activeTab === TAB_DOWNLOAD && filteredAvailableCores[downloadSelectedIndex]) {
        void handleDownloadCore(filteredAvailableCores[downloadSelectedIndex]);
      }
    },
    onCancel: () => {
      if (confirmDelete) {
        setConfirmDelete(null);
        return;
      }
      if (showCoreInfo) {
        setShowCoreInfo(null);
        return;
      }
      if (installError) {
        setInstallError(null);
        return;
      }
      if (downloadingCore) { return; }
      onClose();
    },
  });

  // Wait for terminal clear
  if (!ready) {
    return null;
  }

  // Delete confirmation dialog
  if (confirmDelete) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="yellow">{'\u26A0'} Delete Core</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="white">Are you sure you want to delete {confirmDelete.name}?</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="gray">{confirmDelete.path}</Text>
        </Box>

        <Box marginTop={1}>
          <Box marginRight={2}>
            <Text color="red" bold>[Y]</Text>
            <Text color="gray"> Delete</Text>
          </Box>
          <Box>
            <Text color="green" bold>[N]</Text>
            <Text color="gray"> Cancel</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // Core info dialog (for non-deletable cores)
  if (showCoreInfo) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{'\u2139'} Core Info</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="white" bold>{showCoreInfo.name}</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="gray">{showCoreInfo.systemDescription}</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="gray" dimColor>
            {'This core was not installed by emoemu and cannot be removed from here.'}
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color="gray" dimColor>Press Enter or ESC to close</Text>
        </Box>
      </Box>
    );
  }

  // Download progress overlay
  if (downloadingCore) {
    const progressPercent = downloadProgress?.totalBytes
      ? Math.round((downloadProgress.bytesDownloaded / downloadProgress.totalBytes) * PROGRESS_FULL)
      : 0;

    const isBuilding = downloadProgress?.phase === 'building';
    const headerText = isBuilding ? 'Building Core' : 'Downloading Core';
    const headerEmoji = isBuilding ? '\u{1F6E0}' : '\u{1F4E5}';  // 🛠 vs 📥
    const statusText = isBuilding
      ? `Building ${downloadingCore} from source...`
      : `Downloading ${downloadingCore}...`;

    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{headerEmoji} {headerText}</Text>
        </Box>

        <Box marginBottom={1}>
          <Text>{statusText}</Text>
        </Box>

        {downloadProgress?.phase === 'downloading' && downloadProgress.totalBytes && (
          <Box marginBottom={1}>
            <ProgressBar value={progressPercent} />
            <Text color="gray"> {progressPercent}%</Text>
          </Box>
        )}

        {downloadProgress?.phase === 'downloading' && !downloadProgress.totalBytes && (
          <Box marginBottom={1}>
            <Spinner label={`${Math.round(downloadProgress.bytesDownloaded / BYTES_PER_KB)} KB downloaded`} />
          </Box>
        )}

        {downloadProgress?.phase === 'extracting' && (
          <Box marginBottom={1}>
            <Spinner label="Extracting..." />
          </Box>
        )}

        {downloadProgress?.phase === 'building' && (
          <Box marginBottom={1} flexDirection="column">
            {downloadProgress.buildProgressPercent !== undefined ? (
              <>
                <Box>
                  <ProgressBar value={downloadProgress.buildProgressPercent} />
                  <Text color="gray"> {downloadProgress.buildProgressPercent}%</Text>
                </Box>
                <Box marginTop={1}>
                  <Text color="gray" dimColor>
                    {downloadProgress.buildMessage ?? 'Building...'}
                  </Text>
                </Box>
              </>
            ) : (
              <Spinner label={downloadProgress.buildMessage ?? 'Building from source...'} />
            )}
          </Box>
        )}
      </Box>
    );
  }

  // Install error screen
  if (installError) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          <Text bold color="red">{'\u{274C}'} Installation Failed</Text>
        </Box>

        <Box marginBottom={1}>
          <Text>Failed to install <Text bold>{installError.core.name}</Text></Text>
        </Box>

        <Box marginBottom={1} flexDirection="column">
          <Text color="gray">Error:</Text>
          <Text color="red">{installError.message}</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="cyan">[R] Retry</Text>
          <Text color="gray">[C] Cancel</Text>
        </Box>
      </Box>
    );
  }

  // Calculate scroll offsets
  const installedScrollOffset = getScrollOffset(installedSelectedIndex, installedCores.length);
  const downloadScrollOffset = getScrollOffset(downloadSelectedIndex, filteredAvailableCores.length);

  // Visible items for installed tab
  const visibleInstalledCores = installedCores.slice(
    installedScrollOffset,
    installedScrollOffset + MAX_VISIBLE_ITEMS
  );

  // Visible items for download tab
  const visibleDownloadCores = filteredAvailableCores.slice(
    downloadScrollOffset,
    downloadScrollOffset + MAX_VISIBLE_ITEMS
  );

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">{'\u{1F9E9}'} Manage Cores</Text>
      </Box>

      {/* Tabs */}
      <Box marginBottom={1}>
        <Box marginRight={2}>
          <Text
            backgroundColor={activeTab === TAB_INSTALLED ? 'cyan' : undefined}
            color={activeTab === TAB_INSTALLED ? 'black' : 'gray'}
            bold={activeTab === TAB_INSTALLED}
          >
            {' '}Installed ({installedCores.length}){' '}
          </Text>
        </Box>
        <Box>
          <Text
            backgroundColor={activeTab === TAB_DOWNLOAD ? 'cyan' : undefined}
            color={activeTab === TAB_DOWNLOAD ? 'black' : 'gray'}
            bold={activeTab === TAB_DOWNLOAD}
          >
            {' '}Download{' '}
          </Text>
        </Box>
      </Box>

      {/* Tab content */}
      {activeTab === TAB_INSTALLED ? (
        <Box flexDirection="column">
          {installedCores.length === 0 ? (
            <Text color="gray">No cores installed</Text>
          ) : (
            <>
              {/* Scroll indicator - top */}
              {installedScrollOffset > 0 && (
                <Box>
                  <Text color="gray" dimColor>  {'\u25B2'} {installedScrollOffset} more above</Text>
                </Box>
              )}

              {visibleInstalledCores.map((core, index) => {
                const globalIndex = installedScrollOffset + index;
                const isSelected = globalIndex === installedSelectedIndex;
                return (
                  <Box key={core.id} flexDirection="column">
                    <Box>
                      <Text
                        color={isSelected ? 'cyan' : 'white'}
                        bold={isSelected}
                      >
                        {isSelected ? '\u25B6 ' : '  '}
                        {core.name}
                      </Text>
                    </Box>
                    <Box marginLeft={4}>
                      <Text color="gray" dimColor>{core.systemDescription}</Text>
                    </Box>
                  </Box>
                );
              })}

              {/* Scroll indicator - bottom */}
              {installedScrollOffset + MAX_VISIBLE_ITEMS < installedCores.length && (
                <Box>
                  <Text color="gray" dimColor>
                    {'  '}{'\u25BC'} {installedCores.length - installedScrollOffset - MAX_VISIBLE_ITEMS} more below
                  </Text>
                </Box>
              )}
            </>
          )}
        </Box>
      ) : (
        <Box flexDirection="column">
          {isLoadingCores ? (
            <Spinner label="Loading available cores..." />
          ) : loadError ? (
            <Box flexDirection="column">
              <Text color="red">Error: {loadError}</Text>
              <Text color="gray" dimColor>Press R to retry</Text>
            </Box>
          ) : filteredAvailableCores.length === 0 ? (
            <Box flexDirection="column">
              <Text color="gray">
                {showAllCores ? 'All cores are already installed' : 'All recommended cores are installed'}
              </Text>
              {!showAllCores && hiddenCoresCount > 0 && (
                <Text color="gray" dimColor>Press A to show {hiddenCoresCount} additional cores</Text>
              )}
            </Box>
          ) : (
            <>
              {/* Show all toggle info */}
              {!showAllCores && hiddenCoresCount > 0 && (
                <Box marginBottom={1}>
                  <Text color="gray" dimColor>
                    Showing recommended cores. Press A to show {hiddenCoresCount} more.
                  </Text>
                </Box>
              )}
              {showAllCores && (
                <Box marginBottom={1}>
                  <Text color="gray" dimColor>
                    Showing all cores. Press A to show recommended only.
                  </Text>
                </Box>
              )}

              {/* Scroll indicator - top */}
              {downloadScrollOffset > 0 && (
                <Box>
                  <Text color="gray" dimColor>  {'\u25B2'} {downloadScrollOffset} more above</Text>
                </Box>
              )}

              {visibleDownloadCores.map((core, index) => {
                const globalIndex = downloadScrollOffset + index;
                const isSelected = globalIndex === downloadSelectedIndex;
                return (
                  <Box key={core.name} flexDirection="column">
                    <Box>
                      <Text
                        color={isSelected ? 'cyan' : 'white'}
                        bold={isSelected}
                      >
                        {isSelected ? '\u25B6 ' : '  '}
                        {core.name}
                      </Text>
                      {RECOMMENDED_CORE_NAMES.has(core.name) && (
                        <Text color="yellow"> {'\u2605'}</Text>
                      )}
                    </Box>
                    {core.description && (
                      <Box marginLeft={4}>
                        <Text color="gray" dimColor>{core.description}</Text>
                      </Box>
                    )}
                  </Box>
                );
              })}

              {/* Scroll indicator - bottom */}
              {downloadScrollOffset + MAX_VISIBLE_ITEMS < filteredAvailableCores.length && (
                <Box>
                  <Text color="gray" dimColor>
                    {'  '}{'\u25BC'} {filteredAvailableCores.length - downloadScrollOffset - MAX_VISIBLE_ITEMS} more below
                  </Text>
                </Box>
              )}
            </>
          )}
        </Box>
      )}

      {/* Help text */}
      <Box marginTop={1} flexDirection="column">
        <Text color="gray" dimColor>
          {'\u2190\u2192'}/Tab: Switch tabs  {'\u2191\u2193'}: Navigate  ESC: Close
        </Text>
        {activeTab === TAB_INSTALLED && (
          <Text color="gray" dimColor>
            Enter: Remove selected core
          </Text>
        )}
        {activeTab === TAB_DOWNLOAD && (
          <Text color="gray" dimColor>
            Enter: Download  A: Toggle all cores  R: Refresh
          </Text>
        )}
      </Box>

    </Box>
  );
};
