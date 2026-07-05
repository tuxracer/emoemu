/**
 * Environment callback handler for libretro cores
 * Handles environment commands that cores use to query frontend capabilities
 */

import koffi from "koffi";
import {
  RETRO_ENVIRONMENT,
  RETRO_PIXEL_FORMAT,
  RETRO_LANGUAGE,
  RETRO_MEMDESC,
  RETRO_MESSAGE_TARGET,
  RETRO_LOG,
  type RetroMessageExt,
  HEX_RADIX,
} from "..";
import { retro_log_printf_t, type KoffiCallback } from "../api";
import { logger } from "@/utils/logger";

// Environment-specific constants
import {
  MAX_INPUT_USERS,
  CORE_OPTIONS_VERSION,
  MESSAGE_INTERFACE_VERSION,
  AUDIO_ENABLE_BIT,
  VIDEO_ENABLE_BIT,
  MEMORY_MAP_HEADER_SIZE,
  MEMORY_MAP_NUM_DESC_OFFSET,
  MEMORY_DESCRIPTOR_SIZE,
  MEMORY_DESC_LEN_OFFSET,
  MEMORY_DESC_LEN_HIGH_OFFSET,
  MEMORY_DESC_PTR_OFFSET,
  UINT32_MULTIPLIER,
  MAX_DESCRIPTORS_TO_SCAN,
  POINTER_SIZE_64BIT,
  MESSAGE_STRUCT_SIZE,
  MESSAGE_FRAMES_OFFSET,
  MESSAGE_EXT_STRUCT_SIZE,
  MESSAGE_EXT_DURATION_OFFSET,
  MESSAGE_EXT_PRIORITY_OFFSET,
  MESSAGE_EXT_LEVEL_OFFSET,
  MESSAGE_EXT_TARGET_OFFSET,
  MESSAGE_EXT_TYPE_OFFSET,
  MESSAGE_EXT_PROGRESS_OFFSET,
  UINT32_SIZE,
  GEOMETRY_UINT_COUNT,
  STRUCT_PADDING_4,
  MAX_CONTROLLER_TYPES,
  ASPECT_RATIO_DECIMALS,
} from "./consts";

export * from './consts';

// Debug logging toggle
const DEBUG_ENV: boolean = false;

// Type alias for data pointers from koffi callbacks

type DataPointer = any;

/**
 * Read a uint32 from a koffi data pointer
 */
const readUInt32 = (ptr: DataPointer): number => koffi.decode(ptr, "unsigned int") as number;

/**
 * Read a uint8 from a koffi data pointer
 */
const readUInt8 = (ptr: DataPointer): number => koffi.decode(ptr, "uint8_t") as number;

/**
 * Write a uint32 to a koffi data pointer (little-endian)
 */
const writeUInt32LE = (ptr: DataPointer, value: number): void => {
  koffi.encode(ptr, "uint32_t", value);
};

/**
 * Write a uint8 to a koffi data pointer
 */
const writeUInt8 = (ptr: DataPointer, value: number): void => {
  koffi.encode(ptr, "uint8_t", value);
};

/**
 * EnvironmentHandler processes environment callbacks from libretro cores
 */
// Memory map SRAM region info
interface MemoryMapSram {
  ptr: unknown;  // External pointer from koffi
  size: number;
}

// Core option definition (from SET_VARIABLES or SET_CORE_OPTIONS)
interface CoreOptionDef {
  key: string;
  description: string;
  values: string[];
  defaultValue: string;
}

// Message callback type
export type MessageCallback = (message: RetroMessageExt) => void;

export class EnvironmentHandler {
  private pixelFormat: number = RETRO_PIXEL_FORMAT.XRGB1555;
  private systemDirectory = "./system";
  private saveDirectory = "./saves";
  private supportsNoGame = false;

  // Audio/video enable flags (both enabled by default)
  private audioEnabled = true;
  private videoEnabled = true;

  // Message callback for core notifications
  private messageCallback: MessageCallback | null = null;

  // Memory map SRAM (for cores that use SET_MEMORY_MAPS instead of retro_get_memory_data)
  private memoryMapSram: MemoryMapSram | null = null;

  // Debug info for memory maps
  public memoryMapDebug: string = '';

  // Track unhandled commands for debugging
  public unhandledCommands: number[] = [];

  // Geometry from SET_GEOMETRY (actual content dimensions)
  private geometry: {
    baseWidth: number;
    baseHeight: number;
    aspectRatio: number;
  } | null = null;

  // Keep references to allocated string buffers to prevent garbage collection.
  // The native code holds pointers to these buffers, so they must stay alive.
  private allocatedStrings: Buffer[] = [];

  // Log callback - must keep reference to prevent GC
  private logCallback: KoffiCallback | null = null;

  // Recent log messages from core (circular buffer for diagnostics)
  private recentLogs: Array<{ level: number; message: string }> = [];
  private static readonly MAX_LOG_ENTRIES = 50;

