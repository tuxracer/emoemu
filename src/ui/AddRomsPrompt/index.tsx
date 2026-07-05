/**
 * Add ROMs Prompt Component
 *
 * Shared component for adding ROMs to the library. Used both when no playlists
 * exist (initial setup) and from the ROM browser's "Add ROMs" action.
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { Spinner, ProgressBar, TextInput } from '@inkjs/ui';
import { readdirSync, statSync } from 'fs';
import { resolve, dirname, basename, join } from 'path';
import { ScanCancelledError, validateRomFile } from '../../frontend/romScanner';
import { getSupportedSystems, getSupportedExtensions } from '../../frontend/coreRegistry';
import type { ScanProgress } from '../../frontend/romScanner';
import { useGamepadContext } from '../GamepadContext';
import {
  findPlaylistsForDirectory,
  generatePlaylistsBySystem,
  buildPlaylistIndex,
  normalizePath,
  analyzePlaylistSync,
  syncPlaylists,
  resolvePath,
} from '../../frontend/playlist';
import type { PlaylistInfo, DuplicateDecision } from '../../frontend/playlist';
import { showDuplicateCrcPrompt } from '../DuplicateCrcPrompt';
import {
  PROGRESS_FULL,
  PROGRESS_MULTIPLIER,
  MAX_PATH_SUGGESTIONS,
  MENU_DIRECTORY,
  MENU_IMPORT,
  MENU_EXIT,
} from './consts';
import { getErrorMessage } from '../../utils/getErrorMessage';

export * from './consts';

export interface AddRomsPromptProps {
  directory: string;
  playlistDirectory: string;
  scanDepth: number;
  onPlaylistGenerated: (playlists: PlaylistInfo[]) => void;
  onExit: () => void;
  /** If true, automatically start importing without showing the prompt UI */
  autoImport?: boolean;
  /** If true, exit the entire app when cancel is pressed (default: false) */
  exitAppOnCancel?: boolean;
}

/** System breakdown for import results */
interface SystemCount {
  system: string;
  count: number;
}

/**
 * Get path suggestions based on current input path (directories and ROM files)
 */
const getPathSuggestions = (inputPath: string): string[] => {
  const supportedExtensions = new Set(getSupportedExtensions());

  const isRomFile = (entry: string): boolean => {
    const ext = '.' + entry.split('.').pop()?.toLowerCase();
    return supportedExtensions.has(ext);
  };

  const isValidEntry = (fullPath: string): boolean => {
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        return true;
      }
      // Only suggest ROM files
      return stat.isFile() && isRomFile(fullPath);
    } catch {
      return false;
    }
  };

  try {
    const resolvedPath = resolve(inputPath);

    // Check if the input path itself is a directory
    try {
      const stat = statSync(resolvedPath);
      if (stat.isDirectory()) {
        // List contents of this directory (directories first, then ROM files)
        const entries = readdirSync(resolvedPath);
        const dirs: string[] = [];
        const files: string[] = [];

        for (const entry of entries) {
          if (entry.startsWith('.')) {continue;} // Hide hidden entries
          const fullPath = join(resolvedPath, entry);
          try {
            const entryStat = statSync(fullPath);
            if (entryStat.isDirectory()) {
              dirs.push(fullPath);
            } else if (entryStat.isFile() && isRomFile(entry)) {
              files.push(fullPath);
            }
          } catch {
            // Skip inaccessible entries
          }
        }

        // Return directories first, then ROM files
        return [...dirs, ...files].slice(0, MAX_PATH_SUGGESTIONS);
      }
    } catch {
      // Path doesn't exist as-is, try parent directory
    }

    // Get the parent directory and filter by basename prefix
    const parentDir = dirname(resolvedPath);
    const prefix = basename(resolvedPath).toLowerCase();

    try {
      const entries = readdirSync(parentDir);
      const dirs: string[] = [];
      const files: string[] = [];

      for (const entry of entries) {
        if (entry.startsWith('.')) {continue;} // Hide hidden entries
        if (!entry.toLowerCase().startsWith(prefix)) {continue;}
        const fullPath = join(parentDir, entry);
        if (isValidEntry(fullPath)) {
          try {
            const stat = statSync(fullPath);
            if (stat.isDirectory()) {
              dirs.push(fullPath);
            } else {
              files.push(fullPath);
            }
          } catch {
            // Skip
          }
        }
      }

      return [...dirs, ...files].slice(0, MAX_PATH_SUGGESTIONS);
    } catch {
      return [];
    }
  } catch {
    return [];
  }
};

