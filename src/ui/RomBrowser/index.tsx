/**
 * ROM Browser UI Component
 *
 * A beautiful terminal UI for browsing and selecting ROMs.
 */

import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { Box, Text, useInput, useApp, useStdin, useStdout } from 'ink';
import { filter } from 'remeda';
import type { RomInfo, ThumbnailResult } from '../../frontend/romScanner';
import { loadAnyThumbnail } from '../../frontend/romScanner';
import type { SaveStateDetails } from '../../frontend/saveServices';
import { getSaveStateService } from '../../frontend/serviceProvider';
import { buildKittyImageSequence, buildKittyDeleteSequence, buildCursorPositionSequence } from '../../utils/kitty';
import {
  renderThumbnailHalfBlocks,
  buildThumbnailSequence,
  buildThumbnailClearSequence,
  type RenderedThumbnail,
} from '../../utils/thumbnailRenderer';
import { updateLastPlayed } from '../../frontend/playlist';
import { AddRomsPrompt } from '../AddRomsPrompt';
import { CoreManager } from '../CoreManager';
import { getSupportedExtensions } from '../../frontend/coreRegistry';
import { formatRuntimeSeconds } from '../../utils/format';
import { useGamepadContext } from '../GamepadContext';
import { useKittyGraphicsSupported } from '../AppCapabilities';
import { useConfig } from '../ConfigContext';
import {
  DEFAULT_TERM_WIDTH,
  DEFAULT_TERM_HEIGHT,
} from '..';
import {
  THUMBNAIL_LOAD_DELAY_MS,
  THUMBNAIL_KITTY_IMAGE_ID,
  THUMBNAIL_DISPLAY_COLS,
  THUMBNAIL_DISPLAY_ROWS,
  ROM_MIN_DISPLAY_WIDTH,
  ROM_LIST_HEADER_ROWS,
  ROM_META_LABEL_WIDTH,
  ROM_PANEL_BORDER_PADDING,
  ROM_SEPARATOR_MAX_WIDTH,
  ROM_SEPARATOR_PADDING,
  ROM_OPTIONS_PANEL_ROWS,
  PERCENT_60,
  PERCENT_40,
  SEARCH_DEBOUNCE_MS,
  MOUSE_BUFFER_MAX_SIZE,
} from './consts';
import type { RomBrowserProps, ActionButtonDef, MetadataPanelProps } from './types';
import { NetplayPanel } from './NetplayPanel';
import { SettingsPanel } from './SettingsPanel';

export * from './types';
export * from './consts';

// Mouse tracking escape sequences (SGR mode 1006 for extended coordinates)
const ENABLE_MOUSE = '\x1b[?1000h\x1b[?1006h';
const DISABLE_MOUSE = '\x1b[?1000l\x1b[?1006l';

const actionButtons: ActionButtonDef[] = [
  { id: 'add-roms', label: 'Add ROMs', icon: '\u{1F4C2}' },
  { id: 'manage-cores', label: 'Manage Cores', icon: '\u{1F9E9}' },  // Puzzle piece
  { id: 'netplay', label: 'Netplay', icon: '\u{1F310}' },  // Globe icon
  { id: 'settings', label: 'Settings', icon: '\u2699' },
];

// Action button component
const ActionButton = ({ button, isSelected, isFocused, highlightBg, highlightFg }: {
  button: ActionButtonDef;
  isSelected: boolean;
  isFocused: boolean;
  highlightBg: string;
  highlightFg: string;
}) => {
  const showHighlight = isSelected && isFocused;
  return (
    <Box marginRight={1}>
      <Text
        backgroundColor={showHighlight ? highlightBg : undefined}
        color={showHighlight ? highlightFg : isSelected ? 'cyan' : 'gray'}
        bold={showHighlight}
      >
        {' '}{button.icon} {button.label}{' '}
      </Text>
    </Box>
  );
};

// Color schemes for different systems
const systemColors: Record<string, string> = {
  'Nintendo Entertainment System': 'red',
  'Game Boy': 'green',
  'Game Boy Color': 'magenta',
  'Super Nintendo': 'blue',
  'Sega Genesis': 'cyan',
  'Sega Master System': 'cyan',
  'Sega Game Gear': 'cyan',
  'Game Boy Advance': 'magenta',
  'PC Engine': 'yellow',
};

const getSystemColor = (system: string): string => systemColors[system] ?? 'white';

// Truncate string to fit width
const truncate = (str: string, maxLength: number): string => {
  if (str.length <= maxLength) {return str;}
  return str.slice(0, maxLength - 1) + '\u2026';
};

/**
 * Filter ROMs by case-insensitive substring match on filename, title, or system
 */
const filterRoms = (roms: RomInfo[], query: string): RomInfo[] => {
  const trimmed = query.trim();
  if (!trimmed) {return roms;}

  const lowerQuery = trimmed.toLowerCase();

  const matchesQuery = (text: string | undefined): boolean =>
    text !== undefined && text.toLowerCase().includes(lowerQuery);

  return filter(roms, (rom) =>
    matchesQuery(rom.label) ||
    matchesQuery(rom.filename) ||
    matchesQuery(rom.metadata.title) ||
    matchesQuery(rom.system)
  );
};

