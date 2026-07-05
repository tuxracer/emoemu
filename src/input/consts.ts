// =============================================================================
// Keyboard Input Constants
// =============================================================================

/** Kitty keyboard protocol flags: 1=disambiguate, 2=event types, 8=all keys as CSI */
export const KITTY_PROTOCOL_FLAGS = 11;

/** Kitty protocol escape sequences */
export const KITTY_ENABLE = '\x1b[>11u';
export const KITTY_DISABLE = '\x1b[<u';
export const KITTY_QUERY = '\x1b[?u';

/** Time in ms to wait for Kitty protocol response */
export const KITTY_DETECT_TIMEOUT_MS = 100;

/** Time in ms before auto-releasing keys in legacy mode */
export const LEGACY_KEY_RELEASE_TIME_MS = 80;

/** Small delay in ms for clearing response data */
export const KITTY_RESPONSE_CLEAR_DELAY_MS = 10;

/** Maximum escape sequence buffer length before skipping */
export const MAX_ESCAPE_SEQUENCE_LENGTH = 10;

/** Length of legacy arrow key escape sequence (e.g., \x1b[A) */
export const LEGACY_ARROW_KEY_SEQUENCE_LENGTH = 3;

/** Kitty key event types */
export const KITTY_EVENT_PRESS = 1;
export const KITTY_EVENT_REPEAT = 2;
export const KITTY_EVENT_RELEASE = 3;

/** Kitty special key codes */
export const KITTY_KEY_ESCAPE = 27;
export const KITTY_KEY_ARROW_UP = 57352;
export const KITTY_KEY_ARROW_DOWN = 57353;
export const KITTY_KEY_ARROW_LEFT = 57350;
export const KITTY_KEY_ARROW_RIGHT = 57351;
export const KITTY_KEY_F8 = 57383;
export const KITTY_KEY_F12 = 57387;

/** Standard key codes (Unicode codepoints) */
export const KEY_CODE_W = 119;
export const KEY_CODE_S = 115;
export const KEY_CODE_A = 97;
export const KEY_CODE_D = 100;
export const KEY_CODE_K = 107;
export const KEY_CODE_Z = 122;
export const KEY_CODE_J = 106;
export const KEY_CODE_X = 120;
export const KEY_CODE_ENTER = 13;
export const KEY_CODE_SPACE = 32;
export const KEY_CODE_R_LOWER = 114;
export const KEY_CODE_R_UPPER = 82;
export const KEY_CODE_M_LOWER = 109;
export const KEY_CODE_M_UPPER = 77;
export const KEY_CODE_P_LOWER = 112;
export const KEY_CODE_P_UPPER = 80;
export const KEY_CODE_N_LOWER = 110;
export const KEY_CODE_N_UPPER = 78;

// =============================================================================
// NES Controller Constants
// =============================================================================

/** Number of buttons in an NES controller */
export const NES_BUTTON_COUNT = 8;

/** Total buttons including SNES extensions */
export const CONTROLLER_BUTTON_COUNT = 12;

/** High bit for shift register (fill with 1s after all bits read) */
export const CONTROLLER_SHIFT_REGISTER_HIGH_BIT = 0x80;

// =============================================================================
// Gamepad Manager Constants
// =============================================================================

/** Interval in ms for scanning for new gamepad devices (hotplug support) */
export const GAMEPAD_SCAN_INTERVAL_MS = 3000;

/** Maximum number of gamepads supported */
export const MAX_GAMEPADS = 2;

/** Hexadecimal base for formatting hex strings */
export const HEX_BASE = 16;

/** Maximum length for profile name display truncation */
export const PROFILE_NAME_DISPLAY_LENGTH = 15;

// =============================================================================
// Analog Input Constants
// =============================================================================

/** Maximum positive value for signed 16-bit analog values */
export const ANALOG_INT16_MAX = 32767;

