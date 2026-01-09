/**
 * Re-export for backward compatibility.
 * The actual implementation has moved to src/rendering/palette.ts
 */
export {
  nesPalette,
  nesPaletteFlat,
  nesColorToAnsi256,
  nesColorToHex,
  nesColorToTrueColor,
  nesColorToBgTrueColor,
  nesColorLuminance,
  nesColorToEmoji,
} from '../rendering/palette.js';