  // Core options: user-configured values (key -> value)
  private coreOptions: Map<string, string> = new Map();

  // Core option definitions: available options reported by the core
  private coreOptionDefs: Map<string, CoreOptionDef> = new Map();

  // Track if variables have been updated since last check
  private variablesUpdated = false;

  // Controller info per port: array of { desc, id } for each supported controller type
  private controllerInfo: Array<Array<{ desc: string; id: number }>> = [];

  /**
   * Handle an environment callback from the core
   * @param cmd The environment command
   * @param data Pointer to command-specific data (may be null)
   * @returns true if the command was handled, false otherwise
   */
  handle(cmd: number, data: DataPointer | null): boolean {
    // Strip experimental flag if present
    const actualCmd = cmd & ~RETRO_ENVIRONMENT.EXPERIMENTAL;

    if (DEBUG_ENV) {
      console.log(`[ENV] Command: ${actualCmd} (0x${actualCmd.toString(HEX_RADIX)})`);
    }

    switch (actualCmd) {
      case RETRO_ENVIRONMENT.SET_PIXEL_FORMAT:
        return this.handleSetPixelFormat(data);

      case RETRO_ENVIRONMENT.GET_SYSTEM_DIRECTORY:
        return this.handleGetDirectory(data, this.systemDirectory);

      case RETRO_ENVIRONMENT.GET_SAVE_DIRECTORY:
        return this.handleGetDirectory(data, this.saveDirectory);

      case RETRO_ENVIRONMENT.GET_CORE_ASSETS_DIRECTORY:
        return this.handleGetDirectory(data, this.systemDirectory);

      case RETRO_ENVIRONMENT.GET_VARIABLE:
        return this.handleGetVariable(data);

      case RETRO_ENVIRONMENT.SET_VARIABLES:
        return this.handleSetVariables(data);

      case RETRO_ENVIRONMENT.GET_VARIABLE_UPDATE:
        // Report if variables have been updated since last check
        if (data) {
          writeUInt8(data, this.variablesUpdated ? 1 : 0);
          this.variablesUpdated = false;
        }
        return true;

      case RETRO_ENVIRONMENT.SET_SUPPORT_NO_GAME:
        if (data) {
          this.supportsNoGame = readUInt8(data) !== 0;
        }
        return true;

      case RETRO_ENVIRONMENT.GET_LOG_INTERFACE:
        return this.handleGetLogInterface(data);

      case RETRO_ENVIRONMENT.SET_INPUT_DESCRIPTORS:
        // Accept input descriptors but we use our own mapping
        return true;

      case RETRO_ENVIRONMENT.GET_INPUT_BITMASKS:
        // We support input bitmasks
        if (data) {
          writeUInt8(data, 1);
        }
        return true;

      case RETRO_ENVIRONMENT.GET_CAN_DUPE:
        // We can handle duplicate frames (null data in video callback)
        if (data) {
          writeUInt8(data, 1);
        }
        return true;

      case RETRO_ENVIRONMENT.GET_LANGUAGE:
        if (data) {
          writeUInt32LE(data, RETRO_LANGUAGE.ENGLISH);
        }
        return true;

      case RETRO_ENVIRONMENT.GET_CORE_OPTIONS_VERSION:
        if (data) {
          // Support up to v2 options API
          writeUInt32LE(data, CORE_OPTIONS_VERSION);
        }
        return true;

      case RETRO_ENVIRONMENT.SET_CORE_OPTIONS:
      case RETRO_ENVIRONMENT.SET_CORE_OPTIONS_INTL:
      case RETRO_ENVIRONMENT.SET_CORE_OPTIONS_V2:
      case RETRO_ENVIRONMENT.SET_CORE_OPTIONS_V2_INTL:
        // Accept core options but use defaults
        return true;

      case RETRO_ENVIRONMENT.SET_CORE_OPTIONS_DISPLAY:
        // Accept display hints
        return true;

      case RETRO_ENVIRONMENT.SET_CORE_OPTIONS_UPDATE_DISPLAY_CALLBACK:
        // Accept but don't use update callback
        return true;

      case RETRO_ENVIRONMENT.SET_GEOMETRY:
        return this.handleSetGeometry(data);

      case RETRO_ENVIRONMENT.SET_SYSTEM_AV_INFO:
        // Accept AV info changes
        return true;

      case RETRO_ENVIRONMENT.GET_INPUT_MAX_USERS:
        if (data) {
          writeUInt32LE(data, MAX_INPUT_USERS);
        }
        return true;

      case RETRO_ENVIRONMENT.SET_CONTROLLER_INFO:
        return this.handleSetControllerInfo(data);

      case RETRO_ENVIRONMENT.SET_MEMORY_MAPS:
        return this.handleSetMemoryMaps(data);

      case RETRO_ENVIRONMENT.SET_SUBSYSTEM_INFO:
        // Accept subsystem info
        return true;

      case RETRO_ENVIRONMENT.GET_RUMBLE_INTERFACE:
        // We don't support rumble
        return false;

      case RETRO_ENVIRONMENT.SET_HW_RENDER:
      case RETRO_ENVIRONMENT.GET_HW_RENDER_INTERFACE:
      case RETRO_ENVIRONMENT.SET_HW_RENDER_CONTEXT_NEGOTIATION_INTERFACE:
      case RETRO_ENVIRONMENT.SET_HW_SHARED_CONTEXT:
      case RETRO_ENVIRONMENT.GET_PREFERRED_HW_RENDER:
        // We don't support hardware rendering (OpenGL/Vulkan)
        return false;

      case RETRO_ENVIRONMENT.GET_VFS_INTERFACE:
        // We don't provide VFS interface
        return false;

      case RETRO_ENVIRONMENT.GET_LED_INTERFACE:
        // No LED support
        return false;

      case RETRO_ENVIRONMENT.GET_AUDIO_VIDEO_ENABLE:
        if (data) {
          // Bit 0: enable video, Bit 1: enable audio
          const mask = (this.videoEnabled ? VIDEO_ENABLE_BIT : 0) |
                       (this.audioEnabled ? AUDIO_ENABLE_BIT : 0);
          writeUInt32LE(data, mask);
        }
        return true;

      case RETRO_ENVIRONMENT.SET_AUDIO_BUFFER_STATUS_CALLBACK:
        // Accept but don't use audio buffer status callback
        return true;

      case RETRO_ENVIRONMENT.SET_MINIMUM_AUDIO_LATENCY:
        // Accept minimum audio latency setting
        return true;

      case RETRO_ENVIRONMENT.SET_MESSAGE:
        return this.handleSetMessage(data);

      case RETRO_ENVIRONMENT.SET_MESSAGE_EXT:
        return this.handleSetMessageExt(data);

      case RETRO_ENVIRONMENT.GET_MESSAGE_INTERFACE_VERSION:
        if (data) {
          writeUInt32LE(data, MESSAGE_INTERFACE_VERSION);
        }
        return true;

      case RETRO_ENVIRONMENT.SET_PERFORMANCE_LEVEL:
        // Accept performance level hints
        return true;

      case RETRO_ENVIRONMENT.SET_SUPPORT_ACHIEVEMENTS:
        // We don't support achievements
        return false;

      case RETRO_ENVIRONMENT.SET_SERIALIZATION_QUIRKS:
        // Accept serialization quirks info
        return true;

      case RETRO_ENVIRONMENT.GET_FASTFORWARDING:
        if (data) {
          writeUInt8(data, 0); // Not fast-forwarding
        }
        return true;

      case RETRO_ENVIRONMENT.SET_FASTFORWARDING_OVERRIDE:
        // Accept but ignore
        return true;

      case RETRO_ENVIRONMENT.GET_THROTTLE_STATE:
        // We don't provide throttle state
        return false;

      case RETRO_ENVIRONMENT.GET_SAVESTATE_CONTEXT:
        // We don't provide savestate context
        return false;

      default:
        // Track unhandled commands for debugging
        if (!this.unhandledCommands.includes(actualCmd)) {
          this.unhandledCommands.push(actualCmd);
        }
        if (DEBUG_ENV) {
          console.log(`[ENV] Unhandled command: ${actualCmd}`);
        }
        return false;
    }
  }