/** Decimal places for analog debug value formatting */
export const ANALOG_DEBUG_DECIMALS = 3;

/** Center value for unsigned 16-bit analog (Xbox Series BT uses unsigned) */
export const ANALOG_UINT16_CENTER = 32768;

// =============================================================================
// HID Usage Constants
// =============================================================================

/** HID usage page for Generic Desktop Controls */
export const HID_USAGE_PAGE_GENERIC_DESKTOP = 0x01;

/** HID usage for Joystick */
export const HID_USAGE_JOYSTICK = 0x04;

/** HID usage for Gamepad */
export const HID_USAGE_GAMEPAD = 0x05;

// =============================================================================
// Gamepad Vendor IDs
// =============================================================================

export const VENDOR_MICROSOFT = 0x045e;
export const VENDOR_SONY = 0x054c;
export const VENDOR_NINTENDO = 0x057e;
export const VENDOR_8BITDO = 0x2dc8;
export const VENDOR_PDP = 0x0e6f;
export const VENDOR_HORI = 0x0f0d;
export const VENDOR_RAZER = 0x1532;
export const VENDOR_POWERA = 0x24c6;
export const VENDOR_VALVE = 0x28de;
export const VENDOR_LOGITECH = 0x046d;
export const VENDOR_DRAGONRISE = 0x0079;
export const VENDOR_GENERIC_0810 = 0x0810;
export const VENDOR_HONEYBEE = 0x12ab;
export const VENDOR_GENERIC_1A34 = 0x1a34;
export const VENDOR_POWERA_BDA = 0x20d6;

// =============================================================================
// Xbox Product IDs
// =============================================================================

// Xbox 360 Controllers
export const PRODUCT_XBOX_360 = 0x028e;
export const PRODUCT_XBOX_360_WIRELESS = 0x028f;
export const PRODUCT_XBOX_360_WIRELESS_RECEIVER = 0x0291;
export const PRODUCT_XBOX_360_WIRELESS_ALT = 0x02a1;
export const PRODUCT_XBOX_360_WIRELESS_RECEIVER_ALT = 0x0719;

// Xbox One/Series Controllers
export const PRODUCT_XBOX_ONE = 0x02d1;
export const PRODUCT_XBOX_ONE_2015 = 0x02dd;
export const PRODUCT_XBOX_ONE_ELITE = 0x02e3;
export const PRODUCT_XBOX_ONE_S = 0x02ea;
export const PRODUCT_XBOX_ONE_S_BT = 0x02fd;
export const PRODUCT_XBOX_ELITE_S2 = 0x0b00;
export const PRODUCT_XBOX_ELITE_S2_BT = 0x0b05;
export const PRODUCT_XBOX_SERIES = 0x0b12;
export const PRODUCT_XBOX_SERIES_BT = 0x0b13;
export const PRODUCT_XBOX_ADAPTIVE = 0x0b20;
export const PRODUCT_XBOX_ADAPTIVE_BT = 0x0b21;
export const PRODUCT_XBOX_ELITE_S2_V2 = 0x0b22;

// =============================================================================
// PlayStation Product IDs
// =============================================================================

export const PRODUCT_DUALSHOCK4_V1 = 0x05c4;
export const PRODUCT_DUALSHOCK4_V2 = 0x09cc;
export const PRODUCT_DUALSHOCK4_ADAPTER = 0x0ba0;
export const PRODUCT_DUALSENSE = 0x0ce6;
export const PRODUCT_DUALSENSE_EDGE = 0x0df2;

// =============================================================================
// Nintendo Product IDs
// =============================================================================

export const PRODUCT_SWITCH_PRO = 0x2009;
export const PRODUCT_SNES_CONTROLLER = 0x2017;
export const PRODUCT_N64_CONTROLLER = 0x2019;
export const PRODUCT_GENESIS_CONTROLLER = 0x201e;

// =============================================================================
// 8BitDo Product IDs
// =============================================================================

