import { logger } from '../../utils/logger';
import { getTerminalDimensions } from '../../utils/terminal';
import { DEFAULT_SOURCE_WIDTH, DEFAULT_SOURCE_HEIGHT } from '../../rendering';
import { ASPECT_RATIO_DECIMALS } from '../../frontend';

/**
 * Calculate optimal dimensions for terminal/ASCII/emoji rendering.
 * sourceWidth/sourceHeight: core framebuffer dimensions
 * pixelAspectRatio: PAR for the core (e.g., 8/7 for NES, 1.0 for GBC)
 */
export const calculateTerminalDimensions = (
  mode: 'terminal' | 'ascii' | 'emoji',
  sourceWidth: number = DEFAULT_SOURCE_WIDTH,
  sourceHeight: number = DEFAULT_SOURCE_HEIGHT,
  pixelAspectRatio: number = 1.0
): { width: number; height: number } => {
  const { width: termCols, height: termRows } = getTerminalDimensions();

  // Leave 2 rows for status line
  const availableRows = termRows - 2;

  // Calculate display aspect ratio from source dimensions and PAR
  // displayAspect = (sourceWidth * PAR) / sourceHeight
  const displayAspect = (sourceWidth * pixelAspectRatio) / sourceHeight;

  // Terminal cells are roughly 1:2 (width:height), so we multiply by 2 below
  // to compensate when calculating character columns from pixel dimensions

  if (mode === 'emoji') {
    // Emoji: 1 emoji = 1 pixel, each emoji is 2 terminal columns wide
    // Emojis appear roughly square (2 cols × 1 row ≈ square due to cell aspect)
    // width / height = displayAspect
    let height = availableRows;
    let width = Math.floor(height * displayAspect);
    const displayCols = width * 2; // Actual terminal columns needed

    if (displayCols > termCols) {
      width = Math.floor(termCols / 2);
      height = Math.floor(width / displayAspect);
    }

    return { width, height };
  } else if (mode === 'ascii') {
    // ASCII: 1 char = 1 pixel
    // To maintain display aspect, account for cell aspect ratio
    // displayAspect = (cols * cellWidth) / (rows * cellHeight)
    // displayAspect = cols / (rows * 2) => cols = rows * 2 * displayAspect
    let height = availableRows;
    let width = Math.floor(height * 2 * displayAspect);

    if (width > termCols) {
      width = termCols;
      height = Math.floor(width / (2 * displayAspect));
    }

    return { width, height };
  } else {
    // Terminal half-block mode: 1 char = 1x2 pixels
    // Each half-block character covers 2 vertical pixels
    // displayAspect = (cols * cellWidth) / ((rows * 2) * cellHeight)
    // With cellAspect = 0.5: displayAspect = cols / (rows * 4)
    // But half-blocks double vertical resolution: cols = rows * 2 * displayAspect
    let height = availableRows;
    let width = Math.floor(height * 2 * displayAspect);

    if (width > termCols) {
      width = termCols;
      height = Math.floor(width / (2 * displayAspect));
    }

    logger.debug(
      `Terminal dims: ${width}x${height} (term: ${termCols}x${termRows}, ` +
      `source: ${sourceWidth}x${sourceHeight}, aspect: ${displayAspect.toFixed(ASPECT_RATIO_DECIMALS)})`,
      'Render'
    );

    return { width, height };
  }
};