  /**
   * Handle SET_PIXEL_FORMAT command
   */
  private handleSetPixelFormat(data: DataPointer | null): boolean {
    if (!data) {return false;}

    const format = readUInt32(data);
    if (
      format === RETRO_PIXEL_FORMAT.XRGB1555 ||
      format === RETRO_PIXEL_FORMAT.RGB565 ||
      format === RETRO_PIXEL_FORMAT.XRGB8888
    ) {
      this.pixelFormat = format;
      // Log pixel format (RetroArch-style)
      const formatNames = ["XRGB1555", "XRGB8888", "RGB565"];
      logger.info(`SET_PIXEL_FORMAT: ${formatNames[format]}`, 'Environ');
      if (DEBUG_ENV) {
        console.log(`[ENV] Pixel format set to: ${formatNames[format]}`);
      }
      return true;
    }
    return false;
  }

  /**
   * Handle SET_GEOMETRY command - core is reporting actual content dimensions
   */
  private handleSetGeometry(data: DataPointer | null): boolean {
    if (!data) {return false;}

    // Read retro_game_geometry struct:
    // base_width (uint), base_height (uint), max_width (uint), max_height (uint), aspect_ratio (float)
    const FLOAT_SIZE = UINT32_SIZE;
    const view = koffi.view(data, UINT32_SIZE * GEOMETRY_UINT_COUNT + FLOAT_SIZE);
    const dataView = new DataView(view);

    const baseWidth = dataView.getUint32(0, true);
    const baseHeight = dataView.getUint32(UINT32_SIZE, true);
    const aspectRatio = dataView.getFloat32(UINT32_SIZE * GEOMETRY_UINT_COUNT, true);

    // Store geometry if valid (aspect_ratio of 0 means use base dimensions)
    if (baseWidth > 0 && baseHeight > 0) {
      const effectiveAspect = aspectRatio > 0 ? aspectRatio : baseWidth / baseHeight;
      this.geometry = {
        baseWidth,
        baseHeight,
        aspectRatio: effectiveAspect,
      };
      logger.info(
        `SET_GEOMETRY: ${baseWidth}x${baseHeight}, aspect: ${effectiveAspect.toFixed(ASPECT_RATIO_DECIMALS)}`,
        'Environ'
      );
    }

    return true;
  }