/** Result of the import operation */
interface ImportResult {
  totalFiles: number;
  romsFound: number;
  romsAdded: number;
  alreadyInLibrary: number;
  filesSkipped: number;
  /** Number of playlist entries removed (files no longer exist) */
  removed: number;
  /** Number of entries updated (moved ROMs with path changes) */
  moved: number;
  /** Number of duplicate entries where path was updated */
  duplicatesUpdated: number;
  /** Number of duplicate entries that were skipped */
  duplicatesSkipped: number;
  playlists: PlaylistInfo[];
  systems: SystemCount[];
}

export const AddRomsPrompt = ({
  directory,
  playlistDirectory,
  scanDepth,
  onPlaylistGenerated,
  onExit,
  autoImport = false,
  exitAppOnCancel = false,
}: AddRomsPromptProps) => {
  const { exit } = useApp();
  const [selectedPath, setSelectedDirectory] = useState(directory);
  const [inputKey, setInputKey] = useState(0); // Key to force TextInput re-render
  const [hasTyped, setHasTyped] = useState(false); // Track if user has typed in current session
  const [selectedIndex, setSelectedIndex] = useState(MENU_IMPORT); // Default to Add to Library
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const progressRef = useRef<ScanProgress | null>(null);

  // Get path suggestions based on current input (only if user has typed)
  const pathSuggestions = useMemo(
    () => hasTyped ? getPathSuggestions(selectedPath) : [],
    [selectedPath, hasTyped]
  );

  // Handle directory input changes
  const handlePathChange = useCallback((value: string) => {
    setSelectedDirectory(value);
    setHasTyped(true);
  }, []);

  const isEditingPath = selectedIndex === MENU_DIRECTORY;

  const cancelImport = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const handleGenerate = useCallback(async () => {
    const targetPath = resolve(selectedPath);

    // Check if path exists
    let pathStat: ReturnType<typeof statSync>;
    try {
      pathStat = statSync(targetPath);
    } catch {
      setError('Path does not exist');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setProgress(null);
    setImportResult(null);

    // Build playlist index to check for existing ROMs
    const playlistIndex = buildPlaylistIndex(playlistDirectory);

    // Handle single file
    if (pathStat.isFile()) {
      const result = validateRomFile(targetPath);
      if (!result.valid) {
        setError(result.message);
        setIsGenerating(false);
        return;
      }

      const rom = result.rom;

      // Check if ROM is already in library
      const normalizedPath = normalizePath(targetPath);
      if (playlistIndex.has(normalizedPath)) {
        // ROM already in library - show success with 0 added
        const playlists = findPlaylistsForDirectory(dirname(targetPath), playlistDirectory);
        setImportResult({
          totalFiles: 1,
          romsFound: 1,
          romsAdded: 0,
          alreadyInLibrary: 1,
          filesSkipped: 0,
          removed: 0,
          moved: 0,
          duplicatesUpdated: 0,
          duplicatesSkipped: 0,
          playlists,
          systems: [{ system: rom.system, count: 1 }],
        });
        setIsGenerating(false);
        return;
      }

      // Add single ROM to playlist
      const results = generatePlaylistsBySystem([rom], playlistDirectory);

      const failures = results.filter(r => !r.success);
      if (failures.length > 0) {
        setError(`Failed to add ROM to library: ${failures[0].error}`);
        setIsGenerating(false);
        return;
      }

      // Find playlists for the ROM's directory
      const playlists = findPlaylistsForDirectory(dirname(targetPath), playlistDirectory);

      setImportResult({
        totalFiles: 1,
        romsFound: 1,
        romsAdded: 1,
        alreadyInLibrary: 0,
        filesSkipped: 0,
        removed: 0,
        moved: 0,
        duplicatesUpdated: 0,
        duplicatesSkipped: 0,
        playlists,
        systems: [{ system: rom.system, count: 1 }],
      });
      setIsGenerating(false);
      return;
    }

    // Handle directory
    if (!pathStat.isDirectory()) {
      setError('Path is not a file or directory');
      setIsGenerating(false);
      return;
    }

    // Create new abort controller for this scan
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    try {
      // Analyze the directory for sync needs (new ROMs, missing entries, moved files)
      const analysis = await analyzePlaylistSync(
        targetPath,
        playlistDirectory,
        scanDepth,
        (scanProgress) => {
          progressRef.current = scanProgress;
          setProgress(scanProgress);
        },
        signal
      );

      // Calculate totals from ref (state may not be updated yet due to React batching)
      const finalProgress = progressRef.current;
      const totalFiles = finalProgress?.total ?? 0;
      const romsFound = finalProgress?.romsFound ?? 0;
      const alreadyInLibrary = romsFound - analysis.newRoms.length - analysis.movedRoms.length;

      // Check if there are no ROMs at all and nothing in playlists to clean up
      if (romsFound === 0 && analysis.missingEntries.length === 0 && analysis.newRoms.length === 0) {
        setError('No supported ROMs found in this directory');
        setIsGenerating(false);
        return;
      }

      // If nothing needs to sync, show "all in library" message
      if (!analysis.needsSync) {
        const playlists = findPlaylistsForDirectory(targetPath, playlistDirectory);

        // For "all in library" case, we don't show system breakdown since we only have counts
        const systems: SystemCount[] = [];

        setImportResult({
          totalFiles,
          romsFound,
          romsAdded: 0,
          alreadyInLibrary,
          filesSkipped: totalFiles - romsFound,
          removed: 0,
          moved: 0,
          duplicatesUpdated: 0,
          duplicatesSkipped: 0,
          playlists,
          systems,
        });
        setIsGenerating(false);
        return;
      }

      // Handle duplicate CRC ROMs by prompting the user
      const duplicateDecisions: DuplicateDecision[] = [];
      if (analysis.duplicateCrcRoms.length > 0) {
        for (const duplicate of analysis.duplicateCrcRoms) {
          const existingPath = resolvePath(
            duplicate.existingEntry.entry.path,
            dirname(duplicate.existingEntry.playlistPath)
          );
          const choice = await showDuplicateCrcPrompt({
            newPath: duplicate.newRom.path,
            existingPath,
            label: duplicate.existingEntry.entry.label,
            crc32: duplicate.crc32,
          });
          duplicateDecisions.push({ duplicate, choice });
        }
      }

      // Apply the sync changes (add new, remove missing, update moved, handle duplicates)
      const syncResult = syncPlaylists(analysis, targetPath, playlistDirectory, {}, duplicateDecisions);

      if (!syncResult.success && syncResult.errors.length > 0) {
        setError(`Sync completed with errors: ${syncResult.errors[0]}`);
        // Continue to show results even with errors
      }

      // Find the updated playlists
      const playlists = findPlaylistsForDirectory(targetPath, playlistDirectory);

      // Count new ROMs by system
      const systemMap = new Map<string, number>();
      for (const rom of analysis.newRoms) {
        const count = systemMap.get(rom.system) ?? 0;
        systemMap.set(rom.system, count + 1);
      }
      const systems: SystemCount[] = Array.from(systemMap.entries())
        .map(([system, count]) => ({ system, count }))
        .sort((a, b) => b.count - a.count);

      // Show completion summary
      setImportResult({
        totalFiles,
        romsFound,
        romsAdded: syncResult.added,
        alreadyInLibrary,
        filesSkipped: totalFiles - romsFound,
        removed: syncResult.removed,
        moved: syncResult.moved,
        duplicatesUpdated: syncResult.duplicatesUpdated,
        duplicatesSkipped: syncResult.duplicatesSkipped,
        playlists,
        systems,
      });
      setIsGenerating(false);
    } catch (err) {
      // If cancelled, just return to prompt without error
      if (err instanceof ScanCancelledError) {
        setIsGenerating(false);
        return;
      }
      setError(getErrorMessage(err));
      setIsGenerating(false);
    }
  }, [selectedPath, scanDepth, playlistDirectory]);

  // Auto-trigger import when autoImport is true (CLI path provided)
  useEffect(() => {
    if (autoImport && !isGenerating && !importResult && !error) {
      void handleGenerate();
    }
  }, [autoImport, handleGenerate, isGenerating, importResult, error]);

  // Auto-continue when autoImport is true and import completes (skip summary screen)
  useEffect(() => {
    if (autoImport && importResult) {
      onPlaylistGenerated(importResult.playlists);
      exit();  // Close the Ink app so importDirectory can continue
    }
  }, [autoImport, importResult, onPlaylistGenerated, exit]);

  useInput((input, key) => {
    // Allow cancellation during import
    if (isGenerating) {
      if (key.escape) {
        cancelImport();
      }
      return;
    }

    // Handle completion screen - any key to continue
    if (importResult) {
      onPlaylistGenerated(importResult.playlists);
      return;
    }

    // When editing path, only handle navigation keys
    if (isEditingPath) {
      // Tab or Right arrow accepts the first suggestion
      if (key.tab || key.rightArrow) {
        if (pathSuggestions.length > 0) {
          setSelectedDirectory(pathSuggestions[0]);
          setInputKey(prev => prev + 1); // Force TextInput re-render
        }
        return;
      }
      // Enter accepts the user-typed value (not autocomplete) and moves to Import
      if (key.return) {
        setSelectedIndex(MENU_IMPORT);
        setHasTyped(false);
        setInputKey(prev => prev + 1); // Force TextInput re-render to clear suggestion highlight
        return;
      }
      if (key.downArrow) {
        setSelectedIndex(MENU_IMPORT);
        setHasTyped(false);
        return;
      }
      if (key.escape) {
        setSelectedIndex(MENU_IMPORT);
        setHasTyped(false);
        return;
      }
      // Let TextInput handle all other input
      return;
    }

    if (key.escape) {
      onExit();
      if (exitAppOnCancel) {
        exit();
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(MENU_DIRECTORY, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(prev => Math.min(MENU_EXIT, prev + 1));
      return;
    }

    if (key.return || input === ' ') {
      if (selectedIndex === MENU_IMPORT) {
        void handleGenerate();
      } else if (selectedIndex === MENU_EXIT) {
        onExit();
        if (exitAppOnCancel) {
          exit();
        }
      }
    }
  });

  useGamepadContext({
    onUp: () => {
      if (isGenerating || importResult || isEditingPath) {return;}
      setSelectedIndex(prev => Math.max(MENU_DIRECTORY, prev - 1));
    },
    onDown: () => {
      if (isGenerating || importResult) {return;}
      if (isEditingPath) {
        setSelectedIndex(MENU_IMPORT);
        setHasTyped(false);
        return;
      }
      setSelectedIndex(prev => Math.min(MENU_EXIT, prev + 1));
    },
    onConfirm: () => {
      if (isGenerating || isEditingPath) {return;}
      if (importResult) {
        onPlaylistGenerated(importResult.playlists);
        return;
      }
      if (selectedIndex === MENU_IMPORT) {
        void handleGenerate();
      } else if (selectedIndex === MENU_EXIT) {
        onExit();
        if (exitAppOnCancel) {
          exit();
        }
      }
    },
    onCancel: () => {
      // Allow cancellation during import
      if (isGenerating) {
        cancelImport();
        return;
      }
      // Exit path editing mode
      if (isEditingPath) {
        setSelectedIndex(MENU_IMPORT);
        setHasTyped(false);
        return;
      }
      if (importResult) {
        onPlaylistGenerated(importResult.playlists);
        return;
      }
      onExit();
      if (exitAppOnCancel) {
        exit();
      }
    },
    // Start mirrors Enter/confirm via the shared onConfirm fallback in GamepadContext
  });

  if (isGenerating) {
    if (progress) {
      // Show determinate progress when total is known, indeterminate otherwise
      const totalCount = progress.total;
      const hasTotalCount = totalCount !== undefined && totalCount > 0;
      const progressPercent = hasTotalCount
        ? Math.round((progress.processed / totalCount) * PROGRESS_MULTIPLIER)
        : undefined;

      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text color="cyan">Looking for ROMs...</Text>
          </Box>
          {progressPercent !== undefined && (
            <Box marginBottom={1}>
              <ProgressBar value={progressPercent} />
            </Box>
          )}
          <Box marginBottom={1}>
            <Text color="gray">
              {hasTotalCount
                ? `${progress.processed} of ${totalCount} files checked`
                : `${progress.processed} files checked`}
              {progress.romsFound > 0 && <Text color="green"> ({progress.romsFound} ROMs found)</Text>}
            </Text>
          </Box>
          <Box marginBottom={1}>
            <Text color="gray" dimColor wrap="truncate-end">
              {progress.currentFile}
            </Text>
          </Box>
          <Box>
            <Text color="gray" dimColor>
              Press <Text color="yellow">ESC</Text> to cancel
            </Text>
          </Box>
        </Box>
      );
    }
    return (
      <Box padding={1}>
        <Spinner label="Preparing..." />
      </Box>
    );
  }

  // Show completion summary (skip when autoImport - useEffect will auto-continue)
  if (importResult) {
    // When autoImport is true, skip the summary - the useEffect will call onPlaylistGenerated
    if (autoImport) {
      return null;
    }

    const noChanges = importResult.romsAdded === 0 && importResult.removed === 0 && importResult.moved === 0 && importResult.duplicatesUpdated === 0;
    const allAlreadyInLibrary = noChanges && importResult.alreadyInLibrary > 0;
    const someAlreadyInLibrary = importResult.romsAdded > 0 && importResult.alreadyInLibrary > 0;
    const hasChanges = importResult.romsAdded > 0 || importResult.removed > 0 || importResult.moved > 0 || importResult.duplicatesUpdated > 0;

    return (
      <Box flexDirection="column" padding={1}>
        <Box marginBottom={1}>
          {allAlreadyInLibrary ? (
            <Text bold color="cyan">{'\u2714'} All Games in Library</Text>
          ) : (
            <Text bold color="green">{'\u2714'} Sync Complete</Text>
          )}
        </Box>
        <Box marginBottom={1}>
          <ProgressBar value={PROGRESS_FULL} />
        </Box>
        <Box flexDirection="column" marginBottom={1}>
          {allAlreadyInLibrary ? (
            <Text color="white">
              All <Text color="cyan" bold>{importResult.alreadyInLibrary}</Text> ROM{importResult.alreadyInLibrary !== 1 ? 's' : ''} already in your library
            </Text>
          ) : (
            <>
              {importResult.romsAdded > 0 && (
                <Text color="white">
                  <Text color="green" bold>{importResult.romsAdded}</Text> ROM{importResult.romsAdded !== 1 ? 's' : ''} detected
                </Text>
              )}
              {importResult.removed > 0 && (
                <Text color="white">
                  <Text color="yellow" bold>{importResult.removed}</Text> missing ROM{importResult.removed !== 1 ? 's' : ''} removed from library
                </Text>
              )}
              {importResult.moved > 0 && (
                <Text color="white">
                  <Text color="blue" bold>{importResult.moved}</Text> ROM{importResult.moved !== 1 ? 's' : ''} moved (paths updated)
                </Text>
              )}
              {importResult.duplicatesUpdated > 0 && (
                <Text color="white">
                  <Text color="magenta" bold>{importResult.duplicatesUpdated}</Text> duplicate ROM{importResult.duplicatesUpdated !== 1 ? 's' : ''} updated to new path
                </Text>
              )}
              {importResult.duplicatesSkipped > 0 && (
                <Text color="gray">
                  {importResult.duplicatesSkipped} duplicate{importResult.duplicatesSkipped !== 1 ? 's' : ''} skipped (kept existing)
                </Text>
              )}
              {someAlreadyInLibrary && (
                <Text color="gray">
                  {importResult.alreadyInLibrary} already in library (skipped)
                </Text>
              )}
            </>
          )}
          {importResult.filesSkipped > 0 && (
            <Text color="gray">
              {importResult.filesSkipped} file{importResult.filesSkipped !== 1 ? 's' : ''} skipped (not recognized as ROMs)
            </Text>
          )}
        </Box>
        {importResult.systems.length > 0 && hasChanges && (
          <Box flexDirection="column" marginBottom={1}>
            <Text color="white" bold>ROMs found for:</Text>
            {importResult.systems.map(({ system, count }) => (
              <Text key={system} color="gray">
                {'  '}<Text color="cyan">{system}</Text>: {count} ROM{count !== 1 ? 's' : ''}
              </Text>
            ))}
          </Box>
        )}
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            Press any key to continue
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{'\u{1F4C2}'} Add ROMs</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {/* Path input */}
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text color={isEditingPath ? 'cyan' : 'white'} bold={isEditingPath}>
              {isEditingPath ? '\u25B6 ' : '  '}Path:{' '}
            </Text>
            <TextInput
              key={inputKey}
              defaultValue={selectedPath}
              suggestions={pathSuggestions}
              onChange={handlePathChange}
              isDisabled={!isEditingPath}
            />
          </Box>
          {isEditingPath && (
            <Text color="gray" dimColor>    Path to ROM file or directory</Text>
          )}
        </Box>

        {/* Add to Library option */}
        <Box flexDirection="column">
          <Text
            color={selectedIndex === MENU_IMPORT ? 'cyan' : 'white'}
            bold={selectedIndex === MENU_IMPORT}
          >
            {selectedIndex === MENU_IMPORT ? '\u25B6 ' : '  '}Add to Library
          </Text>
          {selectedIndex === MENU_IMPORT && (
            <Text color="gray" dimColor>    Your ROM files will stay where they are</Text>
          )}
        </Box>

        {/* Exit option */}
        <Box flexDirection="column">
          <Text
            color={selectedIndex === MENU_EXIT ? 'red' : 'red'}
            bold={selectedIndex === MENU_EXIT}
          >
            {selectedIndex === MENU_EXIT ? '\u25B6 ' : '  '}Cancel
          </Text>
          {selectedIndex === MENU_EXIT && (
            <Text color="gray" dimColor>    Return to ROM browser</Text>
          )}
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray" dimColor>
          Supported: {getSupportedSystems().join(', ')}
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">{'\u2717'} {error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {isEditingPath
            ? 'Tab/\u2192: Autocomplete  \u23CE: Confirm  \u2193/ESC: Menu'
            : '\u2191\u2193: Navigate  \u23CE/A: Select  ESC/B: Cancel'}
        </Text>
      </Box>
    </Box>
  );
};

export default AddRomsPrompt;
