/**
 * Shared ANSI escape sequence utilities.
 */

import { clamp } from 'remeda';
import { COLOR_MAX } from '../consts';

export * from './consts';

import { ESC, RESET, HALF_BLOCK_TOP } from './consts';

/**
 * Move cursor to specific position (1-based row and column).
 */
export const moveCursor = (row: number, col: number): string => `${ESC}[${row};${col}H`;

/**
 * Move cursor to top-left corner.
 */
export const moveCursorHome = (): string => `${ESC}[H`;

/**
 * Move cursor to specific row, column 1.
 */
export const moveCursorToRow = (row: number): string => `${ESC}[${row};1H`;

/**
 * Clear entire screen and move cursor home.
 */
export const clearScreen = (): string => `${ESC}[2J${ESC}[H`;

/**
 * Clear from cursor to end of line.
 */
export const clearLine = (): string => `${ESC}[K`;

/**
 * Hide cursor.
 */
export const hideCursor = (): string => `${ESC}[?25l`;

/**
 * Show cursor.
 */
export const showCursor = (): string => `${ESC}[?25h`;

/**
 * Set foreground color using 24-bit true color.
 * Clamps values to 0-255 and defaults undefined/NaN to 0.
 */
export const fgTrueColor = (r: number, g: number, b: number): string => {
  const safeR = Number.isFinite(r) ? clamp(r, { min: 0, max: COLOR_MAX }) : 0;
  const safeG = Number.isFinite(g) ? clamp(g, { min: 0, max: COLOR_MAX }) : 0;
  const safeB = Number.isFinite(b) ? clamp(b, { min: 0, max: COLOR_MAX }) : 0;
  return `${ESC}[38;2;${safeR};${safeG};${safeB}m`;
};

/**
 * Set background color using 24-bit true color.
 * Clamps values to 0-255 and defaults undefined/NaN to 0.
 */
export const bgTrueColor = (r: number, g: number, b: number): string => {
  const safeR = Number.isFinite(r) ? clamp(r, { min: 0, max: COLOR_MAX }) : 0;
  const safeG = Number.isFinite(g) ? clamp(g, { min: 0, max: COLOR_MAX }) : 0;
  const safeB = Number.isFinite(b) ? clamp(b, { min: 0, max: COLOR_MAX }) : 0;
  return `${ESC}[48;2;${safeR};${safeG};${safeB}m`;
};

/**
 * Set foreground color using ANSI 256-color palette.
 * Clamps values to 0-255 and defaults undefined/NaN to 0.
 */
export const fgAnsi256 = (code: number): string => {
  const safeCode = Number.isFinite(code) ? clamp(Math.floor(code), { min: 0, max: COLOR_MAX }) : 0;
  return `${ESC}[38;5;${safeCode}m`;
};

/**
 * Set background color using ANSI 256-color palette.
 * Clamps values to 0-255 and defaults undefined/NaN to 0.
 */
export const bgAnsi256 = (code: number): string => {
  const safeCode = Number.isFinite(code) ? clamp(Math.floor(code), { min: 0, max: COLOR_MAX }) : 0;
  return `${ESC}[48;5;${safeCode}m`;
};

/**
 * Render a half-block character with top and bottom colors (true color).
 */
export const halfBlockTrueColor = (topR: number, topG: number, topB: number, bottomR: number, bottomG: number, bottomB: number): string => fgTrueColor(topR, topG, topB) +
         bgTrueColor(bottomR, bottomG, bottomB) +
         HALF_BLOCK_TOP + RESET;

/**
 * Render a half-block character with top and bottom colors (256-color).
 */
export const halfBlockAnsi256 = (fgCode: number, bgCode: number): string => fgAnsi256(fgCode) + bgAnsi256(bgCode) + HALF_BLOCK_TOP + RESET;

/**
 * Render a grayscale half-block character.
 */
export const halfBlockGrayscale = (topGray: number, bottomGray: number): string => fgTrueColor(topGray, topGray, topGray) +
         bgTrueColor(bottomGray, bottomGray, bottomGray) +
         HALF_BLOCK_TOP + RESET;
