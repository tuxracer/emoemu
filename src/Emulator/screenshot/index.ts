import { writeFileSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import sharp from 'sharp';
import { VERSION_WITH_DATE as VERSION } from '../../consts';
import { isRgb15Buffer, type Core, type SystemInfo } from '../../core/core';
import type { Config } from '../../frontend/config';
import { getRomTitle } from '../../frontend/romScanner';
import { getSystemName } from '../../frontend/playlist';
import { notifyScreenshotSaved } from '../../frontend/notifications';
import { getThumbnailPath } from '../../utils/paths';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { rgb15ToRgb24 } from '../../utils/color';
import { ensureDirectory } from '../../utils/ensureDirectory';
import { RGB24_BYTES_PER_PIXEL } from '../../rendering';
import { TWO_DIGIT_YEAR_SLICE_START, ISO_DATETIME_LENGTH } from '../../frontend';

/**
 * Get the screenshot directory, using config setting or ROM directory as fallback.
 */
export const getScreenshotDirectory = (config: Config | null, romPath: string): string => {
  if (config?.screenshot_directory && config.screenshot_directory.length > 0) {
    return config.screenshot_directory;
  }
  return dirname(romPath);
};

/**
 * Generate screenshot filename using RetroArch naming convention.
 * Format: GameName-YYMMDD-HHMMSS.png
 */
export const generateScreenshotFilename = (romPath: string): string => {
  const romName = basename(romPath, extname(romPath));
  const now = new Date();
  const year = String(now.getFullYear()).slice(TWO_DIGIT_YEAR_SLICE_START);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${romName}-${year}${month}${day}-${hours}${minutes}${seconds}.png`;
};

/**
 * Capture a PNG screenshot asynchronously.
 * @returns Promise resolving to PNG buffer
 */
export const captureScreenshotAsync = async (
  core: Core,
  systemInfo: SystemInfo,
  romPath: string
): Promise<Buffer | null> => {
  try {
    const frameBuffer = core.getFramebuffer();
    const { width, height, colorSpace } = systemInfo;
    const pixelCount = width * height;

    // Convert framebuffer to RGB24
    const rgb = new Uint8Array(pixelCount * RGB24_BYTES_PER_PIXEL);

    if (isRgb15Buffer(colorSpace, frameBuffer)) {
      // RGB15 (xBBBBBGGGGGRRRRR) - convert to RGB24
      for (let i = 0; i < pixelCount; i++) {
        const [r, g, b] = rgb15ToRgb24(frameBuffer[i]);
        rgb[i * RGB24_BYTES_PER_PIXEL] = r;
        rgb[i * RGB24_BYTES_PER_PIXEL + 1] = g;
        rgb[i * RGB24_BYTES_PER_PIXEL + 2] = b;
      }
    } else {
      // RGB24 - copy directly
      rgb.set(frameBuffer);
    }

    // Encode to 256-color indexed PNG for smaller file size
    // Add EXIF metadata with emoemu version, game title, core name, and timestamp
    // DateTimeOriginal is stored in UTC with OffsetTimeOriginal indicating +00:00
    const now = new Date();
    const utcDateTime = now.toISOString().replace('T', ' ').slice(0, ISO_DATETIME_LENGTH).replace(/-/g, ':');

    // Get ROM title from embedded metadata, fallback to filename without extension
    const romTitle = getRomTitle(romPath) ?? basename(romPath, extname(romPath));
    const imageDescription = `${romTitle} (${systemInfo.name})`;

    return await sharp(Buffer.from(rgb.buffer), {
      raw: { width, height, channels: 3 },
    })
      .withExif({
        IFD0: {
          Software: `emoemu ${VERSION}`,
          ImageDescription: imageDescription,
        },
        IFD2: {
          DateTimeOriginal: utcDateTime,
          OffsetTimeOriginal: '+00:00',
        },
      })
      .png({ palette: true, compressionLevel: 9, effort: 10 })
      .toBuffer();
  } catch (err) {
    logger.error(`Failed to capture screenshot: ${getErrorMessage(err)}`, 'Screenshot');
    return null;
  }
};

/**
 * Take a screenshot and save to file.
 * Uses RetroArch naming convention: GameName-YYMMDD-HHMMSS.png
 */
export const takeScreenshot = (
  core: Core,
  systemInfo: SystemInfo,
  romPath: string,
  config: Config | null
): void => {
  void captureScreenshotAsync(core, systemInfo, romPath).then((pngBuffer) => {
    if (!pngBuffer) {
      return;
    }

    const screenshotDir = getScreenshotDirectory(config, romPath);
    const filename = generateScreenshotFilename(romPath);
    const filepath = join(screenshotDir, filename);

    try {
      ensureDirectory(screenshotDir);
      writeFileSync(filepath, pngBuffer);
      notifyScreenshotSaved(filename);
    } catch (err) {
      logger.error(`Failed to save screenshot: ${filepath} - ${getErrorMessage(err)}`, 'Screenshot');
    }
  });
};

/**
 * Save a screenshot as a RetroArch-compatible thumbnail.
 * Currently saves as 'snap' type (in-game screenshot) in Named_Snaps directory.
 */
export const saveThumbnailScreenshot = async (
  core: Core,
  systemInfo: SystemInfo,
  romPath: string
): Promise<void> => {
  const romExt = extname(romPath);
  const systemName = getSystemName(romExt, systemInfo.id);
  const romTitle = getRomTitle(romPath) ?? basename(romPath, extname(romPath));
  const thumbnailPath = getThumbnailPath(systemName, romTitle, 'snap');
  const thumbnailDir = dirname(thumbnailPath);

  try {
    const screenshot = await captureScreenshotAsync(core, systemInfo, romPath);
    if (!screenshot) {
      return;
    }

    ensureDirectory(thumbnailDir);
    writeFileSync(thumbnailPath, screenshot);
  } catch {
    // Silently ignore thumbnail errors - don't disrupt save state operation
  }
};
