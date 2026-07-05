import type { VideoDriver } from '../frontend/config';

// Rendering constants for the emulator display system
// This file contains magic numbers extracted from the rendering modules
// to satisfy ESLint no-magic-numbers rule and improve code readability

// Luminance coefficients (ITU-R BT.601)
export { LUMINANCE_R, LUMINANCE_G, LUMINANCE_B } from '../utils/color';

/** Luminance threshold for binary color decisions (e.g., black/white emoji) */
export const LUMINANCE_THRESHOLD = 0.5;

// =============================================================================
// Terminal Rendering Constants (renderer.ts)
// =============================================================================

/** Default terminal width for modern terminals (wider default) */
export const DEFAULT_TERMINAL_WIDTH_WIDE = 120;

/** Default terminal height for modern terminals (taller default) */
export const DEFAULT_TERMINAL_HEIGHT_TALL = 40;

/** Character aspect ratio for 4:3 display (8/3 ≈ 2.67, accounts for terminal chars being ~2x taller than wide) */
// eslint-disable-next-line @typescript-eslint/no-magic-numbers
export const CHAR_ASPECT_RATIO_4_3 = 8 / 3;

/** Default source framebuffer width */
export const DEFAULT_SOURCE_WIDTH = 256;

/** Default source framebuffer height */
export const DEFAULT_SOURCE_HEIGHT = 240;

/** Default renderer display width in characters */
export const DEFAULT_DISPLAY_WIDTH = 128;

/** Default renderer display height in characters */
export const DEFAULT_DISPLAY_HEIGHT = 60;

/** Rows reserved for status line */
export const STATUS_LINE_ROWS = 2;

/** Gap threshold for diff rendering (unchanged chars between runs) */
export const DIFF_GAP_THRESHOLD = 5;

/** Emoji display width (each emoji takes 2 terminal columns) */
export const EMOJI_COLUMN_WIDTH = 2;

// ANSI 256-color cube constants
/** Base index for 6x6x6 color cube in ANSI 256 palette */
export const ANSI_256_COLOR_CUBE_BASE = 16;

/** Number of levels per channel in 6x6x6 color cube (0-5) */
export const ANSI_256_COLOR_LEVELS = 6;

/** Divisor for mapping 8-bit color to 6-level cube (255/5 = 51) */
export const ANSI_256_COLOR_DIVISOR = 51;

/** Multiplier for red channel in 6x6x6 cube index calculation */
export const ANSI_256_RED_MULTIPLIER = 36;

/** Multiplier for green channel in 6x6x6 cube index calculation */
export const ANSI_256_GREEN_MULTIPLIER = 6;

/** Maximum value for 8-bit color channel */
export const COLOR_CHANNEL_MAX = 255;

/** Middle gray value (128) for contrast adjustment */
export const CONTRAST_MIDPOINT = 128;

/** Number of entries in gamma lookup table (256 for 8-bit) */
export const GAMMA_LUT_SIZE = 256;

// Post-processing effect default values
/** Default gamma value (no correction) */
export const DEFAULT_GAMMA = 1.0;

/** Default scanlines intensity (disabled) */
export const DEFAULT_SCANLINES = 0;

/** Default saturation multiplier (normal) */
export const DEFAULT_SATURATION = 1.0;

/** Default brightness multiplier (normal) */
export const DEFAULT_BRIGHTNESS = 1.0;

/** Default contrast multiplier (normal) */
export const DEFAULT_CONTRAST = 1.0;

/** Default vignette intensity (disabled) */
export const DEFAULT_VIGNETTE = 0;

/** Default bloom intensity (disabled) */
export const DEFAULT_BLOOM = 0;

/** Default bloom brightness threshold */
export const DEFAULT_BLOOM_THRESHOLD = 0.6;

/** Default NTSC artifact intensity (disabled) */
export const DEFAULT_NTSC = 0;

/** Default CRT curvature (disabled) */
export const DEFAULT_CURVATURE = 0;

/** Default chromatic aberration intensity (disabled) */
export const DEFAULT_CHROMATIC_ABERRATION = 0;

// =============================================================================
// Kitty Graphics Protocol Constants (kitty-renderer.ts)
// =============================================================================

/** Default native width in pixels */
export const DEFAULT_NATIVE_WIDTH = 256;

/** Default native height in pixels */
export const DEFAULT_NATIVE_HEIGHT = 240;

/** Typical terminal cell width in pixels */
export const CELL_WIDTH_PX = 9;

/** Typical terminal cell height in pixels (roughly 2x width for most fonts) */
export const CELL_HEIGHT_PX = 18;

/** Number of initial frames to force full rendering (no diff optimization) */
export const INITIAL_FULL_RENDER_FRAMES = 5;

/** Minimum display columns for Kitty renderer */
export const MIN_DISPLAY_COLS = 32;

/** Minimum display rows for Kitty renderer */
export const MIN_DISPLAY_ROWS = 15;