// ROM list item component
const RomListItem = ({ rom, isSelected, width, highlightBg, highlightFg }: {
  rom: RomInfo;
  isSelected: boolean;
  width: number;
  highlightBg: string;
  highlightFg: string;
}) => {
  const color = getSystemColor(rom.system);

  // Calculate available space for ROM name
  // Format: "  [save] name"
  // Show disk emoji for save state, battery emoji for battery save only, nothing for no save
  const saveIndicator = rom.hasSaveState ? '\u{1F4BE} ' : (rom.hasBatterySave ? '\u{1F50B} ' : '   ');
  const SELECTION_PREFIX_WIDTH = 2; // "  " or "> "
  const prefixWidth = SELECTION_PREFIX_WIDTH + saveIndicator.length;
  const availableWidth = Math.max(ROM_MIN_DISPLAY_WIDTH, width - prefixWidth);

  // Prefer playlist label, fall back to filename without extension
  const romName = rom.label ?? rom.filename.replace(/\.[^.]+$/, '');
  const displayName = truncate(romName, availableWidth);

  return (
    <Box>
      <Text
        backgroundColor={isSelected ? highlightBg : undefined}
        color={isSelected ? highlightFg : color}
        bold={isSelected}
      >
        {isSelected ? '\u25B6 ' : '  '}
        {saveIndicator}{displayName}
      </Text>
    </Box>
  );
};

// Metadata panel component - memoized to prevent unnecessary re-renders
const MetadataPanel = memo(({
  rom,
  width,
  height,
  saveStateDetails,
  thumbnail,
  isKittySupported,
  panelStartCol,
}: MetadataPanelProps) => {
  const color = rom ? getSystemColor(rom.system) : 'gray';

  // Build metadata lines (computed early so we can use line count for thumbnail positioning)
  const lines: Array<{ label: string; value: string; color?: string }> = [];
  if (rom) {
    const meta = rom.metadata;
    // Title is always shown - prefer playlist label, then ROM header title, then filename as fallback
    const title = rom.label || meta.title || rom.filename.replace(/\.[^.]+$/, '');
    lines.push({ label: 'Title', value: title });
    lines.push({ label: 'System', value: rom.system, color });

    // Publisher - trim and ignore if starts with "." or ends with ".xxx" or ",xxx" (indicates unavailable)
    const publisher = meta.publisher?.trim();
    const hasInvalidPublisher = !publisher || publisher.startsWith('.') || /[.,][a-zA-Z]{3}$/.test(publisher);
    if (!hasInvalidPublisher) {
      lines.push({ label: 'Publisher', value: publisher });
    }

    // Playtime (from playlist runtime data)
    if (rom.runtimeSeconds !== undefined && rom.runtimeSeconds > 0) {
      lines.push({ label: 'Playtime', value: `\u{23F1} ${formatRuntimeSeconds(rom.runtimeSeconds)}`, color: 'cyan' });
    }

    // Last Played - from playlist data
    if (rom.lastPlayed) {
      const formattedDate = rom.lastPlayed.toLocaleDateString();
      const formattedTime = rom.lastPlayed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      lines.push({ label: 'Last Played', value: `\u{1F4C5} ${formattedDate} ${formattedTime}`, color: 'cyan' });
    }

    // Battery save info (.srm file) - only show if no save state exists
    if (rom.hasBatterySave && !rom.hasSaveState) {
      if (rom.batterySaveDate) {
        const batteryDate = rom.batterySaveDate.toLocaleDateString();
        const batteryTime = rom.batterySaveDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        lines.push({ label: 'Battery Save', value: `\u{1F50B} ${batteryDate} ${batteryTime}`, color: 'green' });
      } else {
        lines.push({ label: 'Battery Save', value: '\u{1F50B} Unknown date', color: 'green' });
      }
    }

    // Save state info (use lazy-loaded savedAt from file contents)
    if (rom.hasSaveState) {
      const savedAt = saveStateDetails?.savedAt;
      if (savedAt) {
        const stateDate = savedAt.toLocaleDateString();
        const stateTime = savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        lines.push({ label: 'Save State', value: `\u{1F4BE} ${stateDate} ${stateTime}`, color: 'cyan' });
      } else {
        lines.push({ label: 'Save State', value: '\u{1F4BE}', color: 'cyan' });
      }
    }

  }

  // Render thumbnail using Kitty graphics protocol
  useEffect(() => {
    if (!thumbnail || !isKittySupported) {
      return;
    }

    // Calculate position for thumbnail (after metadata lines)
    // Row calculation:
    // - 4 rows for header: panel border top (1) + "ROM Details" header (1) + marginBottom gap (1) + first line offset (1)
    // - lines.length rows for metadata
    // - 4 rows for gap after metadata
    const HEADER_ROWS = 4;
    const GAP_ROWS = 4;
    const thumbnailRow = HEADER_ROWS + lines.length + GAP_ROWS;

    // Align thumbnail with the values column (after the label width)
    // Column offset: panelStartCol + paddingX (2) + ROM_META_LABEL_WIDTH (12)
    const thumbnailCol = panelStartCol + 2 + ROM_META_LABEL_WIDTH;

    // Build and write the image sequence
    const positionSeq = buildCursorPositionSequence(thumbnailRow, thumbnailCol);
    const imageSeq = buildKittyImageSequence(
      thumbnail,
      THUMBNAIL_DISPLAY_COLS,
      THUMBNAIL_DISPLAY_ROWS,
      THUMBNAIL_KITTY_IMAGE_ID
    );

    process.stdout.write(positionSeq + imageSeq);

    // Cleanup: delete the image when thumbnail changes or component unmounts
    return () => {
      const deleteSeq = buildKittyDeleteSequence(THUMBNAIL_KITTY_IMAGE_ID);
      process.stdout.write(deleteSeq);
    };
  }, [thumbnail, isKittySupported, panelStartCol, lines.length]);

  // Render thumbnail using half-block characters (fallback when Kitty not supported)
  const [halfBlockThumbnail, setHalfBlockThumbnail] = useState<RenderedThumbnail | undefined>();

  useEffect(() => {
    if (!thumbnail || isKittySupported) {
      setHalfBlockThumbnail(undefined);
      return;
    }

    // Decode and render the thumbnail asynchronously
    let cancelled = false;
    renderThumbnailHalfBlocks(thumbnail, THUMBNAIL_DISPLAY_COLS, THUMBNAIL_DISPLAY_ROWS)
      .then((rendered) => {
        if (!cancelled && rendered) {
          setHalfBlockThumbnail(rendered);
        }
      })
      .catch(() => {
        // Silently ignore errors
      });

    return () => {
      cancelled = true;
    };
  }, [thumbnail, isKittySupported]);

  // Write half-block thumbnail to terminal
  useEffect(() => {
    if (!halfBlockThumbnail || isKittySupported) {
      return;
    }

    // Calculate position (same as Kitty thumbnail)
    const HEADER_ROWS = 4;
    const GAP_ROWS = 4;
    const thumbnailRow = HEADER_ROWS + lines.length + GAP_ROWS;
    const thumbnailCol = panelStartCol + 2 + ROM_META_LABEL_WIDTH;

    // Render the half-block thumbnail
    const seq = buildThumbnailSequence(halfBlockThumbnail, thumbnailRow, thumbnailCol);
    process.stdout.write(seq);

    // Cleanup: clear the thumbnail area
    return () => {
      const clearSeq = buildThumbnailClearSequence(
        halfBlockThumbnail.width,
        halfBlockThumbnail.height,
        thumbnailRow,
        thumbnailCol
      );
      process.stdout.write(clearSeq);
    };
  }, [halfBlockThumbnail, isKittySupported, panelStartCol, lines.length]);

  if (!rom) {
    return (
      <Box
        flexDirection="column"
        width={width}
        height={height}
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
      >
        <Text color="gray" italic>No ROM selected</Text>
      </Box>
    );
  }

  // Calculate available lines for metadata (account for header, footer, borders)
  // Reserve space for thumbnail (Kitty or half-block)
  const hasThumbnailToShow = thumbnail && (isKittySupported || halfBlockThumbnail);
  const thumbnailRowsReserved = hasThumbnailToShow ? THUMBNAIL_DISPLAY_ROWS + 2 : 0;
  const availableLines = height - ROM_LIST_HEADER_ROWS - thumbnailRowsReserved;

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor={color}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color={color}>ROM Details</Text>
      </Box>

      {lines.slice(0, availableLines).map((line, i) => (
        <Box key={i}>
          <Text color="gray">{line.label.padEnd(ROM_META_LABEL_WIDTH)}</Text>
          <Text color={line.color ?? 'white'}>{truncate(line.value, width - ROM_PANEL_BORDER_PADDING)}</Text>
        </Box>
      ))}

      {/* Spacer for thumbnail area (Kitty or half-block) */}
      {hasThumbnailToShow && (
        <Box height={THUMBNAIL_DISPLAY_ROWS + 1} />
      )}

      <Box marginTop={1} flexGrow={1} />

      <Box borderStyle="single" borderColor="gray" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text color="gray" dimColor>
          {'\u23CE'} Play  {'\u2191\u2193'} Navigate
        </Text>
      </Box>
    </Box>
  );
});

