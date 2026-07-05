/**
 * Libretro type definitions and constants
 * Based on libretro.h from the libretro API
 */

import {
  MEMDESC_SAVE_RAM_BIT,
  MEMDESC_VIDEO_RAM_BIT,
  MEMDESC_ALIGN_BIT,
  MEMDESC_MINSIZE_BIT,
  MEMDESC_SIZE_8,
} from "./environment";
import { createTypedError } from "../../utils/typedError";

// Memory region IDs for retro_get_memory_data/size
export const RETRO_MEMORY = {
  SAVE_RAM: 0,
  RTC: 1,
  SYSTEM_RAM: 2,
  VIDEO_RAM: 3,
} as const;

// Memory descriptor flags for SET_MEMORY_MAPS
export const RETRO_MEMDESC = {
  CONST: 1 << 0,                          // Memory is read-only
  BIGENDIAN: 1 << 1,                      // Memory is big-endian
  SYSTEM_RAM: 1 << 2,                     // System RAM
  SAVE_RAM: 1 << MEMDESC_SAVE_RAM_BIT,    // Save RAM (battery-backed)
  VIDEO_RAM: 1 << MEMDESC_VIDEO_RAM_BIT,  // Video RAM
  ALIGN_2: 1 << MEMDESC_ALIGN_BIT,        // Alignment hints
  ALIGN_4: 2 << MEMDESC_ALIGN_BIT,
  ALIGN_8: MEMDESC_SIZE_8 << MEMDESC_ALIGN_BIT,
  MINSIZE_2: 1 << MEMDESC_MINSIZE_BIT,
  MINSIZE_4: 2 << MEMDESC_MINSIZE_BIT,
  MINSIZE_8: MEMDESC_SIZE_8 << MEMDESC_MINSIZE_BIT,
} as const;

// Device types for retro_set_controller_port_device
export const RETRO_DEVICE = {
  NONE: 0,
  JOYPAD: 1,
  MOUSE: 2,
  KEYBOARD: 3,
  LIGHTGUN: 4,
  ANALOG: 5,
  POINTER: 6,
} as const;

// Joypad button IDs for retro_input_state
export const RETRO_DEVICE_ID_JOYPAD = {
  B: 0,
  Y: 1,
  SELECT: 2,
  START: 3,
  UP: 4,
  DOWN: 5,
  LEFT: 6,
  RIGHT: 7,
  A: 8,
  X: 9,
  L: 10,
  R: 11,
  L2: 12,
  R2: 13,
  L3: 14,
  R3: 15,
} as const;

// Analog stick index for retro_input_state
export const RETRO_DEVICE_INDEX_ANALOG = {
  LEFT: 0,   // Left analog stick
  RIGHT: 1,  // Right analog stick
  BUTTON: 2, // Analog buttons (L2/R2 as analog)
} as const;

// Analog stick axis IDs for retro_input_state
export const RETRO_DEVICE_ID_ANALOG = {
  X: 0, // Horizontal axis (negative = left, positive = right)
  Y: 1, // Vertical axis (negative = up, positive = down)
} as const;

// Pixel format constants
export const RETRO_PIXEL_FORMAT = {
  XRGB1555: 0, // 15-bit color, X ignored (0RRRRRGGGGGBBBBB)
  XRGB8888: 1, // 32-bit XRGB (XXXXXXXX RRRRRRRR GGGGGGGG BBBBBBBB)
  RGB565: 2, // 16-bit RGB (RRRRRGGG GGGBBBBB)
} as const;