  /**
   * Handle SET_CONTROLLER_INFO command
   * Reports available controller types for each port
   * struct retro_controller_info { const retro_controller_description *types; unsigned num_types; }
   * struct retro_controller_description { const char *desc; unsigned id; }
   */
  private handleSetControllerInfo(data: DataPointer | null): boolean {
    if (!data) {return true;}

    try {
      const POINTER_SIZE = POINTER_SIZE_64BIT;
      const PORT_STRUCT_SIZE = POINTER_SIZE + UINT32_SIZE + STRUCT_PADDING_4; // pointer + uint + padding = 16 bytes
      const DESC_STRUCT_SIZE = POINTER_SIZE + UINT32_SIZE + STRUCT_PADDING_4; // pointer + uint + padding = 16 bytes
      const MAX_PORTS = 8; // Safety limit

      this.controllerInfo = [];

      // Read array of retro_controller_info until we hit one with 0 types
      for (let port = 0; port < MAX_PORTS; port++) {
        const portOffset = port * PORT_STRUCT_SIZE;
        const portView = koffi.view(data, portOffset + PORT_STRUCT_SIZE) as ArrayBuffer;
        const portData = new DataView(portView, portOffset, PORT_STRUCT_SIZE);

        // Read num_types (at offset POINTER_SIZE)
        const numTypes = portData.getUint32(POINTER_SIZE, true);

        // 0 types means end of array
        if (numTypes === 0) {break;}

        // Read types pointer
        const portBuf = Buffer.from(new Uint8Array(portView, portOffset, POINTER_SIZE));
        const typesPtr = koffi.decode(portBuf, 'void*') as unknown;
        if (!typesPtr) {break;}

        const portTypes: Array<{ desc: string; id: number }> = [];

        // Read each controller description
        for (let t = 0; t < numTypes && t < MAX_CONTROLLER_TYPES; t++) {
          const typeOffset = t * DESC_STRUCT_SIZE;
          const typeView = koffi.view(typesPtr, typeOffset + DESC_STRUCT_SIZE) as ArrayBuffer;
          const typeData = new DataView(typeView, typeOffset, DESC_STRUCT_SIZE);

          // Read desc pointer and decode string
          const descBuf = Buffer.from(new Uint8Array(typeView, typeOffset, POINTER_SIZE));
          const descPtr = koffi.decode(descBuf, 'const char*') as string | null;

          // Read id (at offset POINTER_SIZE)
          const id = typeData.getUint32(POINTER_SIZE, true);

          if (descPtr) {
            portTypes.push({ desc: descPtr, id });
          }
        }

        this.controllerInfo.push(portTypes);

        // Log available controller types for this port
        if (portTypes.length > 0) {
          const typeStrs = portTypes.map(t => `${t.desc}(${t.id})`).join(', ');
          logger.info(`Port ${port} controllers: ${typeStrs}`, 'Environ');
        }
      }
    } catch (err) {
      logger.debug(`SET_CONTROLLER_INFO error: ${err}`, 'Environ');
    }

    return true;
  }

  /**
   * Get available controller types for a port
   */
  getControllerTypes(port: number): Array<{ desc: string; id: number }> {
    return this.controllerInfo[port] ?? [];
  }

  /**
   * Handle GET_*_DIRECTORY commands.
   */
  private handleGetDirectory(data: DataPointer | null, dir: string): boolean {
    if (!data) {return false;}

    // Allocate a null-terminated string buffer and keep reference to prevent GC
    const strBuf = Buffer.from(dir + "\0", "utf8");
    this.allocatedStrings.push(strBuf);

    // Write the pointer to the string into data using koffi.encode
    koffi.encode(data, "const char**", koffi.as(strBuf, "const char*"));

    return true;
  }