// Header component
const Header = ({ romCount, totalCount, searchQuery }: { romCount: number; totalCount: number; searchQuery: string }) => {
  const { stdout } = useStdout();
  const separatorWidth = Math.min(ROM_SEPARATOR_MAX_WIDTH, (stdout.columns || DEFAULT_TERM_WIDTH) - ROM_SEPARATOR_PADDING + 1);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="cyan">
          {'\u{1F3AE}'} emoemu
        </Text>
        <Text color="gray"> - </Text>
        {searchQuery ? (
          <>
            <Text color="yellow">{romCount.toLocaleString()}</Text>
            <Text color="gray">/{totalCount.toLocaleString()} matching "</Text>
            <Text color="yellow">{searchQuery}</Text>
            <Text color="gray">"</Text>
          </>
        ) : (
          <Text color="white">{romCount.toLocaleString()} {romCount === 1 ? 'ROM' : 'ROMs'}</Text>
        )}
      </Box>
      {searchQuery ? (
        <Box>
          <Text color="gray" dimColor>
            {'\u{1F50D}'} Filter: </Text>
          <Text color="yellow" bold>{searchQuery}</Text>
          <Text color="gray" dimColor> (ESC to clear)</Text>
        </Box>
      ) : (
        <Box>
          <Text color="gray" dimColor>
            {'━'.repeat(separatorWidth)}
          </Text>
        </Box>
      )}
    </Box>
  );
};