export const PRODUCT_8BITDO_SN30 = 0x2100;
export const PRODUCT_8BITDO_SN30_PRO = 0x2101;
export const PRODUCT_8BITDO_SN30_PRO_PLUS = 0x2109;
export const PRODUCT_8BITDO_PRO_2 = 0x3010;
export const PRODUCT_8BITDO_ULTIMATE = 0x3106;
export const PRODUCT_8BITDO_SF30 = 0x6001;
export const PRODUCT_8BITDO_SF30_PRO = 0x6100;

// =============================================================================
// Xbox HID Report Constants
// =============================================================================

/** Xbox wired controller report type marker */
export const XBOX_WIRED_REPORT_TYPE = 0x20;

/** Xbox wired controller minimum report length */
export const XBOX_WIRED_REPORT_LENGTH = 19;

/** Xbox Series Bluetooth report type marker */
export const XBOX_SERIES_BT_REPORT_TYPE = 0x01;

/** Xbox Series Bluetooth minimum report length */
export const XBOX_SERIES_BT_REPORT_LENGTH = 17;

// Xbox wired byte offsets
export const XBOX_WIRED_BUTTONS_BYTE = 4;
export const XBOX_WIRED_DPAD_BYTE = 5;
export const XBOX_WIRED_SHOULDERS_BYTE = 6;
export const XBOX_WIRED_LEFT_STICK_X_OFFSET = 10;
export const XBOX_WIRED_LEFT_STICK_Y_OFFSET = 12;
export const XBOX_WIRED_RIGHT_STICK_X_OFFSET = 14;
export const XBOX_WIRED_RIGHT_STICK_Y_OFFSET = 16;

// Xbox wired button masks
export const XBOX_WIRED_MASK_START = 0x04;
export const XBOX_WIRED_MASK_SELECT = 0x08;
export const XBOX_WIRED_MASK_A = 0x10;
export const XBOX_WIRED_MASK_B = 0x20;
export const XBOX_WIRED_MASK_X = 0x40;
export const XBOX_WIRED_MASK_Y = 0x80;
export const XBOX_WIRED_MASK_GUIDE_1 = 0x01;
export const XBOX_WIRED_MASK_GUIDE_2 = 0x02;

// Xbox Series Bluetooth byte offsets
export const XBOX_SERIES_BT_LEFT_X_OFFSET = 1;
export const XBOX_SERIES_BT_LEFT_Y_OFFSET = 3;
export const XBOX_SERIES_BT_RIGHT_X_OFFSET = 5;
export const XBOX_SERIES_BT_RIGHT_Y_OFFSET = 7;
export const XBOX_SERIES_BT_HAT_BYTE = 13;
export const XBOX_SERIES_BT_FACE_BUTTONS_BYTE = 14;
export const XBOX_SERIES_BT_MENU_BUTTONS_BYTE = 15;

// Xbox Series Bluetooth button masks
export const XBOX_SERIES_BT_MASK_A = 0x01;
export const XBOX_SERIES_BT_MASK_B = 0x02;
export const XBOX_SERIES_BT_MASK_X = 0x08;
export const XBOX_SERIES_BT_MASK_Y = 0x10;
export const XBOX_SERIES_BT_MASK_LB = 0x01;
export const XBOX_SERIES_BT_MASK_RB = 0x02;
export const XBOX_SERIES_BT_MASK_VIEW = 0x04;
export const XBOX_SERIES_BT_MASK_MENU = 0x08;
export const XBOX_SERIES_BT_MASK_XBOX = 0x10;

// Xbox Series Bluetooth analog thresholds (16-bit unsigned, center ~32768)
export const XBOX_SERIES_BT_ANALOG_LOW = 20000;
export const XBOX_SERIES_BT_ANALOG_HIGH = 45000;

// =============================================================================
// Xbox 360 HID Constants
// =============================================================================