/** Chunk size for Kitty graphics protocol base64 transmission (256KB) */
export const KITTY_CHUNK_SIZE = 262144;

/** PNG bit depth (8 bits per channel) */
export const PNG_BIT_DEPTH = 8;

/** PNG color type for indexed palette */
export const PNG_COLOR_TYPE_INDEXED = 3;

/** PNG color type for RGB */
export const PNG_COLOR_TYPE_RGB = 2;

/**
 * Default PNG compression level (1-9 scale, higher = smaller files but more CPU).
 * Deflate runs synchronously on the emulation loop every frame, so favor speed:
 * levels above ~3 cost far more CPU than the marginal size savings on small
 * palettized game frames.
 */
export const DEFAULT_PNG_COMPRESSION = 1;

/** Minimum PNG compression level */
export const PNG_COMPRESSION_MIN = 1;

/** Maximum PNG compression level */
export const PNG_COMPRESSION_MAX = 9;

/** Default internal render scale factor */
export const DEFAULT_RENDER_SCALE = 2;

/** Minimum render scale (0.25x = quarter resolution) */
export const MIN_RENDER_SCALE = 0.25;

/** Maximum render scale (4x) */
export const MAX_RENDER_SCALE = 4;

/**
 * System-specific default render scales.
 * Keys are system names (e.g., "Nintendo - Nintendo 64") matching RetroArch database names.
 * The default for any system not listed here is DEFAULT_RENDER_SCALE (2x).
 */
export const SYSTEM_DEFAULT_SCALES: Record<string, number> = {
  // N64: Use 0.5x scale since native resolution (320x240) is larger than 8-bit consoles
  // and renders slowly with software rendering
  'Nintendo - Nintendo 64': 0.5,
};

/**
 * Get the default render scale for a system based on its name.
 * Uses exact matching against known system names from RetroArch database format.
 *
 * @param systemName The system name (e.g., "Nintendo - Nintendo 64")
 * @returns The default scale for this system
 */
export const getDefaultScaleForSystem = (systemName: string): number => {
  return SYSTEM_DEFAULT_SCALES[systemName] ?? DEFAULT_RENDER_SCALE;
};

/** Default render mode for most systems */
export const DEFAULT_RENDER_MODE: VideoDriver = 'kitty';

/**
 * System-specific default render modes.
 * Keys are system names (e.g., "Nintendo - Nintendo 64") matching RetroArch database names.
 * The default for any system not listed here is DEFAULT_RENDER_MODE ('kitty').
 */
export const SYSTEM_DEFAULT_RENDER_MODES: Record<string, VideoDriver> = {
  // N64: Use terminal mode since Kitty graphics are slow with software rendering
  'Nintendo - Nintendo 64': 'terminal',
};

/**
 * Get the default render mode for a system based on its name.
 * Uses exact matching against known system names from RetroArch database format.
 *
 * @param systemName The system name (e.g., "Nintendo - Nintendo 64")
 * @returns The default render mode for this system
 */
export const getDefaultRenderModeForSystem = (systemName: string): VideoDriver => {
  return SYSTEM_DEFAULT_RENDER_MODES[systemName] ?? DEFAULT_RENDER_MODE;
};

/** Memory logging interval in frames (60 frames ≈ 1 second at 60fps) */
export const MEMORY_LOG_INTERVAL = 60;

/** Size of 256-color palette buffer (256 colors * 3 bytes RGB) */
export const PALETTE_BUFFER_SIZE = 768;

// =============================================================================
// RGB15/RGB16 Color Format Constants
// =============================================================================

/** Bitmask for 5-bit channel in RGB15/16 format */
export const RGB15_CHANNEL_MASK = 0x1f;

/** Full 16-bit mask for RGB15 format validation */
export const RGB15_FULL_MASK = 0x001f;

/** Bit shift for green channel in RGB15 format */
export const RGB15_GREEN_SHIFT = 5;

/** Bit shift for blue channel in RGB15 format */
export const RGB15_BLUE_SHIFT = 10;

/** Left shift for converting 5-bit to 8-bit (multiply by 8) */
export const RGB5_TO_RGB8_SHIFT = 3;

// =============================================================================
// RGB24 Color Format Constants
// =============================================================================

/** Bytes per pixel in RGB24 format */
export const RGB24_BYTES_PER_PIXEL = 3;

// =============================================================================
// Color Packing Constants
// =============================================================================

/** Bit shift for red channel when packing RGB into 24-bit number */
export const PACK_RED_SHIFT = 16;

/** Bit shift for green channel when packing RGB into 8-bit number */
export const PACK_GREEN_SHIFT = 8;

// =============================================================================
// PNG Encoding Constants
// =============================================================================

/** IHDR total length (13 bytes) */
export const PNG_IHDR_LENGTH = 13;

/** Offset for height field in IHDR (after 4-byte width) */
export const PNG_IHDR_HEIGHT_OFFSET = 4;

