/**
 * Pixel format conversion utilities for libretro cores
 * Converts from libretro pixel formats to RGB24
 */

import { RETRO_PIXEL_FORMAT, FRAMEBUFFER_HEADROOM, RGB24_BYTES_PER_PIXEL } from "..";

import { logger } from "@/utils/logger";

// Pixel-format specific constants
import {
  XRGB8888_BYTES_PER_PIXEL,
  RGB16_BYTES_PER_PIXEL,
  MASK_5BIT,
  MASK_6BIT,
  RGB565_RED_SHIFT,
  RGB565_GREEN_SHIFT,
  XRGB1555_RED_SHIFT,
  XRGB1555_GREEN_SHIFT,
  SCALE_5BIT_TO_8BIT_SHIFT,
  SCALE_6BIT_TO_8BIT_SHIFT,
  REPLICATE_5BIT_SHIFT,
  REPLICATE_6BIT_SHIFT,
} from "./consts";

export * from './consts';

// Reusable output buffer to avoid allocations per frame
let outputBuffer: Uint8Array | null = null;
let outputBufferCapacity = 0;

/** Region bounds for cropped conversion */
interface ConvertBounds {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Convert a libretro framebuffer to RGB24 format
 *
 * @param data Raw framebuffer data from the core
 * @param width Frame width in pixels (full source frame)
 * @param height Frame height in pixels (full source frame)
 * @param pitch Row stride in bytes (may be larger than width * bytesPerPixel)
 * @param format Pixel format (XRGB1555, RGB565, or XRGB8888)
 * @param bounds Optional region to convert (if omitted, converts full frame)
 * @returns RGB24 framebuffer (3 bytes per pixel: R, G, B)
 */
export const convertFramebuffer = (
  data: Uint8Array,
  width: number,
  height: number,
  pitch: number,
  format: number,
  bounds?: ConvertBounds
): Uint8Array => {
  // Use bounds if provided, otherwise convert full frame
  const outWidth = bounds?.width ?? width;
  const outHeight = bounds?.height ?? height;
  const outputSize = outWidth * outHeight * RGB24_BYTES_PER_PIXEL;

  // Reuse buffer if possible
  if (!outputBuffer || outputBufferCapacity < outputSize) {
    outputBufferCapacity = outputSize + FRAMEBUFFER_HEADROOM;
    outputBuffer = new Uint8Array(outputBufferCapacity);
  }

  const output = outputBuffer;

  switch (format) {
    case RETRO_PIXEL_FORMAT.XRGB8888:
      convertXRGB8888(data, width, pitch, output, bounds);
      break;

    case RETRO_PIXEL_FORMAT.RGB565:
      convertRGB565(data, width, pitch, output, bounds);
      break;

    case RETRO_PIXEL_FORMAT.XRGB1555:
    default:
      convertXRGB1555(data, width, pitch, output, bounds);
      break;
  }

  // Return a view of just the used portion
  return output.subarray(0, outputSize);
};

/**
 * Convert XRGB8888 (32-bit) to RGB24
 * Format: XXXXXXXX RRRRRRRR GGGGGGGG BBBBBBBB (little-endian: B G R X)
 */
const convertXRGB8888 = (
  data: Uint8Array,
  sourceWidth: number,
  pitch: number,
  output: Uint8Array,
  bounds?: ConvertBounds
): void => {
  const startX = bounds?.left ?? 0;
  const startY = bounds?.top ?? 0;
  const outWidth = bounds?.width ?? sourceWidth;
  const outHeight = bounds?.height ?? Math.floor(data.length / pitch);
  let outIdx = 0;

  for (let y = 0; y < outHeight; y++) {
    const srcY = startY + y;
    const rowOffset = srcY * pitch;

    for (let x = 0; x < outWidth; x++) {
      const srcX = startX + x;
      const idx = rowOffset + srcX * XRGB8888_BYTES_PER_PIXEL;
      // Little-endian: B at idx+0, G at idx+1, R at idx+2, X at idx+3
      output[outIdx++] = data[idx + 2]; // R
      output[outIdx++] = data[idx + 1]; // G
      output[outIdx++] = data[idx]; // B
    }
  }
};

/**
 * Convert RGB565 (16-bit) to RGB24
 * Format: RRRRRGGG GGGBBBBB (little-endian)
 * Uses DataView for efficient 16-bit reads.
 */
const convertRGB565 = (
  data: Uint8Array,
  sourceWidth: number,
  pitch: number,
  output: Uint8Array,
  bounds?: ConvertBounds
): void => {
  const startX = bounds?.left ?? 0;
  const startY = bounds?.top ?? 0;
  const outWidth = bounds?.width ?? sourceWidth;
  const outHeight = bounds?.height ?? Math.floor(data.length / pitch);
  let outIdx = 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let y = 0; y < outHeight; y++) {
    const srcY = startY + y;
    const rowOffset = srcY * pitch;

    for (let x = 0; x < outWidth; x++) {
      const srcX = startX + x;
      const idx = rowOffset + srcX * RGB16_BYTES_PER_PIXEL;
      const pixel = view.getUint16(idx, true); // true = little-endian

      // Extract 5-bit R, 6-bit G, 5-bit B
      const r5 = (pixel >> RGB565_RED_SHIFT) & MASK_5BIT;
      const g6 = (pixel >> RGB565_GREEN_SHIFT) & MASK_6BIT;
      const b5 = pixel & MASK_5BIT;

      // Scale to 8-bit (replicate upper bits into lower bits for accuracy)
      output[outIdx++] = (r5 << SCALE_5BIT_TO_8BIT_SHIFT) | (r5 >> REPLICATE_5BIT_SHIFT);
      output[outIdx++] = (g6 << SCALE_6BIT_TO_8BIT_SHIFT) | (g6 >> REPLICATE_6BIT_SHIFT);
      output[outIdx++] = (b5 << SCALE_5BIT_TO_8BIT_SHIFT) | (b5 >> REPLICATE_5BIT_SHIFT);
    }
  }
};