  /**
   * Handle GET_VARIABLE command
   * struct retro_variable { const char *key; const char *value; }
   * Core passes key, we fill in value pointer
   */
  private handleGetVariable(data: DataPointer | null): boolean {
    if (!data) {return false;}

    try {
      // Read the key pointer (first field of retro_variable struct)
      const key = koffi.decode(data, 'const char*') as string | null;
      if (!key) {return false;}

      // Look up the value: first check user-configured options, then defaults
      let value = this.coreOptions.get(key);
      if (value === undefined) {
        // Fall back to default value from option definitions
        const def = this.coreOptionDefs.get(key);
        if (def) {
          value = def.defaultValue;
        }
      }

      if (value === undefined) {
        // Unknown option, let core use its internal default
        return false;
      }

      // Allocate a null-terminated string buffer for the value
      const valueBuf = Buffer.from(value + "\0", "utf8");
      this.allocatedStrings.push(valueBuf);

      // Convert buffer to a koffi pointer type
      const valuePtr = koffi.as(valueBuf, 'const char*');

      // We need to write ONLY the value field without touching the key
      // The struct layout is: { key: 'const char*' (8 bytes), value: 'const char*' (8 bytes) }
      // So we read the original key pointer and write it back along with the new value
      const POINTER_SIZE = 8; // 64-bit pointer
      const structView = koffi.view(data, POINTER_SIZE * 2) as ArrayBuffer;

      // Read the original key pointer (first 8 bytes)
      const keyPtrBytes = new BigUint64Array(structView, 0, 1);
      const originalKeyPtr = keyPtrBytes[0];

      // Write both the key (unchanged) and value pointers back
      // Use BigUint64Array to write both pointers
      const fullView = new BigUint64Array(structView);

      // Keep the original key pointer at offset 0
      fullView[0] = originalKeyPtr;

      // Write the value pointer at offset 1 (which is byte offset 8)
      // Get the numeric address by encoding to native memory and reading back
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- koffi.alloc returns untyped native memory
      const tempMem = koffi.alloc('const char*', 1);
      koffi.encode(tempMem, 'const char*', valuePtr);
      const tempView = koffi.view(tempMem, POINTER_SIZE);
      const valuePtrValue = new BigUint64Array(tempView as ArrayBuffer)[0];
      fullView[1] = valuePtrValue;
      koffi.free(tempMem);

      logger.debug(`GET_VARIABLE: ${key} = ${value}`, 'Environ');
      return true;
    } catch (err) {
      logger.debug(`GET_VARIABLE error: ${err}`, 'Environ');
      return false;
    }
  }

  /**
   * Handle SET_VARIABLES command (legacy v0 options API)
   * Array of retro_variable { const char *key; const char *value; } terminated by NULL key
   * value format: "Description; value1|value2|value3" where first value is default
   */
  private handleSetVariables(data: DataPointer | null): boolean {
    if (!data) {return false;}

    try {
      const POINTER_SIZE = 8; // 64-bit pointer
      const STRUCT_SIZE = POINTER_SIZE * 2; // Two pointers per struct
      const MAX_VARIABLES = 1000; // Safety limit
      let offset = 0;

      // Read variable array until we hit a NULL key
      for (let i = 0; i < MAX_VARIABLES; i++) {
        const structView = koffi.view(data, offset + STRUCT_SIZE) as ArrayBuffer;
        const structBuf = Buffer.from(structView).subarray(offset);

        // Read key pointer
        const keyPtr = koffi.decode(koffi.as(structBuf, 'char**'), 'const char*') as string | null;
        if (!keyPtr) {break;} // NULL key terminates the array

        // Read value pointer (description + values)
        const valueBuf = structBuf.subarray(POINTER_SIZE);
        const valuePtr = koffi.decode(koffi.as(valueBuf, 'char**'), 'const char*') as string | null;

        if (valuePtr) {
          this.parseAndStoreOptionDef(keyPtr, valuePtr);
        }

        offset += STRUCT_SIZE;
      }

      return true;
    } catch (err) {
      logger.debug(`SET_VARIABLES error: ${err}`, 'Environ');
      return true; // Accept even on parse error
    }
  }

  /**
   * Parse option definition string and store it
   * Format: "Description; value1|value2|value3"
   */
  private parseAndStoreOptionDef(key: string, valueStr: string): void {
    // Split on "; " to separate description from values
    const semicolonIndex = valueStr.indexOf('; ');
    if (semicolonIndex === -1) {
      // No values specified, just description
      return;
    }

    const description = valueStr.substring(0, semicolonIndex);
    const valuesStr = valueStr.substring(semicolonIndex + 2);
    const values = valuesStr.split('|').map(v => v.trim());

    if (values.length === 0) {return;}

    const def: CoreOptionDef = {
      key,
      description,
      values,
      defaultValue: values[0], // First value is default
    };

    this.coreOptionDefs.set(key, def);
    logger.debug(`Option defined: ${key} = [${values.join(', ')}] (default: ${def.defaultValue})`, 'Environ');
  }

