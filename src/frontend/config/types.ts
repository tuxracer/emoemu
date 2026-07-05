import { isString } from 'remeda';
import type { Config } from '.';

/**
 * Video driver/render mode options
 */
export type VideoDriver = "native" | "kitty" | "terminal" | "ascii" | "emoji";

/** One CLI flag override: a config key set on the command line, plus the flag that set it. */
export interface CliOverride {
  key: keyof Config;
  value: Config[keyof Config];
  flag: string;
}

/**
 * Post-processing mode options
 */
export type PostProcessingMode = "off" | "crt" | "custom";

/** Valid video driver values (must match VideoDriver type) */
export const VIDEO_DRIVERS: readonly VideoDriver[] = ['native', 'kitty', 'terminal', 'ascii', 'emoji'];

/** Valid post-processing mode values (must match PostProcessingMode type) */
export const POST_PROCESSING_MODES: readonly PostProcessingMode[] = ['off', 'crt', 'custom'];

const videoDriverSet = new Set<string>(VIDEO_DRIVERS);
const postProcessingModeSet = new Set<string>(POST_PROCESSING_MODES);

/**
 * Type guard for VideoDriver union type.
 * Validates that a value is one of the valid video driver options.
 */
export const isVideoDriver = (value: unknown): value is VideoDriver => {
  return isString(value) && videoDriverSet.has(value);
};

/**
 * Type guard for PostProcessingMode union type.
 * Validates that a value is one of the valid post-processing modes.
 */
export const isPostProcessingMode = (value: unknown): value is PostProcessingMode => {
  return isString(value) && postProcessingModeSet.has(value);
};
