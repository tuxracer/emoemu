/**
 * Rendering Module Exports
 *
 * Re-exports all rendering components.
 */

export { TerminalRenderer } from './renderer.js';
export type { RendererOptions } from './renderer.js';

export { KittyRenderer } from './kitty-renderer.js';
export type { KittyRendererOptions } from './kitty-renderer.js';

export {
  nesPalette,
  nesPaletteFlat,
  nesColorToAnsi256,
  nesColorToHex,
  nesColorToTrueColor,
  nesColorToBgTrueColor,
  nesColorLuminance,
  nesColorToEmoji,
} from './palette.js';