// Environment callback commands
export const RETRO_ENVIRONMENT = {
  // Experimental commands have bit 16 set
  EXPERIMENTAL: 0x10000,

  // Core info
  SET_ROTATION: 1,
  GET_OVERSCAN: 2,
  GET_CAN_DUPE: 3,
  SET_MESSAGE: 6,
  SHUTDOWN: 7,
  SET_PERFORMANCE_LEVEL: 8,
  GET_SYSTEM_DIRECTORY: 9,
  SET_PIXEL_FORMAT: 10,
  SET_INPUT_DESCRIPTORS: 11,
  SET_KEYBOARD_CALLBACK: 12,
  SET_DISK_CONTROL_INTERFACE: 13,
  SET_HW_RENDER: 14,
  GET_VARIABLE: 15,
  SET_VARIABLES: 16,
  GET_VARIABLE_UPDATE: 17,
  SET_SUPPORT_NO_GAME: 18,
  GET_LIBRETRO_PATH: 19,
  SET_FRAME_TIME_CALLBACK: 21,
  SET_AUDIO_CALLBACK: 22,
  GET_RUMBLE_INTERFACE: 23,
  GET_INPUT_DEVICE_CAPABILITIES: 24,
  GET_SENSOR_INTERFACE: 25,
  GET_CAMERA_INTERFACE: 26,
  GET_LOG_INTERFACE: 27,
  GET_PERF_INTERFACE: 28,
  GET_LOCATION_INTERFACE: 29,
  GET_CORE_ASSETS_DIRECTORY: 30,
  GET_SAVE_DIRECTORY: 31,
  SET_SYSTEM_AV_INFO: 32,
  SET_PROC_ADDRESS_CALLBACK: 33,
  SET_SUBSYSTEM_INFO: 34,
  SET_CONTROLLER_INFO: 35,
  SET_MEMORY_MAPS: 36,
  SET_GEOMETRY: 37,
  GET_USERNAME: 38,
  GET_LANGUAGE: 39,
  GET_CURRENT_SOFTWARE_FRAMEBUFFER: 40,
  GET_HW_RENDER_INTERFACE: 41,
  SET_SUPPORT_ACHIEVEMENTS: 42,
  SET_HW_RENDER_CONTEXT_NEGOTIATION_INTERFACE: 43,
  SET_SERIALIZATION_QUIRKS: 44,
  SET_HW_SHARED_CONTEXT: 44,
  GET_VFS_INTERFACE: 45,
  GET_LED_INTERFACE: 46,
  GET_AUDIO_VIDEO_ENABLE: 47,
  GET_MIDI_INTERFACE: 48,
  GET_FASTFORWARDING: 49,
  GET_TARGET_REFRESH_RATE: 50,
  GET_INPUT_BITMASKS: 51,
  GET_CORE_OPTIONS_VERSION: 52,
  SET_CORE_OPTIONS: 53,
  SET_CORE_OPTIONS_INTL: 54,
  SET_CORE_OPTIONS_DISPLAY: 55,
  GET_PREFERRED_HW_RENDER: 56,
  GET_DISK_CONTROL_INTERFACE_VERSION: 57,
  SET_DISK_CONTROL_EXT_INTERFACE: 58,
  GET_MESSAGE_INTERFACE_VERSION: 59,
  SET_MESSAGE_EXT: 60,
  GET_INPUT_MAX_USERS: 61,
  SET_AUDIO_BUFFER_STATUS_CALLBACK: 62,
  SET_MINIMUM_AUDIO_LATENCY: 63,
  SET_FASTFORWARDING_OVERRIDE: 64,
  SET_CONTENT_INFO_OVERRIDE: 65,
  GET_GAME_INFO_EXT: 66,
  SET_CORE_OPTIONS_V2: 67,
  SET_CORE_OPTIONS_V2_INTL: 68,
  SET_CORE_OPTIONS_UPDATE_DISPLAY_CALLBACK: 69,
  SET_VARIABLE: 70,
  GET_THROTTLE_STATE: 71,
  GET_SAVESTATE_CONTEXT: 72,
  GET_HW_RENDER_CONTEXT_NEGOTIATION_INTERFACE_SUPPORT: 73,
  GET_JIT_CAPABLE: 74,
  GET_MICROPHONE_INTERFACE: 75,
  GET_DEVICE_POWER: 77,
  SET_NETPACKET_INTERFACE: 78,
  GET_PLAYLIST_DIRECTORY: 79,
} as const;

// Log levels for GET_LOG_INTERFACE
export const RETRO_LOG = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
} as const;

// Message target for SET_MESSAGE_EXT
export const RETRO_MESSAGE_TARGET = {
  ALL: 0,  // Display on OSD and log
  OSD: 1,  // Display on OSD only
  LOG: 2,  // Log only (don't display on screen)
} as const;

// Message type for SET_MESSAGE_EXT
export const RETRO_MESSAGE_TYPE = {
  NOTIFICATION: 0,      // Standard notification
  NOTIFICATION_ALT: 1,  // Alternate notification slot
  STATUS: 2,            // Persistent status message
  PROGRESS: 3,          // Progress indicator
} as const;

// Region constants
export const RETRO_REGION = {
  NTSC: 0,
  PAL: 1,
} as const;

