/**
 * Half-block Thumbnail Renderer
 *
 * Renders thumbnails using Unicode half-block characters (▀) for terminals
 * that don't support the Kitty graphics protocol. Each character represents
 * 2 vertical pixels using foreground (top) and background (bottom) colors.
 */

import sharp from 'sharp';
import { fgTrueColor, bgTrueColor, HALF_BLOCK_TOP, RESET, moveCursor } from '../../rendering/shared/ansi';

export * from './consts';

import { RGB_CHANNELS } from './consts';

/**
 * Rendered thumbnail result with rows of ANSI-colored half-block characters.
 */
export interface RenderedThumbnail {
  /** Array of strings, one per terminal row */
  rows: string[];
  /** Width in terminal columns */
  width: number;
  /** Height in terminal rows */
  height: number;
}

/**
 * Decode a base64 PNG and render it as half-block characters.
 *
 * @param base64Data - Base64-encoded PNG image data
 * @param targetCols - Target width in terminal columns
 * @param targetRows - Target height in terminal rows (each row = 2 pixels)
 * @returns Promise resolving to rendered thumbnail or undefined on error
 */
export const renderThumbnailHalfBlocks = async (
  base64Data: string,
  targetCols: number,
  targetRows: number
): Promise<RenderedThumbnail | undefined> => {
  try {
    const buffer = Buffer.from(base64Data, 'base64');

    // Target pixel dimensions: width = cols, height = rows * 2 (half-blocks)
    const targetWidth = targetCols;
    const targetHeight = targetRows * 2;

    // Decode and resize PNG to target dimensions
    const { data, info } = await sharp(buffer)
      .resize(targetWidth, targetHeight, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height } = info;
    const rows: string[] = [];

    // Process 2 rows of pixels at a time to create half-block characters
    for (let y = 0; y < height; y += 2) {
      let row = '';

      for (let x = 0; x < width; x++) {
        // Top pixel (foreground)
        const topIdx = (y * width + x) * RGB_CHANNELS;
        const topR = data[topIdx];
        const topG = data[topIdx + 1];
        const topB = data[topIdx + 2];

        // Bottom pixel (background) - may not exist if height is odd
        const bottomY = y + 1;
        let bottomR = 0, bottomG = 0, bottomB = 0;

        if (bottomY < height) {
          const bottomIdx = (bottomY * width + x) * RGB_CHANNELS;
          bottomR = data[bottomIdx];
          bottomG = data[bottomIdx + 1];
          bottomB = data[bottomIdx + 2];
        }

        row += fgTrueColor(topR, topG, topB) +
               bgTrueColor(bottomR, bottomG, bottomB) +
               HALF_BLOCK_TOP;
      }

      row += RESET;
      rows.push(row);
    }

    return {
      rows,
      width,
      height: rows.length,
    };
  } catch {
    return undefined;
  }
};

/**
 * Build ANSI escape sequence to render a half-block thumbnail at a specific position.
 *
 * @param thumbnail - Rendered thumbnail from renderThumbnailHalfBlocks
 * @param startRow - Starting row (1-based)
 * @param startCol - Starting column (1-based)
 * @returns Complete escape sequence string to render the thumbnail
 */
export const buildThumbnailSequence = (
  thumbnail: RenderedThumbnail,
  startRow: number,
  startCol: number
): string => {
  let output = '';

  for (let i = 0; i < thumbnail.rows.length; i++) {
    output += moveCursor(startRow + i, startCol) + thumbnail.rows[i];
  }

  return output;
};

/**
 * Build ANSI escape sequence to clear a thumbnail area (fill with spaces).
 *
 * @param width - Width in columns
 * @param height - Height in rows
 * @param startRow - Starting row (1-based)
 * @param startCol - Starting column (1-based)
 * @returns Escape sequence to clear the area
 */
export const buildThumbnailClearSequence = (
  width: number,
  height: number,
  startRow: number,
  startCol: number
): string => {
  let output = '';
  const spaces = ' '.repeat(width);

  for (let i = 0; i < height; i++) {
    output += moveCursor(startRow + i, startCol) + spaces;
  }

  return output;
};