  /**
   * Handle GET_LOG_INTERFACE command
   * struct retro_log_callback { retro_log_printf_t log; }
   */
  private handleGetLogInterface(data: DataPointer | null): boolean {
    if (!data) {return false;}

    try {
      // Register the log callback if not already done
      if (!this.logCallback) {
        this.logCallback = koffi.register(
          (level: number, fmt: string | null): void => {
            this.handleLogMessage(level, fmt);
          },
          koffi.pointer(retro_log_printf_t)
        );
      }

      // Write the callback pointer to the struct (single pointer field)
      koffi.encode(data, koffi.pointer(retro_log_printf_t), this.logCallback);

      return true;
    } catch (err) {
      if (DEBUG_ENV) {
        console.error('[ENV] Failed to set up log interface:', err);
      }
      return false;
    }
  }

  /**
   * Handle a log message from the core
   * Note: variadic args not supported in koffi callbacks, so we only get level + format string.
   * The format string often contains the full message or enough context for debugging.
   */
  private handleLogMessage(level: number, fmt: string | null): void {
    if (!fmt) {return;}

    // Clean up the message (remove trailing newlines)
    const message = fmt.replace(/\n+$/, '');
    if (!message) {return;}

    // Store in circular buffer
    this.recentLogs.push({ level, message });
    if (this.recentLogs.length > EnvironmentHandler.MAX_LOG_ENTRIES) {
      this.recentLogs.shift();
    }

    // Also log to our logger based on level
    const levelName = this.getLogLevelName(level);
    const logMsg = `[Core] ${message}`;

    switch (level) {
      case RETRO_LOG.DEBUG:
        logger.debug(logMsg);
        break;
      case RETRO_LOG.WARN:
        logger.warn(logMsg);
        break;
      case RETRO_LOG.ERROR:
        logger.error(logMsg);
        break;
      default:
        logger.info(logMsg);
    }

    if (DEBUG_ENV) {
      console.log(`[Core ${levelName}] ${message}`);
    }
  }

  /**
   * Get human-readable log level name
   */
  private getLogLevelName(level: number): string {
    switch (level) {
      case RETRO_LOG.DEBUG: return 'DEBUG';
      case RETRO_LOG.INFO: return 'INFO';
      case RETRO_LOG.WARN: return 'WARN';
      case RETRO_LOG.ERROR: return 'ERROR';
      default: return `LEVEL${level}`;
    }
  }

  /**
   * Handle SET_MESSAGE command (basic message)
   * struct retro_message { const char *msg; unsigned frames; }
   */
  private handleSetMessage(data: DataPointer | null): boolean {
    if (!data || !this.messageCallback) {return true;}

    try {
      // Read the pointer to the message string (first field, 8 bytes on 64-bit)
      const msgPtr = koffi.decode(data, 'const char*') as string | null;
      if (!msgPtr) {return true;}

      // Read frames (unsigned int at MESSAGE_FRAMES_OFFSET)
      const structView = koffi.view(data, MESSAGE_STRUCT_SIZE) as ArrayBuffer;
      const structData = new DataView(structView);
      const frames = structData.getUint32(MESSAGE_FRAMES_OFFSET, true);

      // Convert frames to milliseconds (assume 60fps)
      const FPS = 60;
      const MS_PER_SECOND = 1000;
      const durationMs = Math.round((frames / FPS) * MS_PER_SECOND);

      // Create extended message format for unified handling
      const message: RetroMessageExt = {
        msg: msgPtr,
        duration: durationMs,
        priority: 0,
        level: RETRO_LOG.INFO,
        target: RETRO_MESSAGE_TARGET.ALL,
        type: 0, // NOTIFICATION
        progress: -1,
      };

      this.messageCallback(message);
    } catch (err) {
      if (DEBUG_ENV) {
        console.log(`[ENV] SET_MESSAGE parse error: ${err}`);
      }
    }

    return true;
  }

  /**
   * Handle SET_MESSAGE_EXT command (extended message)
   * struct retro_message_ext {
   *   const char *msg;      // offset 0, 8 bytes (pointer)
   *   unsigned duration;    // offset MESSAGE_EXT_DURATION_OFFSET, 4 bytes
   *   unsigned priority;    // offset MESSAGE_EXT_PRIORITY_OFFSET, 4 bytes
   *   enum level;           // offset MESSAGE_EXT_LEVEL_OFFSET, 4 bytes
   *   enum target;          // offset MESSAGE_EXT_TARGET_OFFSET, 4 bytes
   *   enum type;            // offset MESSAGE_EXT_TYPE_OFFSET, 4 bytes
   *   int8_t progress;      // offset MESSAGE_EXT_PROGRESS_OFFSET, 1 byte
   * }
   */
  private handleSetMessageExt(data: DataPointer | null): boolean {
    if (!data || !this.messageCallback) {return true;}

    try {
      // Read the pointer to the message string
      const msgPtr = koffi.decode(data, 'const char*') as string | null;
      if (!msgPtr) {return true;}

      // Read the rest of the struct
      const structView = koffi.view(data, MESSAGE_EXT_STRUCT_SIZE) as ArrayBuffer;
      const structData = new DataView(structView);

      const message: RetroMessageExt = {
        msg: msgPtr,
        duration: structData.getUint32(MESSAGE_EXT_DURATION_OFFSET, true),
        priority: structData.getUint32(MESSAGE_EXT_PRIORITY_OFFSET, true),
        level: structData.getUint32(MESSAGE_EXT_LEVEL_OFFSET, true),
        target: structData.getUint32(MESSAGE_EXT_TARGET_OFFSET, true),
        type: structData.getUint32(MESSAGE_EXT_TYPE_OFFSET, true),
        progress: structData.getInt8(MESSAGE_EXT_PROGRESS_OFFSET),
      };

      // Only dispatch if target includes OSD (not LOG-only)
      if (message.target !== RETRO_MESSAGE_TARGET.LOG) {
        this.messageCallback(message);
      }
    } catch (err) {
      if (DEBUG_ENV) {
        console.log(`[ENV] SET_MESSAGE_EXT parse error: ${err}`);
      }
    }

    return true;
  }

