/**
 * Shared color conversion utilities used across renderers.
 */

export * from './consts';

import { firstBy } from 'remeda';
import {
  RGB15_RED_MASK,
  RGB15_GREEN_MASK,
  RGB15_GREEN_SHIFT,
  RGB15_BLUE_SHIFT,
  RGB5_TO_8_LEFT_SHIFT,
  RGB5_TO_8_RIGHT_SHIFT,
  MAX_8BIT,
  LUT_SIZE_8BIT,
  DEFAULT_GAMMA,
  GREEN_WEIGHT,
  GRAYSCALE_THRESHOLD,
  ANSI_COLOR_CUBE_START,
  ANSI_COLOR_CUBE_LEVELS,
  ANSI_RED_MULTIPLIER,
  ANSI_GREEN_MULTIPLIER,
  LUMINANCE_R,
  LUMINANCE_G,
  LUMINANCE_B,
} from './consts';

/**
 * Extract RGB components from RGB15 format (XBBBBBGGGGGRRRRR).
 * Returns 5-bit values (0-31).
 */
export const extractRgb15Components = (color: number): [number, number, number] => {
  const r5 = color & RGB15_RED_MASK;
  const g5 = (color >> RGB15_GREEN_SHIFT) & RGB15_GREEN_MASK;
  const b5 = (color >> RGB15_BLUE_SHIFT) & RGB15_GREEN_MASK;
  return [r5, g5, b5];
};

/**
 * Expand 5-bit color component to 8-bit.
 * Uses bit replication for proper range mapping (0-31 -> 0-255).
 */
export const expand5to8 = (value: number): number => (value << RGB5_TO_8_LEFT_SHIFT) | (value >> RGB5_TO_8_RIGHT_SHIFT);

/**
 * Convert RGB15 color to RGB24.
 * Returns 8-bit RGB components (0-255).
 */
export const rgb15ToRgb24 = (color: number): [number, number, number] => {
  const r5 = color & RGB15_RED_MASK;
  const g5 = (color >> RGB15_GREEN_SHIFT) & RGB15_GREEN_MASK;
  const b5 = (color >> RGB15_BLUE_SHIFT) & RGB15_GREEN_MASK;
  return [
    (r5 << RGB5_TO_8_LEFT_SHIFT) | (r5 >> RGB5_TO_8_RIGHT_SHIFT),
    (g5 << RGB5_TO_8_LEFT_SHIFT) | (g5 >> RGB5_TO_8_RIGHT_SHIFT),
    (b5 << RGB5_TO_8_LEFT_SHIFT) | (b5 >> RGB5_TO_8_RIGHT_SHIFT),
  ];
};

/**
 * Calculate luminance from RGB values (0-255).
 * Returns normalized luminance (0.0 - 1.0).
 */
export const calculateLuminance = (r: number, g: number, b: number): number => (LUMINANCE_R * r + LUMINANCE_G * g + LUMINANCE_B * b) / MAX_8BIT;

/**
 * Calculate luminance as 8-bit integer (0-255).
 */
export const calculateLuminance8 = (r: number, g: number, b: number): number => Math.round(LUMINANCE_R * r + LUMINANCE_G * g + LUMINANCE_B * b);

/**
 * Calculate luminance from RGB15 color.
 * Returns normalized luminance (0.0 - 1.0).
 */
export const rgb15ToLuminance = (color: number): number => {
  const [r, g, b] = rgb15ToRgb24(color);
  return calculateLuminance(r, g, b);
};

/**
 * Convert RGB to grayscale value (0-255).
 */
export const rgbToGrayscale = (r: number, g: number, b: number): number => Math.round(LUMINANCE_R * r + LUMINANCE_G * g + LUMINANCE_B * b);

// Emoji color definitions for color matching
export interface EmojiColor {
  emoji: string;
  rgb: [number, number, number];
}