/**
 * Convert XRGB1555 (15-bit) to RGB24
 * Format: XRRRRRGG GGGBBBBB (little-endian, X bit is ignored)
 * Uses DataView for efficient 16-bit reads.
 */
const convertXRGB1555 = (
  data: Uint8Array,
  sourceWidth: number,
  pitch: number,
  output: Uint8Array,
  bounds?: ConvertBounds
): void => {
  const startX = bounds?.left ?? 0;
  const startY = bounds?.top ?? 0;
  const outWidth = bounds?.width ?? sourceWidth;
  const outHeight = bounds?.height ?? Math.floor(data.length / pitch);
  let outIdx = 0;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let y = 0; y < outHeight; y++) {
    const srcY = startY + y;
    const rowOffset = srcY * pitch;

    for (let x = 0; x < outWidth; x++) {
      const srcX = startX + x;
      const idx = rowOffset + srcX * RGB16_BYTES_PER_PIXEL;
      const pixel = view.getUint16(idx, true); // true = little-endian

      // Extract 5-bit R, G, B (bit 15 is X, ignored)
      const r5 = (pixel >> XRGB1555_RED_SHIFT) & MASK_5BIT;
      const g5 = (pixel >> XRGB1555_GREEN_SHIFT) & MASK_5BIT;
      const b5 = pixel & MASK_5BIT;

      // Scale to 8-bit (replicate upper bits into lower bits for accuracy)
      output[outIdx++] = (r5 << SCALE_5BIT_TO_8BIT_SHIFT) | (r5 >> REPLICATE_5BIT_SHIFT);
      output[outIdx++] = (g5 << SCALE_5BIT_TO_8BIT_SHIFT) | (g5 >> REPLICATE_5BIT_SHIFT);
      output[outIdx++] = (b5 << SCALE_5BIT_TO_8BIT_SHIFT) | (b5 >> REPLICATE_5BIT_SHIFT);
    }
  }
};

/**
 * Get bytes per pixel for a given format
 */
export const getBytesPerPixel = (format: number): number => {
  switch (format) {
    case RETRO_PIXEL_FORMAT.XRGB8888:
      return XRGB8888_BYTES_PER_PIXEL;
    case RETRO_PIXEL_FORMAT.RGB565:
    case RETRO_PIXEL_FORMAT.XRGB1555:
    default:
      return RGB16_BYTES_PER_PIXEL;
  }
};

/**
 * Get the format name for debugging
 */
export const getFormatName = (format: number): string => {
  switch (format) {
    case RETRO_PIXEL_FORMAT.XRGB8888:
      return "XRGB8888";
    case RETRO_PIXEL_FORMAT.RGB565:
      return "RGB565";
    case RETRO_PIXEL_FORMAT.XRGB1555:
      return "XRGB1555";
    default:
      return `Unknown(${format})`;
  }
};

/** Content bounds detected in framebuffer */
export interface ContentBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

/** Threshold for considering a row/column as blank (0-255) */
const BLANK_VARIANCE_THRESHOLD = 10;

/** Minimum samples to check per row for blank detection */
const SAMPLES_PER_ROW = 16;

/**
 * Detect actual content bounds in an RGB24 framebuffer.
 * Finds the region of the frame that contains non-uniform content,
 * excluding blank/solid color borders that some systems output.
 *
 * @param data RGB24 framebuffer (3 bytes per pixel: R, G, B)
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @returns Content bounds or null if entire frame appears uniform
 */