  /**
   * Handle SET_MEMORY_MAPS command
   * Parses memory descriptors to find SRAM regions
   */
  private handleSetMemoryMaps(data: DataPointer | null): boolean {
    if (!data) {return false;}

    try {
      // retro_memory_map struct: { descriptors: pointer, num_descriptors: uint32 }
      // On 64-bit systems: pointer is 8 bytes, then 4 bytes for num_descriptors
      const mapView = koffi.view(data, MEMORY_MAP_HEADER_SIZE) as ArrayBuffer;
      const mapData = new DataView(mapView);

      // Read pointer (64-bit) and num_descriptors (32-bit)
      // Note: We need to get the actual pointer value, not read it as a number
      const numDescriptors = mapData.getUint32(MEMORY_MAP_NUM_DESC_OFFSET, true); // little-endian

      this.memoryMapDebug = `${numDescriptors}desc `;

      if (numDescriptors === 0) {return true;}

      // Get the descriptors pointer from the struct
      const descriptorsPtr = koffi.decode(data, 'void*') as unknown;
      if (!descriptorsPtr) {return true;}

      // retro_memory_descriptor struct size (64-bit system):
      // uint64_t flags (8) + void* ptr (8) + size_t offset (8) + size_t start (8) +
      // size_t select (8) + size_t disconnect (8) + size_t len (8) + char* addrspace (8) = 64 bytes

      const debugParts: string[] = [];
      for (let i = 0; i < numDescriptors && i < MAX_DESCRIPTORS_TO_SCAN; i++) {
        // Read each descriptor
        const descView = koffi.view(descriptorsPtr, (i + 1) * MEMORY_DESCRIPTOR_SIZE) as ArrayBuffer;
        const descData = new DataView(descView, i * MEMORY_DESCRIPTOR_SIZE, MEMORY_DESCRIPTOR_SIZE);

        // Read flags (uint64_t at offset 0) - read as two 32-bit values
        const flagsLow = descData.getUint32(0, true);

        // Read len (size_t at offset MEMORY_DESC_LEN_OFFSET)
        const lenLow = descData.getUint32(MEMORY_DESC_LEN_OFFSET, true);
        const lenHigh = descData.getUint32(MEMORY_DESC_LEN_HIGH_OFFSET, true);
        const len = lenLow + lenHigh * UINT32_MULTIPLIER;

        debugParts.push(`${i}:f${flagsLow.toString(HEX_RADIX)}l${len}`);

        // Check if this is SRAM (flag bit 3)
        if ((flagsLow & RETRO_MEMDESC.SAVE_RAM) && len > 0) {
          // Get the ptr field (void* at offset MEMORY_DESC_PTR_OFFSET)
          // We need to read it as a pointer, not a number
          const ptrOffset = i * MEMORY_DESCRIPTOR_SIZE + MEMORY_DESC_PTR_OFFSET;
          const fullDescView = koffi.view(descriptorsPtr, (i + 1) * MEMORY_DESCRIPTOR_SIZE) as ArrayBuffer;
          const ptrBytes = new Uint8Array(fullDescView, ptrOffset, POINTER_SIZE_64BIT);

          // Create a buffer with the pointer bytes and decode it
          const ptrBuf = Buffer.from(ptrBytes);
          const sramPtr = koffi.decode(ptrBuf, 'void*') as unknown;

          if (sramPtr) {
            this.memoryMapSram = { ptr: sramPtr, size: len };
            this.memoryMapDebug += `SRAM@${i}=${len}B`;
          }
          break; // Found SRAM, stop searching
        }
      }

      if (!this.memoryMapSram) {
        this.memoryMapDebug = debugParts.join(',');
      }
    } catch (err) {
      this.memoryMapDebug = `ERR:${err}`;
    }

    return true;
  }

