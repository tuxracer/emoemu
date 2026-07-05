/**
 * Utility Module Exports
 *
 * General-purpose utilities used across the application.
 */

// Constants
export * from './consts';

// Data format utilities
export {
  isGzipped,
  isZstd,
  isZlib,
  detectCompressionFormat,
  decompress,
} from './compression';
export type { CompressionFormat } from './compression';
export { formatPlayTime, formatRuntimeSeconds } from './format';

// Platform path utilities
export {
  getConfigDirectory,
  getDefaultConfigPath,
  getConfigPaths,
} from './paths';

// INI file parsing utilities
export {
  parseIniLine,
  parseIniContent,
  formatIniValue,
  updateIniLine,
  parseIniBool,
  parseIniNumber,
  parseIniInt,
  parseIniNullableNumber,
} from './ini';
export type { IniKeyValue, IniValue } from './ini';

// Buffer reading utilities
export {
  readUint16LE,
  readInt16LE,
  applySignedAnalogToDpad,
  analogToDpad,
  hatToDpad,
  applyDpadToButtons,
} from './buffer';
export type { DpadState } from './buffer';

// Color utilities
export {
  extractRgb15Components,
  expand5to8,
  rgb15ToRgb24,
  calculateLuminance,
  calculateLuminance8,
  rgb15ToLuminance,
  rgbToGrayscale,
  findClosestEmoji,
  getGrayscaleEmoji,
  rgb15ToEmoji,
  rgb15ToGrayscaleEmoji,
  rgb24ToEmoji,
  rgb24ToGrayscaleEmoji,
  rgbToAnsi256,
  buildGammaLUT,
  colorDistanceSquared,
  EMOJI_COLORS,
} from './color';
export type { EmojiColor } from './color';

// CRC32 checksum utilities
export { crc32, calculateFileCrc32 } from './crc32';

// PNG encoding utilities
export {
  PNG_SIGNATURE,
  createPngChunk,
  rgbToIndexed,
} from './png';
export type { IndexedResult } from './png';

// Kitty graphics protocol utilities
export {
  buildKittyImageSequence,
  buildKittyDeleteSequence,
  buildCursorPositionSequence,
  HIDE_CURSOR,
  SHOW_CURSOR,
} from './kitty';

// Filesystem utilities
export { ensureDirectory } from './ensureDirectory';

// Error message extraction
export { getErrorMessage } from './getErrorMessage';

// Typed error factory
export { createTypedError } from './typedError';

// Log rotation
export { rotateLogFile } from './rotateLogFile';

// Terminal utilities
export {
  getTerminalDimensions,
  cleanupStdin,
  exitAlternateScreen,
  cleanupInkInstance,
  pressAnyKeyToContinue,
} from './terminal';