export const XBOX_360_MIN_REPORT_LENGTH = 3;
export const XBOX_360_BUTTONS_BYTE_1 = 2;
export const XBOX_360_BUTTONS_BYTE_2 = 3;

// Xbox 360 byte 1 masks (D-pad and menu)
export const XBOX_360_MASK_DPAD_UP = 0x01;
export const XBOX_360_MASK_DPAD_DOWN = 0x02;
export const XBOX_360_MASK_DPAD_LEFT = 0x04;
export const XBOX_360_MASK_DPAD_RIGHT = 0x08;
export const XBOX_360_MASK_START = 0x10;
export const XBOX_360_MASK_BACK = 0x20;

// Xbox 360 byte 2 masks (face and shoulders)
export const XBOX_360_MASK_LB = 0x01;
export const XBOX_360_MASK_RB = 0x02;
export const XBOX_360_MASK_A = 0x10;
export const XBOX_360_MASK_B = 0x20;
export const XBOX_360_MASK_X = 0x40;
export const XBOX_360_MASK_Y = 0x80;

// =============================================================================
// D-pad Bit Masks (Common across controllers)
// =============================================================================

export const DPAD_MASK_UP = 0x01;
export const DPAD_MASK_DOWN = 0x02;
export const DPAD_MASK_LEFT = 0x04;
export const DPAD_MASK_RIGHT = 0x08;
export const DPAD_HAT_MASK = 0x0f;

// =============================================================================
// Shoulder Button Masks (Common)
// =============================================================================

export const SHOULDER_MASK_L = 0x01;
export const SHOULDER_MASK_R = 0x02;
export const SHOULDER_MASK_L2 = 0x04;
export const SHOULDER_MASK_R2 = 0x08;

// =============================================================================
// PlayStation HID Report Constants
// =============================================================================

export const PS_REPORT_ID = 0x01;
export const PS_MIN_REPORT_LENGTH = 8;
export const PS_ANALOG_CENTER = 128;
/** Divisor for normalizing 8-bit analog values (center 128) to -1.0 to 1.0 */
export const PS_ANALOG_RANGE = 127;

// DualShock 4 offsets (with report ID offset adjustment)
export const DS4_LEFT_X_OFFSET = 1;
export const DS4_LEFT_Y_OFFSET = 2;
export const DS4_RIGHT_X_OFFSET = 3;
export const DS4_RIGHT_Y_OFFSET = 4;
export const DS4_HAT_AND_BUTTONS_OFFSET = 5;
export const DS4_SHOULDERS_OFFSET = 6;
export const DS4_PS_BUTTON_OFFSET = 7;

// DualShock 4 button masks
export const DS4_MASK_SQUARE = 0x10;
export const DS4_MASK_CROSS = 0x20;
export const DS4_MASK_CIRCLE = 0x40;
export const DS4_MASK_TRIANGLE = 0x80;

// DualSense offsets
export const DUALSENSE_LEFT_X_OFFSET = 1;
export const DUALSENSE_LEFT_Y_OFFSET = 2;
export const DUALSENSE_RIGHT_X_OFFSET = 3;
export const DUALSENSE_RIGHT_Y_OFFSET = 4;
export const DUALSENSE_HAT_AND_BUTTONS_OFFSET = 7;
export const DUALSENSE_SHOULDERS_OFFSET = 8;
export const DUALSENSE_PS_BUTTON_OFFSET = 9;
export const DUALSENSE_PS_BUTTON_MASK = 0x01;
export const DUALSENSE_PS_BUTTON_MIN_LENGTH = 10;

// =============================================================================
// Nintendo Switch Pro Controller Constants
// =============================================================================

export const SWITCH_PRO_MIN_REPORT_LENGTH = 4;
export const SWITCH_PRO_BUTTONS_BYTE_1 = 1;
export const SWITCH_PRO_BUTTONS_BYTE_2 = 2;
export const SWITCH_PRO_BUTTONS_BYTE_3 = 3;