export const detectContentBounds = (data: Uint8Array, width: number, height: number): ContentBounds | null => {
  // Find top bound (first non-blank row from top)
  let top = 0;
  for (let y = 0; y < height; y++) {
    if (!isRowBlank(data, width, y)) {
      top = y;
      break;
    }
  }

  // Find bottom bound (first non-blank row from bottom)
  let bottom = height - 1;
  for (let y = height - 1; y >= top; y--) {
    if (!isRowBlank(data, width, y)) {
      bottom = y;
      break;
    }
  }

  // Find left bound (first non-blank column from left)
  let left = 0;
  for (let x = 0; x < width; x++) {
    if (!isColumnBlank(data, width, height, x, top, bottom)) {
      left = x;
      break;
    }
  }

  // Find right bound (first non-blank column from right)
  let right = width - 1;
  for (let x = width - 1; x >= left; x--) {
    if (!isColumnBlank(data, width, height, x, top, bottom)) {
      right = x;
      break;
    }
  }

  const contentWidth = right - left + 1;
  const contentHeight = bottom - top + 1;

  // Debug: log detected bounds
  logger.debug(
    `detectContentBounds: top=${top}, bottom=${bottom}, left=${left}, right=${right} (content: ${contentWidth}x${contentHeight} of ${width}x${height})`,
    'Core'
  );

  // If detected bounds are the same as original, no cropping needed
  if (contentWidth === width && contentHeight === height) {
    return null;
  }

  // Only return bounds if we found meaningful content area
  // (at least 25% of original dimensions to avoid false positives)
  const MIN_CONTENT_RATIO = 0.25;
  if (contentWidth < width * MIN_CONTENT_RATIO || contentHeight < height * MIN_CONTENT_RATIO) {
    logger.debug('detectContentBounds: content too small, rejecting', 'Core');
    return null;
  }

  return { top, bottom, left, right, width: contentWidth, height: contentHeight };
};

/**
 * Check if a row is "blank" (uniform color or very low variance)
 */
const isRowBlank = (data: Uint8Array, width: number, y: number): boolean => {
  const rowStart = y * width * RGB24_BYTES_PER_PIXEL;

  // Sample pixels across the row
  const step = Math.max(1, Math.floor(width / SAMPLES_PER_ROW));
  const firstR = data[rowStart];
  const firstG = data[rowStart + 1];
  const firstB = data[rowStart + 2];

  for (let x = step; x < width; x += step) {
    const idx = rowStart + x * RGB24_BYTES_PER_PIXEL;
    const dr = Math.abs(data[idx] - firstR);
    const dg = Math.abs(data[idx + 1] - firstG);
    const db = Math.abs(data[idx + 2] - firstB);

    if (dr > BLANK_VARIANCE_THRESHOLD || dg > BLANK_VARIANCE_THRESHOLD || db > BLANK_VARIANCE_THRESHOLD) {
      return false; // Row has varied content
    }
  }

  return true; // Row is uniform
};

/**
 * Check if a column is "blank" (uniform color) within the content area
 */
const isColumnBlank = (data: Uint8Array, width: number, _height: number, x: number, top: number, bottom: number): boolean => {
  const firstIdx = (top * width + x) * RGB24_BYTES_PER_PIXEL;
  const firstR = data[firstIdx];
  const firstG = data[firstIdx + 1];
  const firstB = data[firstIdx + 2];

  // Sample pixels down the column
  const colHeight = bottom - top + 1;
  const step = Math.max(1, Math.floor(colHeight / SAMPLES_PER_ROW));

  for (let y = top + step; y <= bottom; y += step) {
    const idx = (y * width + x) * RGB24_BYTES_PER_PIXEL;
    const dr = Math.abs(data[idx] - firstR);
    const dg = Math.abs(data[idx + 1] - firstG);
    const db = Math.abs(data[idx + 2] - firstB);

    if (dr > BLANK_VARIANCE_THRESHOLD || dg > BLANK_VARIANCE_THRESHOLD || db > BLANK_VARIANCE_THRESHOLD) {
      return false;
    }
  }

  return true;
};

/**
 * Check if an RGB24 framebuffer has any actual content (non-uniform pixels).
 * Used to determine if a frame is worth analyzing for content bounds,
 * or if it's still a blank/loading frame that should be skipped.
 *
 * @param data RGB24 framebuffer (3 bytes per pixel: R, G, B)
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @returns true if frame has varied content, false if entirely uniform
 */
export const hasFrameContent = (data: Uint8Array, width: number, height: number): boolean => {
  // Sample rows across the frame to check for any non-uniform content
  const rowStep = Math.max(1, Math.floor(height / SAMPLES_PER_ROW));

  for (let y = 0; y < height; y += rowStep) {
    if (!isRowBlank(data, width, y)) {
      return true; // Found a row with varied content
    }
  }

  return false; // All sampled rows are uniform (blank frame)
};
