/**
 * Libretro API FFI bindings using koffi
 */

import koffi from "koffi";
import type { RetroSystemInfo, RetroSystemAVInfo } from "..";
import {
  isPartialRetroSystemInfo,
  isPartialRetroSystemAVInfo,
} from "./types";

export * from './types';

// Define koffi struct types for libretro API
// These are used by koffi internally when binding functions
koffi.struct("retro_game_geometry", {
  base_width: "unsigned int",
  base_height: "unsigned int",
  max_width: "unsigned int",
  max_height: "unsigned int",
  aspect_ratio: "float",
});

koffi.struct("retro_system_timing", {
  fps: "double",
  sample_rate: "double",
});

koffi.struct("retro_system_av_info", {
  geometry: "retro_game_geometry",
  timing: "retro_system_timing",
});

koffi.struct("retro_system_info", {
  library_name: "const char*",
  library_version: "const char*",
  valid_extensions: "const char*",
  need_fullpath: "bool",
  block_extract: "bool",
});

koffi.struct("retro_game_info", {
  path: "const char*",
  data: "const void*",
  size: "size_t",
  meta: "const char*",
});

export const retro_variable = koffi.struct("retro_variable", {
  key: "const char*",
  value: "const char*",
});

// Callback type definitions
export const retro_environment_t = koffi.proto(
  "bool retro_environment_t(unsigned int cmd, void* data)"
);
// Use const uint8_t* for the framebuffer pointer so koffi can properly decode it
export const retro_video_refresh_t = koffi.proto(
  "void retro_video_refresh_t(const uint8_t* data, unsigned int width, unsigned int height, size_t pitch)"
);
export const retro_audio_sample_t = koffi.proto(
  "void retro_audio_sample_t(int16_t left, int16_t right)"
);
export const retro_audio_sample_batch_t = koffi.proto(
  "size_t retro_audio_sample_batch_t(_Inout_ int16_t* data, size_t frames)"
);
export const retro_input_poll_t = koffi.proto("void retro_input_poll_t()");
export const retro_input_state_t = koffi.proto(
  "int16_t retro_input_state_t(unsigned int port, unsigned int device, unsigned int index, unsigned int id)"
);
// Log callback - variadic args not supported in koffi callbacks, so we capture level + format string only.
// Extra printf args passed by C are ignored (cdecl convention handles stack cleanup on caller side).
export const retro_log_printf_t = koffi.proto(
  "void retro_log_printf_t(int level, const char* fmt)"
);

// Type for koffi registered callback
export type KoffiCallback = ReturnType<typeof koffi.register>;

 
type AnyFunction = (...args: any[]) => any;

/**
 * LibretroAPI class wraps the native libretro core functions via FFI
 */
export class LibretroAPI {
  private lib: koffi.IKoffiLib;

  // Core lifecycle functions
  retro_init!: () => void;
  retro_deinit!: () => void;
  retro_api_version!: () => number;
  retro_get_system_info!: AnyFunction;
  retro_get_system_av_info!: AnyFunction;
  retro_set_controller_port_device!: (port: number, device: number) => void;
  retro_reset!: () => void;
  retro_run!: () => void;
  retro_load_game!: AnyFunction;
  retro_unload_game!: () => void;
  retro_get_region!: () => number;

  // Serialization functions
  retro_serialize_size!: () => number;
  retro_serialize!: (data: Buffer, size: number) => boolean;
  retro_unserialize!: (data: Buffer, size: number) => boolean;

  // Memory access functions
  retro_get_memory_data!: (id: number) => Buffer | null;
  retro_get_memory_size!: (id: number) => number;

  // Callback setters
  retro_set_environment!: (cb: KoffiCallback) => void;
  retro_set_video_refresh!: (cb: KoffiCallback) => void;
  retro_set_audio_sample!: (cb: KoffiCallback) => void;
  retro_set_audio_sample_batch!: (cb: KoffiCallback) => void;
  retro_set_input_poll!: (cb: KoffiCallback) => void;
  retro_set_input_state!: (cb: KoffiCallback) => void;

  constructor(corePath: string) {
    this.lib = koffi.load(corePath);
    this.bindFunctions();
  }

  private bindFunctions(): void {
    // Core lifecycle
    this.retro_init = this.lib.func("void retro_init()");
    this.retro_deinit = this.lib.func("void retro_deinit()");
    this.retro_api_version = this.lib.func("unsigned int retro_api_version()");
    this.retro_get_system_info = this.lib.func(
      "void retro_get_system_info(retro_system_info* info)"
    );
    this.retro_get_system_av_info = this.lib.func(
      "void retro_get_system_av_info(retro_system_av_info* info)"
    );
    this.retro_set_controller_port_device = this.lib.func(
      "void retro_set_controller_port_device(unsigned int port, unsigned int device)"
    );
    this.retro_reset = this.lib.func("void retro_reset()");
    this.retro_run = this.lib.func("void retro_run()");
    this.retro_load_game = this.lib.func(
      "bool retro_load_game(const retro_game_info* game)"
    );
    this.retro_unload_game = this.lib.func("void retro_unload_game()");
    this.retro_get_region = this.lib.func("unsigned int retro_get_region()");

    // Serialization
    this.retro_serialize_size = this.lib.func("size_t retro_serialize_size()");
    this.retro_serialize = this.lib.func(
      "bool retro_serialize(void* data, size_t size)"
    );
    this.retro_unserialize = this.lib.func(
      "bool retro_unserialize(const void* data, size_t size)"
    );

    // Memory access
    this.retro_get_memory_data = this.lib.func(
      "void* retro_get_memory_data(unsigned int id)"
    );
    this.retro_get_memory_size = this.lib.func(
      "size_t retro_get_memory_size(unsigned int id)"
    );

    // Callback setters - use koffi pointer() to create proper callback pointer types
    this.retro_set_environment = this.lib.func(
      "retro_set_environment",
      "void",
      [koffi.pointer(retro_environment_t)]
    );
    this.retro_set_video_refresh = this.lib.func(
      "retro_set_video_refresh",
      "void",
      [koffi.pointer(retro_video_refresh_t)]
    );
    this.retro_set_audio_sample = this.lib.func(
      "retro_set_audio_sample",
      "void",
      [koffi.pointer(retro_audio_sample_t)]
    );
    this.retro_set_audio_sample_batch = this.lib.func(
      "retro_set_audio_sample_batch",
      "void",
      [koffi.pointer(retro_audio_sample_batch_t)]
    );
    this.retro_set_input_poll = this.lib.func(
      "retro_set_input_poll",
      "void",
      [koffi.pointer(retro_input_poll_t)]
    );
    this.retro_set_input_state = this.lib.func(
      "retro_set_input_state",
      "void",
      [koffi.pointer(retro_input_state_t)]
    );
  }