// Empty state component
const EmptyState = () => {
  const extensions = getSupportedExtensions();
  const extensionList = extensions.length > 0
    ? extensions.join(', ')
    : 'No cores loaded';

  return (
    <Box flexDirection="column" padding={2}>
      <Text color="yellow">{'\u26A0'} No ROMs found in this directory</Text>
      <Box marginTop={1}>
        <Text color="gray">Supported formats ({extensions.length}):</Text>
      </Box>
      <Text color="white">{extensionList}</Text>
    </Box>
  );
};

// Main browser component
export const RomBrowser = ({ roms, playlistDirectory, scanDepth, onSelect, onExit: _onExit, onRefresh, initialSelection, initialFilter, showSettingsOnMount, lastPlayedRom, showNetplayOnMount, onScaleFactorChange }: RomBrowserProps) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { config: localConfig, reloadConfig } = useConfig();

  // Track previous scale factor to detect changes
  const prevScaleFactorRef = useRef(localConfig.menu_scale_factor);

  // Call onScaleFactorChange when menu_scale_factor changes
  useEffect(() => {
    const currentScale = localConfig.menu_scale_factor;
    const prevScale = prevScaleFactorRef.current;

    // Check if scale factor actually changed (handle null comparison)
    const changed = currentScale !== prevScale;
    if (changed && onScaleFactorChange) {
      onScaleFactorChange(currentScale);
    }

    prevScaleFactorRef.current = currentScale;
  }, [localConfig.menu_scale_factor, onScaleFactorChange]);

  // Initialize search query with initial filter
  // searchQuery is for immediate display, debouncedSearchQuery is for filtering
  const [searchQuery, setSearchQuery] = useState(initialFilter ?? '');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(initialFilter ?? '');

  // Debounce search query updates to avoid filtering on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Compute initial filtered list for finding initial selection
  const initialFilteredRoms = initialFilter ? filterRoms(roms, initialFilter) : roms;

  const [selectedIndex, setSelectedIndex] = useState(() => {
    // Find initial selection index in the FILTERED list
    if (initialSelection) {
      const index = initialFilteredRoms.findIndex(rom => rom.path === initialSelection);
      if (index !== -1) {return index;}
    }
    return 0;
  });
  const [scrollOffset, setScrollOffset] = useState(() => {
    // Calculate initial scroll offset to show selected item
    if (initialSelection) {
      const index = initialFilteredRoms.findIndex(rom => rom.path === initialSelection);
      if (index !== -1) {
        const termHeight = process.stdout.rows || DEFAULT_TERM_HEIGHT;
        const listHeight = termHeight - ROM_OPTIONS_PANEL_ROWS;
        const MIN_VISIBLE = 1;
        const VISIBLE_PADDING = 2;
        const visibleItems = Math.max(MIN_VISIBLE, listHeight - VISIBLE_PADDING);
        // Center the selection if possible
        return Math.max(0, index - Math.floor(visibleItems / 2));
      }
    }
    return 0;
  });

  // Force re-render on mount to trigger Ink's terminal setup before user interaction
  const [, setMountRender] = useState(0);
  useEffect(() => {
    // Trigger a re-render after mount to ensure proper layout
    setMountRender(1);
  }, []);

  // Action buttons state
  const [actionButtonsFocused, setActionButtonsFocused] = useState(false);
  const [actionButtonIndex, setActionButtonIndex] = useState(0);

  // Auto-focus action buttons when no ROMs are found (so user can press Enter to add ROMs)
  useEffect(() => {
    if (roms.length === 0) {
      setActionButtonsFocused(true);
      setActionButtonIndex(0); // Focus "Add ROMs" button
    }
  }, [roms.length]);

  // Add ROMs prompt state
  const [showAddRomsPrompt, setShowAddRomsPrompt] = useState(false);

  // Settings panel state - open on mount if coming from a game
  const [showSettings, setShowSettings] = useState(showSettingsOnMount ?? false);
  // Track resumable ROM locally - cleared when settings is closed (Resume Game only shows once after exiting a game)
  const [resumableRom, setResumableRom] = useState<RomInfo | undefined>(lastPlayedRom);

  // Netplay panel state
  const [showNetplay, setShowNetplay] = useState(showNetplayOnMount ?? false);
  // Track if we're returning from a netplay disconnect (to default to Join mode)
  const [netplayReturnFromDisconnect, setNetplayReturnFromDisconnect] = useState(showNetplayOnMount ?? false);

  // Core manager panel state
  const [showCoreManager, setShowCoreManager] = useState(false);

  // Filter ROMs based on search query (memoized to avoid filtering on every render)
  const filteredRoms = useMemo(() => filterRoms(roms, debouncedSearchQuery), [roms, debouncedSearchQuery]);

  // Calculate dimensions - use Ink's stdout for native mode compatibility
  const termWidth = stdout.columns || DEFAULT_TERM_WIDTH;
  const termHeight = stdout.rows || DEFAULT_TERM_HEIGHT;

  // Layout: left panel (ROM list) takes 60%, right panel (metadata) takes 40%
  const LAYOUT_BORDER_PADDING = 4;
  const listWidth = Math.floor((termWidth - LAYOUT_BORDER_PADDING) * PERCENT_60);
  const metaWidth = Math.floor((termWidth - LAYOUT_BORDER_PADDING) * PERCENT_40);
  const listHeight = termHeight - ROM_OPTIONS_PANEL_ROWS; // Account for header and margins

  // Visible items in the list (each item takes 2 lines: content + separator)
  const MIN_ITEMS = 1;
  const ITEMS_PER_ROW = 2;
  const visibleItems = Math.max(MIN_ITEMS, Math.floor((listHeight - 1) / ITEMS_PER_ROW));

  // Calculate scrollbar dimensions (needed for mouse handling)
  const scrollbarTrackHeight = listHeight - 2; // Subtract 2 for top/bottom border

  // Refs for values that need to be current in callbacks (avoids stale closures)
  const scrollOffsetRef = useRef(scrollOffset);
  const visibleItemsRef = useRef(visibleItems);
  const filteredRomsRef = useRef(filteredRoms);
  scrollOffsetRef.current = scrollOffset;
  visibleItemsRef.current = visibleItems;
  filteredRomsRef.current = filteredRoms;

  // Track if this is the first render (to skip resetting on mount)
  const isFirstRenderRef = useRef(true);

  // Reset selection when filter changes (but not on initial mount)
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    setSelectedIndex(0);
    setScrollOffset(0);
  }, [debouncedSearchQuery]);

  // Mouse support for scrollbar and ROM list
  const { stdin, setRawMode } = useStdin();

  // Calculate positions for mouse hit detection
  // Header takes ~3 rows, list box border takes 1 row, so content starts at row 5
  const listStartRow = 4; // Row where list content begins (after header + border)
  const listStartCol = 1; // Column where list starts
  const listEndCol = listWidth - 2; // Column where list content ends (before scrollbar)
  const scrollbarCol = listWidth - 1; // 1-indexed column position for scrollbar

  // Enable mouse tracking and handle mouse events
  // Mouse handlers are defined inside the effect to avoid stale closure issues.
  // They use refs to access current state values.
  useEffect(() => {
    // Handle mouse click on scrollbar
    const handleScrollbarClick = (clickRow: number) => {
      const trackPosition = clickRow - listStartRow;
      if (trackPosition < 0 || trackPosition >= scrollbarTrackHeight) {return;}

      const scrollRatio = trackPosition / (scrollbarTrackHeight - 1);
      const maxScroll = Math.max(0, filteredRomsRef.current.length - visibleItemsRef.current);
      const newOffset = Math.round(scrollRatio * maxScroll);

      setScrollOffset(newOffset);
      setSelectedIndex(Math.min(newOffset, filteredRomsRef.current.length - 1));
    };

    // Handle mouse click on ROM list item
    const handleListClick = (clickRow: number) => {
      const rowInList = clickRow - listStartRow;
      if (rowInList < 0 || rowInList >= scrollbarTrackHeight) {return;}

      const itemIndex = Math.floor(rowInList / 2);
      const absoluteIndex = scrollOffsetRef.current + itemIndex;

      if (absoluteIndex >= 0 && absoluteIndex < filteredRomsRef.current.length) {
        setSelectedIndex(absoluteIndex);
      }
    };

    // Enable mouse tracking
    process.stdout.write(ENABLE_MOUSE);
    setRawMode(true);

    let buffer = '';

    // Pre-compiled regex for SGR mouse events (reused across calls)
    const sgrRegex = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

    const handleData = (data: Buffer) => {
      buffer += data.toString();

      // Guard against unbounded buffer growth
      if (buffer.length > MOUSE_BUFFER_MAX_SIZE) {
        const lastEsc = buffer.lastIndexOf('\x1b');
        buffer = lastEsc >= 0 ? buffer.slice(lastEsc) : '';
      }

      // Parse SGR mouse events: \x1b[<button;x;yM (press) or \x1b[<button;x;ym (release)
      sgrRegex.lastIndex = 0; // Reset regex state
      let match;
      let lastMatchEnd = 0;

      while ((match = sgrRegex.exec(buffer)) !== null) {
        lastMatchEnd = sgrRegex.lastIndex;
        const button = parseInt(match[1], 10);
        const x = parseInt(match[2], 10);
        const y = parseInt(match[3], 10);
        const isPress = match[4] === 'M';

        // Only handle left click press (button 0)
        if (isPress && button === 0) {
          // Check if click is on scrollbar column
          if (x === scrollbarCol || x === scrollbarCol + 1) {
            handleScrollbarClick(y);
          } else if (x >= listStartCol && x <= listEndCol) {
            // Click is in the ROM list area
            handleListClick(y);
          }
        }
      }

      // Clear processed data from buffer, keep only unprocessed tail
      if (lastMatchEnd > 0) {
        buffer = buffer.slice(lastMatchEnd);
      }
    };

    stdin.on('data', handleData);

    return () => {
      stdin.off('data', handleData);
      process.stdout.write(DISABLE_MOUSE);
    };
  }, [stdin, setRawMode, scrollbarCol, listStartCol, listEndCol, listStartRow, scrollbarTrackHeight]);

  // Get selected ROM for display (may be undefined if filtered list is empty)
  // Using .at() which properly returns T | undefined instead of bracket notation
  const selectedRom = filteredRoms.at(selectedIndex);

  // Cache for loaded save state details (keyed by ROM path)
  const saveStateDetailsCacheRef = useRef<Map<string, SaveStateDetails>>(new Map());
  // Cache for loaded thumbnails (keyed by ROM path)
  const thumbnailCacheRef = useRef<Map<string, ThumbnailResult | null>>(new Map());
  // Track which path's details are ready to render (after load + delay)
  const [detailsReadyPath, setDetailsReadyPath] = useState<string | null>(null);

  // Use detected Kitty graphics support for thumbnails (independent of video_driver setting)
  const isKittySupported = useKittyGraphicsSupported();

  // Load save state details and thumbnail lazily when selected ROM changes.
  // IMPORTANT: File I/O is debounced to prevent blocking the event loop during
  // rapid scrolling. Without debouncing, synchronous file reads (existsSync,
  // readFileSync, gunzipSync) block input processing and cause the UI to freeze.
  useEffect(() => {
    // Handle empty filtered list (no ROM selected)
    if (!selectedRom) {
      setDetailsReadyPath(null);
      return;
    }
    const romPath = selectedRom.path;
    const hasSaveState = selectedRom.hasSaveState;
    const romForThumbnail = selectedRom;

    // Clear ready state while we wait for debounce
    setDetailsReadyPath(null);

    // Debounce the file I/O operations to avoid blocking during rapid scrolling
    const timer = setTimeout(() => {
      const saveStateCache = saveStateDetailsCacheRef.current;
      const thumbCache = thumbnailCacheRef.current;

      // Load save state details if not cached and ROM has a save state
      if (hasSaveState && !saveStateCache.has(romPath)) {
        const details = getSaveStateService().loadDetails(romPath);
        saveStateCache.set(romPath, details);
      }

      // Load thumbnail if not cached (works with both Kitty and half-block renderers)
      if (!thumbCache.has(romPath)) {
        const thumbnail = loadAnyThumbnail(romForThumbnail);
        thumbCache.set(romPath, thumbnail ?? null);
      }

      setDetailsReadyPath(romPath);
    }, THUMBNAIL_LOAD_DELAY_MS);

    return () => clearTimeout(timer);
  }, [selectedRom?.path, selectedRom?.hasSaveState]);

  // Get the details for the current selection (from ref cache)
  const selectedRomDetails = selectedRom?.hasSaveState && detailsReadyPath === selectedRom.path
    ? saveStateDetailsCacheRef.current.get(selectedRom.path)
    : undefined;

  // Get the thumbnail for the current selection (from ref cache)
  const selectedRomThumbnail = selectedRom && detailsReadyPath === selectedRom.path
    ? (thumbnailCacheRef.current.get(selectedRom.path) ?? undefined)
    : undefined;

  // Migrate save state timestamp to playlist last_played if not already set
  // This is a one-time migration for ROMs that were played before last_played tracking was added
  const migratedDatesRef = useRef<Map<string, Date>>(new Map());
  useEffect(() => {
    if (!selectedRom || selectedRom.lastPlayed) {
      return;
    }

    // Only migrate from save state savedAt
    const dateToMigrate = selectedRomDetails?.savedAt;
    if (!dateToMigrate) {
      return;
    }

    // Skip if already migrated this session
    if (migratedDatesRef.current.has(selectedRom.path)) {
      return;
    }

    // Store migrated date and update playlist
    migratedDatesRef.current.set(selectedRom.path, dateToMigrate);
    updateLastPlayed(selectedRom.path, playlistDirectory, dateToMigrate);
  }, [selectedRom, selectedRomDetails?.savedAt, playlistDirectory]);

  // Create ROM with lastPlayed populated (from playlist or migration)
  const selectedRomWithLastPlayed = useMemo(() => {
    if (!selectedRom) {
      return undefined;
    }
    if (selectedRom.lastPlayed) {
      return selectedRom;
    }
    const migratedDate = migratedDatesRef.current.get(selectedRom.path);
    if (migratedDate) {
      return { ...selectedRom, lastPlayed: migratedDate };
    }
    return selectedRom;
  }, [selectedRom, selectedRomDetails?.savedAt]); // Re-compute when savedAt loads (triggers migration)

  // Launch the currently selected ROM (shared by keyboard Enter, gamepad A, and gamepad Start)
  const launchSelectedRom = useCallback(() => {
    const rom = filteredRoms.at(selectedIndex);
    if (!rom) {return;} // No ROM selected (empty filtered list)
    onSelect(rom, searchQuery);
    exit();
  }, [filteredRoms, selectedIndex, onSelect, searchQuery, exit]);

  // Handle keyboard input
  useInput((input, key) => {
    // Skip main input handling when overlays are shown
    if (showAddRomsPrompt || showSettings || showNetplay || showCoreManager) {
      return;
    }

    // Tab: toggle focus between ROM list and action buttons
    if (key.tab) {
      setActionButtonsFocused(prev => !prev);
      return;
    }

    // ESC: if action buttons focused, return to list; otherwise clear filter or show settings
    if (key.escape) {
      if (actionButtonsFocused) {
        setActionButtonsFocused(false);
        return;
      }
      if (searchQuery) {
        setSearchQuery('');
      } else {
        setShowSettings(true);
      }
      return;
    }

    // Backspace: remove last character from search (only when list is focused)
    if ((key.backspace || key.delete) && !actionButtonsFocused) {
      setSearchQuery(prev => prev.slice(0, -1));
      return;
    }

    // When action buttons are focused, handle horizontal navigation
    if (actionButtonsFocused) {
      if (key.leftArrow) {
        setActionButtonIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.rightArrow) {
        setActionButtonIndex(prev => Math.min(actionButtons.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        // Handle action button activation
        const button = actionButtons[actionButtonIndex];
        if (button.id === 'add-roms') {
          setShowAddRomsPrompt(true);
          setActionButtonsFocused(false);
        } else if (button.id === 'manage-cores') {
          setShowCoreManager(true);
          setActionButtonsFocused(false);
        } else if (button.id === 'netplay') {
          // Can only start netplay if a ROM is selected
          if (filteredRoms.length > 0) {
            setShowNetplay(true);
            setActionButtonsFocused(false);
          }
        } else if (button.id === 'settings') {
          setShowSettings(true);
          setActionButtonsFocused(false);
        }
        return;
      }
      // Ignore other keys when action buttons focused
      return;
    }

    // Navigation with arrow keys and page up/down only (when ROM list is focused)
    // Note: We only update selectedIndex here. The useEffect keeps scrollOffset in sync.
    // We use refs for filteredRoms and visibleItems to avoid stale closure issues
    // during rapid key presses.
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(filteredRomsRef.current.length - 1, prev + 1));
      return;
    }

    if (key.pageUp) {
      setSelectedIndex((prev) => Math.max(0, prev - visibleItemsRef.current));
      return;
    }

    if (key.pageDown) {
      setSelectedIndex((prev) => Math.min(filteredRomsRef.current.length - 1, prev + visibleItemsRef.current));
      return;
    }

    // Home/End for jumping to top/bottom
    if (key.home) {
      setSelectedIndex(0);
      return;
    }

    if (key.end) {
      setSelectedIndex(filteredRomsRef.current.length - 1);
      return;
    }

    if (key.return) {
      launchSelectedRom();
      return;
    }

    // Any printable character adds to search
    if (input && input.length === 1 && !key.ctrl && !key.meta) {
      setSearchQuery(prev => prev + input);
    }
  });

  // Handle gamepad input
  // Note: Like keyboard input, we only update selectedIndex here and let the
  // useEffect sync scrollOffset. We use refs to avoid stale closure issues.
  useGamepadContext({
    onUp: () => {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    },
    onDown: () => {
      setSelectedIndex((prev) => Math.min(filteredRomsRef.current.length - 1, prev + 1));
    },
    onConfirm: () => {
      // A button (and Start, via the shared fallback) launches the selected ROM
      launchSelectedRom();
    },
    onCancel: () => {
      // B button clears filter but doesn't exit app (use keyboard Esc to exit)
      if (searchQuery) {
        setSearchQuery('');
      }
    },
    onGuide: () => {
      // Guide/Xbox button opens settings
      setShowSettings(true);
    },
  }, !showSettings && !showAddRomsPrompt && !showNetplay && !showCoreManager);  // Disable when overlays are shown

  // Keep scroll in sync with selection
  // Uses refs to read current values without triggering effect re-runs when scrollOffset changes
  useEffect(() => {
    const currentScrollOffset = scrollOffsetRef.current;
    const currentVisibleItems = visibleItemsRef.current;
    if (selectedIndex < currentScrollOffset) {
      setScrollOffset(selectedIndex);
    } else if (selectedIndex >= currentScrollOffset + currentVisibleItems) {
      setScrollOffset(selectedIndex - currentVisibleItems + 1);
    }
  }, [selectedIndex]);

  // Clamp selection to valid range when filtered list changes
  useEffect(() => {
    if (selectedIndex >= filteredRoms.length) {
      setSelectedIndex(Math.max(0, filteredRoms.length - 1));
    }
  }, [filteredRoms.length, selectedIndex]);

  // Get visible ROMs for current scroll position
  const visibleRoms = filteredRoms.slice(scrollOffset, scrollOffset + visibleItems);

  // Calculate scrollbar position and size
  const scrollbarHeight = Math.max(1, Math.floor(scrollbarTrackHeight * visibleItems / filteredRoms.length));
  const scrollbarPosition = Math.floor((scrollOffset / Math.max(1, filteredRoms.length - visibleItems)) * (scrollbarTrackHeight - scrollbarHeight));

  // Empty space elements to fill unused list rows
  const emptySpaceCount = Math.max(0, visibleItems - visibleRoms.length);
  const emptySpaceElements = Array.from({ length: emptySpaceCount }, (_, i) => (
    <Box key={`empty-${i}`}>
      <Text> </Text>
    </Box>
  ));

  // Scrollbar track elements
  const scrollbarElements = Array.from({ length: scrollbarTrackHeight }, (_, i) => {
    const isThumb = i >= scrollbarPosition && i < scrollbarPosition + scrollbarHeight;
    return (
      <Text key={i} color={isThumb ? 'blue' : 'gray'}>
        {isThumb ? '\u2588' : '\u2591'}
      </Text>
    );
  });

  // Handle Add ROMs prompt completion
  const handleAddRomsComplete = useCallback(() => {
    // Trigger a refresh to reload the ROM browser with the updated ROM list
    onRefresh(searchQuery);
    exit();
  }, [searchQuery, onRefresh, exit]);

  const handleAddRomsCancel = useCallback(() => {
    setShowAddRomsPrompt(false);
  }, []);

  // Show Add ROMs prompt overlay when active
  if (showAddRomsPrompt) {
    return (
      <AddRomsPrompt
        directory={process.cwd()}
        playlistDirectory={playlistDirectory}
        scanDepth={scanDepth}
        onPlaylistGenerated={handleAddRomsComplete}
        onExit={handleAddRomsCancel}
      />
    );
  }

  // Show core manager panel when active
  if (showCoreManager) {
    return (
      <CoreManager
        onClose={() => setShowCoreManager(false)}
      />
    );
  }

  // Show netplay panel when active
  if (showNetplay) {
    // Use the ROM at selected index, or fall back to first ROM in list
    const selectedRomForNetplay = filteredRoms.at(selectedIndex) ?? filteredRoms.at(0);
    if (selectedRomForNetplay) {
      return (
        <NetplayPanel
          rom={selectedRomForNetplay}
          onStart={(options) => {
            setNetplayReturnFromDisconnect(false);
            onSelect(selectedRomForNetplay, searchQuery, false, options);
            exit();
          }}
          onCancel={() => {
            setNetplayReturnFromDisconnect(false);
            setShowNetplay(false);
          }}
          initialMode={netplayReturnFromDisconnect ? 'join' : 'host'}
        />
      );
    }
    // No ROMs available - fall through to show main browser
  }

  // Show settings panel when active
  if (showSettings) {
    return (
      <SettingsPanel
        onClose={() => {
          // Reload config in case settings changed
          reloadConfig();
          setShowSettings(false);
          // Clear resumable ROM so Resume Game doesn't appear next time settings is opened
          setResumableRom(undefined);
        }}
        lastPlayedRom={resumableRom}
        onResumeGame={resumableRom ? () => {
          onSelect(resumableRom, searchQuery, true);  // true = resumeGame
          exit();
        } : undefined}
      />
    );
  }

  // Empty state - no ROMs found
  if (roms.length === 0) {
    return (
      <Box flexDirection="column" height={termHeight}>
        <Header romCount={0} totalCount={0} searchQuery="" />

        {/* Empty state message - fills available space */}
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <EmptyState />
        </Box>

        {/* Footer with action buttons */}
        <Box marginTop={1}>
          {actionButtons.map((btn, i) => (
            <ActionButton
              key={btn.id}
              button={btn}
              isSelected={i === actionButtonIndex}
              isFocused={actionButtonsFocused}
              highlightBg={localConfig.menu_highlight_bg}
              highlightFg={localConfig.menu_highlight_fg}
            />
          ))}
          <Text color="gray" dimColor>
            {actionButtonsFocused ? ' (Tab: list, \u2190\u2192: select, \u23CE: activate)' : ' (Tab: actions)'}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header romCount={filteredRoms.length} totalCount={roms.length} searchQuery={searchQuery} />

      <Box>
        {/* ROM List */}
        <Box
          flexDirection="column"
          width={listWidth}
          height={listHeight}
          borderStyle="round"
          borderColor="gray"
        >
          {visibleRoms.map((rom, i) => (
            <Box key={rom.path} flexDirection="column">
              <RomListItem
                rom={rom}
                isSelected={scrollOffset + i === selectedIndex}
                width={listWidth - LAYOUT_BORDER_PADDING}
                highlightBg={localConfig.menu_highlight_bg}
                highlightFg={localConfig.menu_highlight_fg}
              />
              {i < visibleRoms.length - 1 && (
                <Text color="gray" dimColor>{'─'.repeat(listWidth - LAYOUT_BORDER_PADDING)}</Text>
              )}
            </Box>
          ))}

          {/* Fill empty space (memoized) */}
          {emptySpaceElements}

          {/* Scrollbar indicator (memoized) */}
          {filteredRoms.length > visibleItems && (
            <Box position="absolute" flexDirection="column" marginLeft={listWidth - ROM_SEPARATOR_PADDING}>
              {scrollbarElements}
            </Box>
          )}
        </Box>

        {/* Spacer */}
        <Box width={ITEMS_PER_ROW} />

        {/* Metadata Panel */}
        <MetadataPanel
          rom={selectedRomWithLastPlayed}
          width={metaWidth}
          height={listHeight}
          saveStateDetails={selectedRomDetails}
          thumbnail={selectedRomThumbnail?.data}
          isKittySupported={isKittySupported}
          panelStartCol={listWidth + ITEMS_PER_ROW + 1}
        />
      </Box>

      {/* Footer with action buttons and position indicator */}
      <Box marginTop={1} justifyContent="space-between">
        {/* Action buttons */}
        <Box>
          {actionButtons.map((btn, i) => (
            <ActionButton
              key={btn.id}
              button={btn}
              isSelected={i === actionButtonIndex}
              isFocused={actionButtonsFocused}
              highlightBg={localConfig.menu_highlight_bg}
              highlightFg={localConfig.menu_highlight_fg}
            />
          ))}
          <Text color="gray" dimColor>
            {actionButtonsFocused ? ' (Tab: list, \u2190\u2192: select, \u23CE: activate)' : ' (Tab: actions)'}
          </Text>
        </Box>

        {/* Position indicator */}
        <Box>
          <Text color="gray">
            {filteredRoms.length > 0 ? `${selectedIndex + 1}/${filteredRoms.length}` : 'No matches'}
            {!searchQuery && !actionButtonsFocused && (
              <Text color="gray" dimColor> (type to search)</Text>
            )}
            {searchQuery && !actionButtonsFocused && (
              <Text color="gray" dimColor> (ESC to clear)</Text>
            )}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