/* eslint-disable @typescript-eslint/no-magic-numbers */
// Emoji colors tuned for general RGB matching
export const EMOJI_COLORS: EmojiColor[] = [
  { emoji: '\u2b1c', rgb: [255, 255, 255] },  // White square
  { emoji: '\ud83d\udfe8', rgb: [250, 220, 80] },   // Yellow
  { emoji: '\ud83d\udfe7', rgb: [240, 140, 20] },   // Orange
  { emoji: '\ud83d\udfe5', rgb: [220, 40, 40] },    // Red
  { emoji: '\ud83d\udfeb', rgb: [130, 80, 30] },    // Brown
  { emoji: '\ud83d\udfe9', rgb: [50, 160, 30] },    // Green
  { emoji: '\ud83d\udfe6', rgb: [50, 120, 220] },   // Blue
  { emoji: '\ud83d\udfea', rgb: [160, 70, 200] },   // Purple
  { emoji: '\u2b1b', rgb: [0, 0, 0] },         // Black square
];
/* eslint-enable @typescript-eslint/no-magic-numbers */

/**
 * Calculate squared color distance (no sqrt needed for comparison).
 * Green is weighted more heavily (human eye sensitivity).
 */
export const colorDistanceSquared = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number => {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  // Weight green more heavily
  return dr * dr + dg * dg * GREEN_WEIGHT + db * db;
};

/**
 * Find the closest matching emoji for an RGB color.
 */
export const findClosestEmoji = (r: number, g: number, b: number): string => {
  const closest = firstBy(EMOJI_COLORS, [({ rgb }) => colorDistanceSquared(r, g, b, rgb[0], rgb[1], rgb[2]), 'asc']);
  return closest?.emoji ?? EMOJI_COLORS[0].emoji;
};

/**
 * Get grayscale emoji (black or white) based on luminance.
 */
export const getGrayscaleEmoji = (luminance: number): string => luminance >= GRAYSCALE_THRESHOLD ? '\u2b1c' : '\u2b1b';

/**
 * Find closest emoji for RGB15 color.
 */
export const rgb15ToEmoji = (color: number): string => {
  const [r, g, b] = rgb15ToRgb24(color);
  return findClosestEmoji(r, g, b);
};

/**
 * Get grayscale emoji for RGB15 color.
 */
export const rgb15ToGrayscaleEmoji = (color: number): string => getGrayscaleEmoji(rgb15ToLuminance(color));

/**
 * Find closest emoji for RGB24 color.
 */
export const rgb24ToEmoji = (r: number, g: number, b: number): string => findClosestEmoji(r, g, b);

/**
 * Get grayscale emoji for RGB24 color.
 */
export const rgb24ToGrayscaleEmoji = (r: number, g: number, b: number): string => getGrayscaleEmoji(calculateLuminance(r, g, b));

/**
 * Convert RGB to ANSI 256-color code (6x6x6 color cube).
 */
export const rgbToAnsi256 = (r: number, g: number, b: number): number => {
  const r6 = Math.round((r / MAX_8BIT) * (ANSI_COLOR_CUBE_LEVELS - 1));
  const g6 = Math.round((g / MAX_8BIT) * (ANSI_COLOR_CUBE_LEVELS - 1));
  const b6 = Math.round((b / MAX_8BIT) * (ANSI_COLOR_CUBE_LEVELS - 1));
  return ANSI_COLOR_CUBE_START + (ANSI_RED_MULTIPLIER * r6) + (ANSI_GREEN_MULTIPLIER * g6) + b6;
};

/**
 * Build gamma correction lookup table.
 * gamma = 1.0: no change
 * gamma > 1.0: darkens midtones (CRT-like)
 * gamma < 1.0: brightens midtones
 */
export const buildGammaLUT = (gamma: number): Uint8Array => {
  const lut = new Uint8Array(LUT_SIZE_8BIT);
  if (gamma === DEFAULT_GAMMA) {
    for (let i = 0; i < LUT_SIZE_8BIT; i++) {
      lut[i] = i;
    }
  } else {
    for (let i = 0; i < LUT_SIZE_8BIT; i++) {
      lut[i] = Math.round(Math.pow(i / MAX_8BIT, gamma) * MAX_8BIT);
    }
  }
  return lut;
};