  /**
   * Get the current pixel format
   */
  getPixelFormat(): number {
    return this.pixelFormat;
  }

  /**
   * Get geometry reported by SET_GEOMETRY (actual content dimensions)
   * Returns null if core hasn't reported geometry changes
   */
  getGeometry(): { baseWidth: number; baseHeight: number; aspectRatio: number } | null {
    return this.geometry;
  }

  /**
   * Check if the core supports running without a game
   */
  getSupportsNoGame(): boolean {
    return this.supportsNoGame;
  }

  /**
   * Get the system directory path
   */
  getSystemDirectory(): string {
    return this.systemDirectory;
  }

  /**
   * Set the system directory path
   */
  setSystemDirectory(path: string): void {
    this.systemDirectory = path;
  }

  /**
   * Set the save directory path
   */
  setSaveDirectory(path: string): void {
    this.saveDirectory = path;
  }

  /**
   * Set audio/video enable flags
   * These are reported to the core via GET_AUDIO_VIDEO_ENABLE
   */
  setAudioVideoEnabled(audio: boolean, video: boolean): void {
    this.audioEnabled = audio;
    this.videoEnabled = video;
  }

  /**
   * Set audio enable flag
   */
  setAudioEnabled(enabled: boolean): void {
    this.audioEnabled = enabled;
  }

  /**
   * Set video enable flag
   */
  setVideoEnabled(enabled: boolean): void {
    this.videoEnabled = enabled;
  }

  /**
   * Set message callback for core notifications
   */
  setMessageCallback(callback: MessageCallback | null): void {
    this.messageCallback = callback;
  }

  /**
   * Get memory map SRAM info (for cores that use SET_MEMORY_MAPS)
   */
  getMemoryMapSram(): MemoryMapSram | null {
    return this.memoryMapSram;
  }

  /**
   * Get recent log messages from the core (for debugging ROM rejection, etc.)
   * Returns messages with level and text, most recent last.
   */
  getRecentLogs(): Array<{ level: number; message: string }> {
    return [...this.recentLogs];
  }

  /**
   * Get recent log messages formatted as strings (for error messages)
   * Filters to WARN and ERROR levels by default.
   * Format: [LEVEL] [Core] message
   */
  getRecentLogsFormatted(minLevel: number = RETRO_LOG.WARN): string[] {
    return this.recentLogs
      .filter(log => log.level >= minLevel)
      .map(log => `[${this.getLogLevelName(log.level)}] [Core] ${log.message}`);
  }

  /**
   * Clear recent logs (call before loading a ROM to get fresh messages)
   */
  clearRecentLogs(): void {
    this.recentLogs = [];
  }

  /**
   * Clear allocated buffers (call when done with the core)
   */
  cleanup(): void {
    this.allocatedStrings = [];
    this.memoryMapSram = null;
    this.logCallback = null;
    this.recentLogs = [];
    this.coreOptions.clear();
    this.coreOptionDefs.clear();
    this.controllerInfo = [];
  }

  //==========================================================================
  // Core Options API
  //==========================================================================

  /**
   * Set a core option value
   * Uses the same key format as RetroArch (e.g., "mupen64plus-rdp-plugin")
   */
  setCoreOption(key: string, value: string): void {
    this.coreOptions.set(key, value);
    this.variablesUpdated = true;
    logger.debug(`Core option set: ${key} = ${value}`, 'Environ');
  }

  /**
   * Set multiple core options at once
   * @param options Record of key-value pairs (RetroArch format)
   */
  setCoreOptions(options: Record<string, string>): void {
    for (const [key, value] of Object.entries(options)) {
      this.coreOptions.set(key, value);
    }
    if (Object.keys(options).length > 0) {
      this.variablesUpdated = true;
      logger.debug(`Core options set: ${Object.keys(options).length} options`, 'Environ');
    }
  }

  /**
   * Get the current value of a core option
   * Returns undefined if not set
   */
  getCoreOption(key: string): string | undefined {
    return this.coreOptions.get(key) ?? this.coreOptionDefs.get(key)?.defaultValue;
  }

  /**
   * Get all configured core options
   */
  getCoreOptions(): Map<string, string> {
    return new Map(this.coreOptions);
  }

  /**
   * Get all available core option definitions (reported by the core)
   */
  getCoreOptionDefs(): Map<string, CoreOptionDef> {
    return new Map(this.coreOptionDefs);
  }

  /**
   * Get a specific option definition
   */
  getCoreOptionDef(key: string): CoreOptionDef | undefined {
    return this.coreOptionDefs.get(key);
  }

  /**
   * Check if a core option exists (either configured or defined by core)
   */
  hasCoreOption(key: string): boolean {
    return this.coreOptions.has(key) || this.coreOptionDefs.has(key);
  }

  /**
   * Clear all user-configured core options (revert to defaults)
   */
  clearCoreOptions(): void {
    this.coreOptions.clear();
    this.variablesUpdated = true;
  }
}