  /**
   * Get system info from the loaded core
   */
  getSystemInfo(): RetroSystemInfo {
    // Allocate a buffer for the struct
    const infoType = koffi.resolve("retro_system_info");
    const infoBuf = Buffer.alloc(koffi.sizeof(infoType));

    // Call the function with the buffer as output
    this.retro_get_system_info(infoBuf);

    // Decode the result and validate with type guard
    const decoded: unknown = koffi.decode(infoBuf, infoType);
    if (!isPartialRetroSystemInfo(decoded)) {
      return {
        library_name: "",
        library_version: "",
        valid_extensions: "",
        need_fullpath: false,
        block_extract: false,
      };
    }

    return {
      library_name: decoded.library_name ?? "",
      library_version: decoded.library_version ?? "",
      valid_extensions: decoded.valid_extensions ?? "",
      need_fullpath: decoded.need_fullpath ?? false,
      block_extract: decoded.block_extract ?? false,
    };
  }

  /**
   * Get audio/video info from the loaded core (call after loading a game)
   */
  getSystemAVInfo(): RetroSystemAVInfo {
    // Allocate a buffer for the struct
    const infoType = koffi.resolve("retro_system_av_info");
    const infoBuf = Buffer.alloc(koffi.sizeof(infoType));

    // Call the function with the buffer as output
    this.retro_get_system_av_info(infoBuf);

    // Decode the result and validate with type guard
    const decoded: unknown = koffi.decode(infoBuf, infoType);
    const defaultResult: RetroSystemAVInfo = {
      geometry: { base_width: 0, base_height: 0, max_width: 0, max_height: 0, aspect_ratio: 0 },
      timing: { fps: 0, sample_rate: 0 },
    };

    if (!isPartialRetroSystemAVInfo(decoded)) {
      return defaultResult;
    }

    const { geometry, timing } = decoded;

    return {
      geometry: {
        base_width: geometry?.base_width ?? 0,
        base_height: geometry?.base_height ?? 0,
        max_width: geometry?.max_width ?? 0,
        max_height: geometry?.max_height ?? 0,
        aspect_ratio: geometry?.aspect_ratio ?? 0,
      },
      timing: {
        fps: timing?.fps ?? 0,
        sample_rate: timing?.sample_rate ?? 0,
      },
    };
  }

  /**
   * Load a game into the core
   */
  loadGame(
    path: string | null,
    data: Buffer | null,
    meta: string | null = null
  ): boolean {
    const gameInfo = {
      path: path,
      data: data,
      size: data ? data.length : 0,
      meta: meta,
    };
    return this.retro_load_game(gameInfo) as boolean;
  }

  /**
   * Read data from a memory region by ID
   * Uses koffi.view to get a direct ArrayBuffer view of native memory
   */
  getMemoryData(id: number): Uint8Array | null {
    const size = this.retro_get_memory_size(id);
    if (size === 0) {return null;}

    const ptr = this.retro_get_memory_data(id);
    if (!ptr) {return null;}

    // Use koffi.view to get an ArrayBuffer view of native memory
    const arrayBuffer = koffi.view(ptr, size) as ArrayBuffer;
    const view = new Uint8Array(arrayBuffer);

    // Copy to a new buffer (don't return the direct view to native memory)
    const result = new Uint8Array(size);
    result.set(view);
    return result;
  }

  /**
   * Write data to a memory region by ID
   * Uses koffi.view to get a writable ArrayBuffer view of native memory
   */
  setMemoryData(id: number, data: Uint8Array): void {
    const size = this.retro_get_memory_size(id);
    if (size === 0) {return;}

    const ptr = this.retro_get_memory_data(id);
    if (!ptr) {return;}

    const copySize = Math.min(data.length, size);

    // Use koffi.view to get a writable ArrayBuffer view of native memory
    const arrayBuffer = koffi.view(ptr, copySize) as ArrayBuffer;
    const target = new Uint8Array(arrayBuffer);

    // Copy data to the memory region
    target.set(data.subarray(0, copySize));
  }

  /**
   * Unload the library
   */
  destroy(): void {
    // Note: koffi doesn't have a direct unload method for modern versions
    // The library will be garbage collected when all references are released
  }
}