// Switch Pro button masks (byte 1)
export const SWITCH_PRO_MASK_B = 0x01;
export const SWITCH_PRO_MASK_Y = 0x02;
export const SWITCH_PRO_MASK_A = 0x04;
export const SWITCH_PRO_MASK_X = 0x08;
export const SWITCH_PRO_MASK_L = 0x10;
export const SWITCH_PRO_MASK_R = 0x20;
export const SWITCH_PRO_MASK_ZL = 0x40;
export const SWITCH_PRO_MASK_ZR = 0x80;

// Switch Pro button masks (byte 2)
export const SWITCH_PRO_MASK_MINUS = 0x01;
export const SWITCH_PRO_MASK_PLUS = 0x02;
export const SWITCH_PRO_MASK_HOME = 0x10;

// =============================================================================
// 8BitDo Controller Constants
// =============================================================================

export const EIGHTBITDO_MIN_REPORT_LENGTH = 6;
export const EIGHTBITDO_LEFT_X_OFFSET = 0;
export const EIGHTBITDO_LEFT_Y_OFFSET = 1;
export const EIGHTBITDO_BUTTONS_BYTE_1 = 4;
export const EIGHTBITDO_BUTTONS_BYTE_2 = 5;

// 8BitDo button masks (byte 1)
export const EIGHTBITDO_MASK_DPAD_UP = 0x01;
export const EIGHTBITDO_MASK_DPAD_DOWN = 0x02;
export const EIGHTBITDO_MASK_DPAD_LEFT = 0x04;
export const EIGHTBITDO_MASK_DPAD_RIGHT = 0x08;
export const EIGHTBITDO_MASK_L = 0x10;
export const EIGHTBITDO_MASK_R = 0x20;

// 8BitDo button masks (byte 2)
export const EIGHTBITDO_MASK_B = 0x01;
export const EIGHTBITDO_MASK_A = 0x02;
export const EIGHTBITDO_MASK_Y = 0x04;
export const EIGHTBITDO_MASK_X = 0x08;
export const EIGHTBITDO_MASK_SELECT = 0x10;
export const EIGHTBITDO_MASK_START = 0x20;

// =============================================================================
// Generic Gamepad Constants
// =============================================================================

export const GENERIC_MIN_REPORT_LENGTH = 2;
export const GENERIC_FORMAT_A_MIN_LENGTH = 6;
export const GENERIC_ANALOG_OFFSET_X = 0;
export const GENERIC_ANALOG_OFFSET_Y = 1;
export const GENERIC_HAT_BYTE = 4;
export const GENERIC_BUTTONS_BYTE_1 = 5;
export const GENERIC_BUTTONS_BYTE_2 = 6;
export const GENERIC_MAX_HAT_VALUE = 8;

// Generic button masks (format 1)
export const GENERIC_MASK_BUTTON_1 = 0x01;
export const GENERIC_MASK_BUTTON_2 = 0x02;
export const GENERIC_MASK_BUTTON_3 = 0x04;
export const GENERIC_MASK_BUTTON_4 = 0x08;
export const GENERIC_MASK_BUTTON_L = 0x10;
export const GENERIC_MASK_BUTTON_R = 0x20;
export const GENERIC_MASK_BUTTON_SELECT = 0x40;
export const GENERIC_MASK_BUTTON_START = 0x80;

// Generic fallback format masks
export const GENERIC_FALLBACK_MASK_SELECT = 0x04;
export const GENERIC_FALLBACK_MASK_START = 0x08;
export const GENERIC_FALLBACK_MASK_UP = 0x10;
export const GENERIC_FALLBACK_MASK_DOWN = 0x20;
export const GENERIC_FALLBACK_MASK_LEFT = 0x40;
export const GENERIC_FALLBACK_MASK_RIGHT = 0x80;
