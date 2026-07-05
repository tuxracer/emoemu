/**
 * Type guards for validating partial libretro structs decoded from FFI
 */

import { isString, isNumber, isBoolean, isPlainObject } from 'remeda';

/**
 * Type guard that validates a value is a plain object with string keys.
 * Unlike isPlainObject, this narrows to Record<string, unknown> which
 * allows safe property access with string keys.
 */
const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (!isPlainObject(value)) {
    return false;
  }
  // Verify all keys are strings (not symbols)
  return Object.keys(value).every((key) => typeof key === 'string');
};

/**
 * Partial RetroGameGeometry as decoded from koffi.
 * All properties are optional since FFI decoding may fail.
 */
export interface PartialRetroGameGeometry {
  base_width?: number;
  base_height?: number;
  max_width?: number;
  max_height?: number;
  aspect_ratio?: number;
}

/**
 * Type guard for partial RetroGameGeometry from FFI decoding.
 */
export const isPartialRetroGameGeometry = (value: unknown): value is PartialRetroGameGeometry => {
  if (!isRecord(value)) {
    return false;
  }

  if ('base_width' in value && !isNumber(value.base_width)) {
    return false;
  }
  if ('base_height' in value && !isNumber(value.base_height)) {
    return false;
  }
  if ('max_width' in value && !isNumber(value.max_width)) {
    return false;
  }
  if ('max_height' in value && !isNumber(value.max_height)) {
    return false;
  }
  if ('aspect_ratio' in value && !isNumber(value.aspect_ratio)) {
    return false;
  }

  return true;
};

/**
 * Partial RetroSystemTiming as decoded from koffi.
 */
export interface PartialRetroSystemTiming {
  fps?: number;
  sample_rate?: number;
}

/**
 * Type guard for partial RetroSystemTiming from FFI decoding.
 */
export const isPartialRetroSystemTiming = (value: unknown): value is PartialRetroSystemTiming => {
  if (!isRecord(value)) {
    return false;
  }

  if ('fps' in value && !isNumber(value.fps)) {
    return false;
  }
  if ('sample_rate' in value && !isNumber(value.sample_rate)) {
    return false;
  }

  return true;
};

/**
 * Partial RetroSystemAVInfo as decoded from koffi.
 * Contains nested geometry and timing objects.
 */
export interface PartialRetroSystemAVInfo {
  geometry?: PartialRetroGameGeometry;
  timing?: PartialRetroSystemTiming;
}

/**
 * Type guard for partial RetroSystemAVInfo from FFI decoding.
 */
export const isPartialRetroSystemAVInfo = (value: unknown): value is PartialRetroSystemAVInfo => {
  if (!isRecord(value)) {
    return false;
  }

  if ('geometry' in value && !isPartialRetroGameGeometry(value.geometry)) {
    return false;
  }
  if ('timing' in value && !isPartialRetroSystemTiming(value.timing)) {
    return false;
  }

  return true;
};

/**
 * Partial RetroSystemInfo as decoded from koffi.
 */
export interface PartialRetroSystemInfo {
  library_name?: string;
  library_version?: string;
  valid_extensions?: string;
  need_fullpath?: boolean;
  block_extract?: boolean;
}

/**
 * Type guard for partial RetroSystemInfo from FFI decoding.
 */
export const isPartialRetroSystemInfo = (value: unknown): value is PartialRetroSystemInfo => {
  if (!isRecord(value)) {
    return false;
  }

  if ('library_name' in value && !isString(value.library_name)) {
    return false;
  }
  if ('library_version' in value && !isString(value.library_version)) {
    return false;
  }
  if ('valid_extensions' in value && !isString(value.valid_extensions)) {
    return false;
  }
  if ('need_fullpath' in value && !isBoolean(value.need_fullpath)) {
    return false;
  }
  if ('block_extract' in value && !isBoolean(value.block_extract)) {
    return false;
  }

  return true;
};