// =============================================================================
// Memory Size Constants
// =============================================================================

/** Bytes in a kilobyte */
export const BYTES_PER_KB = 1024;

// =============================================================================
// Post-Processing Effects Constants (effects.ts)
// =============================================================================

/** Fixed-point scale factor for vignette/scanline calculations (256 = 2^8) */
export const FIXED_POINT_SCALE = 256;

/** Bit shift for fixed-point division (>> 8 = divide by 256) */
export const FIXED_POINT_SHIFT = 8;

/** Fast integer luminance red coefficient (77 ≈ 0.299 * 256) */
export const FAST_LUMINANCE_R = 77;

/** Fast integer luminance green coefficient (150 ≈ 0.587 * 256) */
export const FAST_LUMINANCE_G = 150;

/** Fast integer luminance blue coefficient (29 ≈ 0.114 * 256) */
export const FAST_LUMINANCE_B = 29;

/** Curvature distortion factor multiplier */
export const CURVATURE_FACTOR = 0.25;

/** Default bloom blur radius in pixels */
export const BLOOM_BLUR_RADIUS = 2;

/** NTSC chroma blur radius in half-pixels */
export const NTSC_BLUR_RADIUS = 5;

// =============================================================================
// ANSI Parser Constants
// =============================================================================

/** Number of standard (non-bright) colors in ANSI 16 palette */
export const ANSI_STANDARD_COLOR_COUNT = 8;

/** Tab stop width in columns */
export const ANSI_TAB_WIDTH = 8;

/** ANSI erase display mode: clear entire screen */
export const ANSI_ERASE_ENTIRE_SCREEN = 2;

/** ANSI erase display mode: clear to end and beyond */
export const ANSI_ERASE_TO_END_AND_BEYOND = 3;

/** Extended color parse offset increment */
export const ANSI_EXTENDED_COLOR_OFFSET_256 = 2;

/** Extended RGB color check: need at least 3 more params (R, G, B) */
export const ANSI_EXTENDED_RGB_MIN_PARAMS = 3;

/** Extended RGB color parse offset increment */
export const ANSI_EXTENDED_COLOR_OFFSET_RGB = 4;

/** Extended RGB R offset from mode */
export const ANSI_RGB_R_OFFSET = 1;

/** Extended RGB G offset from mode */
export const ANSI_RGB_G_OFFSET = 2;

/** Extended RGB B offset from mode */
export const ANSI_RGB_B_OFFSET = 3;

// =============================================================================
// ANSI 256 Color Cube Constants
// =============================================================================

/** Red channel multiplier in 6x6x6 cube */
export const ANSI_CUBE_RED_MULTIPLIER = 36;

/** Cube step size for non-zero values */
export const ANSI_CUBE_STEP = 40;

/** Cube base for non-zero values */
export const ANSI_CUBE_BASE = 55;

// =============================================================================
// Input Bridge Constants
// =============================================================================

/** ASCII code for lowercase 'a' */
export const ASCII_A_LOWER = 97;

/** ASCII code for lowercase 'z' */
export const ASCII_Z_LOWER = 122;

/** Ctrl key offset (Ctrl+A = 1) */
export const CTRL_KEY_OFFSET = 96;

/** ASCII code for '[' */
export const ASCII_BRACKET_OPEN = 91;

/** ASCII code for '\' */
export const ASCII_BACKSLASH = 92;

/** ASCII code for ']' */
export const ASCII_BRACKET_CLOSE = 93;

/** ASCII code for '^' */
export const ASCII_CARET = 94;

/** ASCII code for '_' */
export const ASCII_UNDERSCORE = 95;

/** Function key offset to index (F1 = 0) */
export const FUNCTION_KEY_OFFSET_3 = 3;
export const FUNCTION_KEY_OFFSET_4 = 4;
export const FUNCTION_KEY_OFFSET_5 = 5;
export const FUNCTION_KEY_OFFSET_6 = 6;
export const FUNCTION_KEY_OFFSET_7 = 7;
export const FUNCTION_KEY_OFFSET_8 = 8;
export const FUNCTION_KEY_OFFSET_9 = 9;
export const FUNCTION_KEY_OFFSET_10 = 10;

// =============================================================================
// Text Renderer Constants
// =============================================================================

/** Maximum glyph cache size before LRU eviction */
export const MAX_GLYPH_CACHE_SIZE = 1000;

/** Fraction of cache to evict when full (1/4) */
export const GLYPH_CACHE_EVICT_DIVISOR = 4;

// =============================================================================
// Native Rendering Constants (NativeRenderer)
// =============================================================================

/** Default integer scale for native window mode */
export const DEFAULT_NATIVE_SCALE = 3;

/** Minimum native window scale */
export const MIN_NATIVE_SCALE = 1;

/** Maximum native window scale */
export const MAX_NATIVE_SCALE = 8;