// Language constants
export const RETRO_LANGUAGE = {
  ENGLISH: 0,
  JAPANESE: 1,
  FRENCH: 2,
  SPANISH: 3,
  GERMAN: 4,
  ITALIAN: 5,
  DUTCH: 6,
  PORTUGUESE_BRAZIL: 7,
  PORTUGUESE_PORTUGAL: 8,
  RUSSIAN: 9,
  KOREAN: 10,
  CHINESE_TRADITIONAL: 11,
  CHINESE_SIMPLIFIED: 12,
  ESPERANTO: 13,
  POLISH: 14,
  VIETNAMESE: 15,
  ARABIC: 16,
  GREEK: 17,
  TURKISH: 18,
  SLOVAK: 19,
  PERSIAN: 20,
  HEBREW: 21,
  ASTURIAN: 22,
  FINNISH: 23,
  INDONESIAN: 24,
  SWEDISH: 25,
  UKRAINIAN: 26,
  CZECH: 27,
  CATALAN_VALENCIA: 28,
  CATALAN: 29,
  BRITISH_ENGLISH: 30,
  HUNGARIAN: 31,
  BELARUSIAN: 32,
  GALICIAN: 33,
  NORWEGIAN: 34,
  LAST: 35,
} as const;

// TypeScript interfaces for libretro structs
export interface RetroSystemInfo {
  library_name: string;
  library_version: string;
  valid_extensions: string;
  need_fullpath: boolean;
  block_extract: boolean;
}

export interface RetroGameGeometry {
  base_width: number;
  base_height: number;
  max_width: number;
  max_height: number;
  aspect_ratio: number;
}

export interface RetroSystemTiming {
  fps: number;
  sample_rate: number;
}

export interface RetroSystemAVInfo {
  geometry: RetroGameGeometry;
  timing: RetroSystemTiming;
}

export interface RetroGameInfo {
  path: string | null;
  data: Buffer | null;
  size: number;
  meta: string | null;
}

export interface RetroVariable {
  key: string;
  value: string;
}

export interface RetroInputDescriptor {
  port: number;
  device: number;
  index: number;
  id: number;
  description: string;
}

export interface RetroLogCallback {
  log: (level: number, fmt: string, ...args: unknown[]) => void;
}

/**
 * Basic message structure (SET_MESSAGE)
 */
export interface RetroMessage {
  msg: string;
  frames: number;  // Duration in frames (60fps assumed)
}

/**
 * Extended message structure (SET_MESSAGE_EXT)
 */
export interface RetroMessageExt {
  msg: string;
  duration: number;   // Duration in milliseconds
  priority: number;   // Higher = more important
  level: number;      // RETRO_LOG level
  target: number;     // RETRO_MESSAGE_TARGET
  type: number;       // RETRO_MESSAGE_TYPE
  progress: number;   // -1 = indeterminate, 0-100 = progress percentage
}

/** Libretro core error codes */
export type LibretroErrorCode =
  | 'ROM_READ_FAILED'
  | 'ROM_REJECTED'
  | 'NO_GAME_LOADED'
  | 'STATE_LOAD_FAILED';

const { TypedError: LibretroErrorClass, isTypedError: isLibretroErrorGuard } = createTypedError<LibretroErrorCode>('LibretroError');
export const LibretroError = LibretroErrorClass;
export type LibretroError = InstanceType<typeof LibretroErrorClass>;
export const isLibretroError = isLibretroErrorGuard;

// Type guards
export type RetroMemoryType =
  (typeof RETRO_MEMORY)[keyof typeof RETRO_MEMORY];
export type RetroDeviceType = (typeof RETRO_DEVICE)[keyof typeof RETRO_DEVICE];
export type RetroJoypadButton =
  (typeof RETRO_DEVICE_ID_JOYPAD)[keyof typeof RETRO_DEVICE_ID_JOYPAD];
export type RetroAnalogIndex =
  (typeof RETRO_DEVICE_INDEX_ANALOG)[keyof typeof RETRO_DEVICE_INDEX_ANALOG];
export type RetroAnalogAxis =
  (typeof RETRO_DEVICE_ID_ANALOG)[keyof typeof RETRO_DEVICE_ID_ANALOG];
export type RetroPixelFormat =
  (typeof RETRO_PIXEL_FORMAT)[keyof typeof RETRO_PIXEL_FORMAT];
export type RetroEnvironmentCmd =
  (typeof RETRO_ENVIRONMENT)[keyof typeof RETRO_ENVIRONMENT];
