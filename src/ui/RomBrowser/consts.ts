// =============================================================================
// Layout
// =============================================================================

/** Minimum filename display width */
export const ROM_MIN_DISPLAY_WIDTH = 20;

/** Header and footer rows in list calculation */
export const ROM_LIST_HEADER_ROWS = 4;
export const ROM_LIST_FOOTER_ROWS = 4;

/** Metadata label width for alignment */
export const ROM_META_LABEL_WIDTH = 12;

/** Panel padding calculations */
export const ROM_PANEL_BORDER_PADDING = 16;

/** Maximum separator line width */
export const ROM_SEPARATOR_MAX_WIDTH = 60;

/** Separator padding from panel width */
export const ROM_SEPARATOR_PADDING = 3;

/** Options panel rows for height calculation */
export const ROM_OPTIONS_PANEL_ROWS = 6;

/** Page navigation step multiplier */
export const ROM_PAGE_STEP_MULTIPLIER = 4;

/** Layout proportions */
export const PERCENT_60 = 0.6;
export const PERCENT_40 = 0.4;

// =============================================================================
// Timing
// =============================================================================

/** Debounce delay for loading save state details and thumbnails (ms).
 * Must be long enough to prevent file I/O during rapid scrolling, which blocks
 * the event loop and causes input to freeze. */
export const THUMBNAIL_LOAD_DELAY_MS = 150;

/** Debounce delay for search input filtering (ms) */
export const SEARCH_DEBOUNCE_MS = 200;

/** Maximum mouse event buffer size before truncation (bytes) */
export const MOUSE_BUFFER_MAX_SIZE = 512;

// =============================================================================
// Thumbnail Display
// =============================================================================

/** Kitty image ID for thumbnail rendering (used for cleanup) */
export const THUMBNAIL_KITTY_IMAGE_ID = 9001;

/** Thumbnail display dimensions in terminal cells
 * For 4:3 aspect ratio emulator screenshots with ~2:1 terminal cell proportions,
 * we use 24 cols × 9 rows which gives 24:(9×2) = 24:18 = 4:3 aspect ratio
 */
export const THUMBNAIL_DISPLAY_COLS = 24;
export const THUMBNAIL_DISPLAY_ROWS = 9;
