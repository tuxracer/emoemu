// =============================================================================
// Environment Handler Constants
// =============================================================================

/** Maximum number of input players supported */
export const MAX_INPUT_USERS = 2;

/** Core options API version supported */
export const CORE_OPTIONS_VERSION = 2;

/** Message interface version supported */
export const MESSAGE_INTERFACE_VERSION = 1;

/** Audio enable bit (bit 1) */
export const AUDIO_ENABLE_BIT = 0b10;

/** Video enable bit (bit 0) */
export const VIDEO_ENABLE_BIT = 0b01;

// =============================================================================
// Memory Map Constants (64-bit system layout)
// =============================================================================

/** Size of retro_memory_map struct header (pointer + uint32) on 64-bit */
export const MEMORY_MAP_HEADER_SIZE = 16;

/** Byte offset of num_descriptors in retro_memory_map struct */
export const MEMORY_MAP_NUM_DESC_OFFSET = 8;

/** Size of retro_memory_descriptor struct on 64-bit system */
export const MEMORY_DESCRIPTOR_SIZE = 64;

/** Byte offset of 'len' field (size_t) in memory descriptor struct */
export const MEMORY_DESC_LEN_OFFSET = 48;

/** High word offset for 64-bit len field */
export const MEMORY_DESC_LEN_HIGH_OFFSET = 52;

/** Byte offset of 'ptr' field (void*) in memory descriptor struct */
export const MEMORY_DESC_PTR_OFFSET = 8;

/** Multiplier for combining high 32-bit word in 64-bit value */
export const UINT32_MULTIPLIER = 0x100000000;

/** Maximum descriptors to scan when looking for SRAM */
export const MAX_DESCRIPTORS_TO_SCAN = 10;

/** Pointer size on 64-bit system */
export const POINTER_SIZE_64BIT = 8;

// =============================================================================
// Message Struct Constants (64-bit system layout)
// =============================================================================

/** Size of retro_message struct on 64-bit system (pointer + uint32 + padding) */
export const MESSAGE_STRUCT_SIZE = 16;

/** Byte offset of 'frames' field in retro_message struct */
export const MESSAGE_FRAMES_OFFSET = 8;

/** Size of retro_message_ext struct on 64-bit system */
export const MESSAGE_EXT_STRUCT_SIZE = 32;

/** Byte offset of 'duration' field in retro_message_ext struct */
export const MESSAGE_EXT_DURATION_OFFSET = 8;

/** Byte offset of 'priority' field in retro_message_ext struct */
export const MESSAGE_EXT_PRIORITY_OFFSET = 12;

/** Byte offset of 'level' field in retro_message_ext struct */
export const MESSAGE_EXT_LEVEL_OFFSET = 16;

/** Byte offset of 'target' field in retro_message_ext struct */
export const MESSAGE_EXT_TARGET_OFFSET = 20;

/** Byte offset of 'type' field in retro_message_ext struct */
export const MESSAGE_EXT_TYPE_OFFSET = 24;

/** Byte offset of 'progress' field in retro_message_ext struct */
export const MESSAGE_EXT_PROGRESS_OFFSET = 28;

// =============================================================================
// Memory Descriptor Flag Bit Positions
// =============================================================================

/** Bit position for RETRO_MEMDESC_SAVE_RAM flag */
export const MEMDESC_SAVE_RAM_BIT = 3;

/** Bit position for RETRO_MEMDESC_VIDEO_RAM flag */
export const MEMDESC_VIDEO_RAM_BIT = 4;

/** Bit position for alignment hints in memory descriptor flags */
export const MEMDESC_ALIGN_BIT = 16;

/** Bit position for minimum size hints in memory descriptor flags */
export const MEMDESC_MINSIZE_BIT = 24;

/** Alignment/size multiplier for 8-byte alignment */
export const MEMDESC_SIZE_8 = 3;

// =============================================================================
// Struct Size Constants
// =============================================================================

/** Size of a uint32 in bytes */
export const UINT32_SIZE = 4;

/** Number of uint32 fields before aspect_ratio in retro_game_geometry struct */
export const GEOMETRY_UINT_COUNT = 4;

/** Struct padding for alignment in retro_controller_info (4 bytes) */
export const STRUCT_PADDING_4 = 4;

/** Maximum controller types to read per port (safety limit) */
export const MAX_CONTROLLER_TYPES = 20;

/** Decimal places for aspect ratio formatting */
export const ASPECT_RATIO_DECIMALS = 3;
