import { StandardButton } from '../../core/button';
import {
  readInt16LE,
  readUint16LE,
  applySignedAnalogToDpad,
  analogToDpad,
  hatToDpad,
} from '../../utils/buffer';
import {
  // Vendor IDs
  VENDOR_MICROSOFT,
  VENDOR_SONY,
  VENDOR_NINTENDO,
  VENDOR_8BITDO,
  VENDOR_PDP,
  VENDOR_HORI,
  VENDOR_RAZER,
  VENDOR_POWERA,
  VENDOR_VALVE,
  VENDOR_LOGITECH,
  VENDOR_DRAGONRISE,
  VENDOR_GENERIC_0810,
  VENDOR_HONEYBEE,
  VENDOR_GENERIC_1A34,
  VENDOR_POWERA_BDA,
  // Xbox 360 Product IDs
  PRODUCT_XBOX_360,
  PRODUCT_XBOX_360_WIRELESS,
  PRODUCT_XBOX_360_WIRELESS_RECEIVER,
  PRODUCT_XBOX_360_WIRELESS_ALT,
  PRODUCT_XBOX_360_WIRELESS_RECEIVER_ALT,
  // Xbox One/Series Product IDs
  PRODUCT_XBOX_ONE,
  PRODUCT_XBOX_ONE_2015,
  PRODUCT_XBOX_ONE_ELITE,
  PRODUCT_XBOX_ONE_S,
  PRODUCT_XBOX_ONE_S_BT,
  PRODUCT_XBOX_ELITE_S2,
  PRODUCT_XBOX_ELITE_S2_BT,
  PRODUCT_XBOX_SERIES,
  PRODUCT_XBOX_SERIES_BT,
  PRODUCT_XBOX_ADAPTIVE,
  PRODUCT_XBOX_ADAPTIVE_BT,
  PRODUCT_XBOX_ELITE_S2_V2,
  // PlayStation Product IDs
  PRODUCT_DUALSHOCK4_V1,
  PRODUCT_DUALSHOCK4_V2,
  PRODUCT_DUALSHOCK4_ADAPTER,
  PRODUCT_DUALSENSE,
  PRODUCT_DUALSENSE_EDGE,
  // Nintendo Product IDs
  PRODUCT_SWITCH_PRO,
  PRODUCT_SNES_CONTROLLER,
  PRODUCT_N64_CONTROLLER,
  PRODUCT_GENESIS_CONTROLLER,
  // 8BitDo Product IDs
  PRODUCT_8BITDO_SN30,
  PRODUCT_8BITDO_SN30_PRO,
  PRODUCT_8BITDO_SN30_PRO_PLUS,
  PRODUCT_8BITDO_PRO_2,
  PRODUCT_8BITDO_ULTIMATE,
  PRODUCT_8BITDO_SF30,
  PRODUCT_8BITDO_SF30_PRO,
  // Xbox HID constants
  XBOX_WIRED_REPORT_TYPE,
  XBOX_WIRED_REPORT_LENGTH,
  XBOX_SERIES_BT_REPORT_TYPE,
  XBOX_SERIES_BT_REPORT_LENGTH,
  XBOX_WIRED_BUTTONS_BYTE,
  XBOX_WIRED_DPAD_BYTE,
  XBOX_WIRED_SHOULDERS_BYTE,
  XBOX_WIRED_LEFT_STICK_X_OFFSET,
  XBOX_WIRED_LEFT_STICK_Y_OFFSET,
  XBOX_WIRED_RIGHT_STICK_X_OFFSET,
  XBOX_WIRED_RIGHT_STICK_Y_OFFSET,
  XBOX_WIRED_MASK_START,
  XBOX_WIRED_MASK_SELECT,
  XBOX_WIRED_MASK_A,
  XBOX_WIRED_MASK_B,
  XBOX_WIRED_MASK_X,
  XBOX_WIRED_MASK_Y,
  XBOX_WIRED_MASK_GUIDE_1,
  XBOX_WIRED_MASK_GUIDE_2,
  XBOX_SERIES_BT_LEFT_X_OFFSET,
  XBOX_SERIES_BT_LEFT_Y_OFFSET,
  XBOX_SERIES_BT_RIGHT_X_OFFSET,
  XBOX_SERIES_BT_RIGHT_Y_OFFSET,
  XBOX_SERIES_BT_HAT_BYTE,
  XBOX_SERIES_BT_FACE_BUTTONS_BYTE,
  XBOX_SERIES_BT_MENU_BUTTONS_BYTE,
  XBOX_SERIES_BT_MASK_A,
  XBOX_SERIES_BT_MASK_B,
  XBOX_SERIES_BT_MASK_X,
  XBOX_SERIES_BT_MASK_Y,
  XBOX_SERIES_BT_MASK_LB,
  XBOX_SERIES_BT_MASK_RB,
  XBOX_SERIES_BT_MASK_VIEW,
  XBOX_SERIES_BT_MASK_MENU,
  XBOX_SERIES_BT_MASK_XBOX,
  XBOX_SERIES_BT_ANALOG_LOW,
  XBOX_SERIES_BT_ANALOG_HIGH,
  // Xbox 360 constants
  XBOX_360_MIN_REPORT_LENGTH,
  XBOX_360_BUTTONS_BYTE_1,
  XBOX_360_BUTTONS_BYTE_2,
  XBOX_360_MASK_DPAD_UP,
  XBOX_360_MASK_DPAD_DOWN,
  XBOX_360_MASK_DPAD_LEFT,
  XBOX_360_MASK_DPAD_RIGHT,
  XBOX_360_MASK_START,
  XBOX_360_MASK_BACK,
  XBOX_360_MASK_LB,
  XBOX_360_MASK_RB,
  XBOX_360_MASK_A,
  XBOX_360_MASK_B,
  XBOX_360_MASK_X,
  XBOX_360_MASK_Y,
  // D-pad masks
  DPAD_MASK_UP,
  DPAD_MASK_DOWN,
  DPAD_MASK_LEFT,
  DPAD_MASK_RIGHT,
  DPAD_HAT_MASK,
  // Shoulder masks
  SHOULDER_MASK_L,
  SHOULDER_MASK_R,
  SHOULDER_MASK_L2,
  SHOULDER_MASK_R2,
  // PlayStation constants
  PS_REPORT_ID,
  PS_MIN_REPORT_LENGTH,
  PS_ANALOG_CENTER,
  PS_ANALOG_RANGE,
  DS4_LEFT_X_OFFSET,
  DS4_LEFT_Y_OFFSET,
  DS4_RIGHT_X_OFFSET,
  DS4_RIGHT_Y_OFFSET,
  DS4_HAT_AND_BUTTONS_OFFSET,
  DS4_SHOULDERS_OFFSET,
  DS4_PS_BUTTON_OFFSET,
  DS4_MASK_SQUARE,
  DS4_MASK_CROSS,
  DS4_MASK_CIRCLE,
  DS4_MASK_TRIANGLE,
  DUALSENSE_LEFT_X_OFFSET,
  DUALSENSE_LEFT_Y_OFFSET,
  DUALSENSE_RIGHT_X_OFFSET,
  DUALSENSE_RIGHT_Y_OFFSET,
  DUALSENSE_HAT_AND_BUTTONS_OFFSET,
  DUALSENSE_SHOULDERS_OFFSET,
  DUALSENSE_PS_BUTTON_OFFSET,
  DUALSENSE_PS_BUTTON_MASK,
  DUALSENSE_PS_BUTTON_MIN_LENGTH,
  // Switch Pro constants
  SWITCH_PRO_MIN_REPORT_LENGTH,
  SWITCH_PRO_BUTTONS_BYTE_1,
  SWITCH_PRO_BUTTONS_BYTE_2,
  SWITCH_PRO_BUTTONS_BYTE_3,
  SWITCH_PRO_MASK_B,
  SWITCH_PRO_MASK_Y,
  SWITCH_PRO_MASK_A,
  SWITCH_PRO_MASK_X,
  SWITCH_PRO_MASK_L,
  SWITCH_PRO_MASK_R,
  SWITCH_PRO_MASK_ZL,
  SWITCH_PRO_MASK_ZR,
  SWITCH_PRO_MASK_MINUS,
  SWITCH_PRO_MASK_PLUS,
  SWITCH_PRO_MASK_HOME,
  // 8BitDo constants
  EIGHTBITDO_MIN_REPORT_LENGTH,
  EIGHTBITDO_LEFT_X_OFFSET,
  EIGHTBITDO_LEFT_Y_OFFSET,
  EIGHTBITDO_BUTTONS_BYTE_1,
  EIGHTBITDO_BUTTONS_BYTE_2,
  EIGHTBITDO_MASK_DPAD_UP,
  EIGHTBITDO_MASK_DPAD_DOWN,
  EIGHTBITDO_MASK_DPAD_LEFT,
  EIGHTBITDO_MASK_DPAD_RIGHT,
  EIGHTBITDO_MASK_L,
  EIGHTBITDO_MASK_R,
  EIGHTBITDO_MASK_B,
  EIGHTBITDO_MASK_A,
  EIGHTBITDO_MASK_Y,
  EIGHTBITDO_MASK_X,
  EIGHTBITDO_MASK_SELECT,
  EIGHTBITDO_MASK_START,
  // Generic constants
  GENERIC_MIN_REPORT_LENGTH,
  GENERIC_FORMAT_A_MIN_LENGTH,
  GENERIC_ANALOG_OFFSET_X,
  GENERIC_ANALOG_OFFSET_Y,
  GENERIC_HAT_BYTE,
  GENERIC_BUTTONS_BYTE_1,
  GENERIC_BUTTONS_BYTE_2,
  GENERIC_MAX_HAT_VALUE,
  GENERIC_MASK_BUTTON_1,
  GENERIC_MASK_BUTTON_2,
  GENERIC_MASK_BUTTON_3,
  GENERIC_MASK_BUTTON_4,
  GENERIC_MASK_BUTTON_L,
  GENERIC_MASK_BUTTON_R,
  GENERIC_MASK_BUTTON_SELECT,
  GENERIC_MASK_BUTTON_START,
  GENERIC_FALLBACK_MASK_SELECT,
  GENERIC_FALLBACK_MASK_START,
  GENERIC_FALLBACK_MASK_UP,
  GENERIC_FALLBACK_MASK_DOWN,
  GENERIC_FALLBACK_MASK_LEFT,
  GENERIC_FALLBACK_MASK_RIGHT,
  // HID usage constants
  HID_USAGE_PAGE_GENERIC_DESKTOP,
  HID_USAGE_JOYSTICK,
  HID_USAGE_GAMEPAD,
  // Analog input constants
  ANALOG_INT16_MAX,
  ANALOG_UINT16_CENTER,
} from '..';

/**
 * Analog stick state from parsing HID report
 * Values are normalized from -1.0 to 1.0
 */
export interface AnalogState {
  /** Left stick X axis (-1.0 = left, 1.0 = right) */
  leftX: number;
  /** Left stick Y axis (-1.0 = up, 1.0 = down) */
  leftY: number;
  /** Right stick X axis (-1.0 = left, 1.0 = right) */
  rightX: number;
  /** Right stick Y axis (-1.0 = up, 1.0 = down) */
  rightY: number;
}

/**
 * Gamepad button mapping profile
 * Maps raw HID report data to StandardButton for multi-core support
 */
export interface GamepadProfile {
  name: string;
  /** Vendor IDs this profile matches */
  vendorIds: number[];
  /** Product IDs this profile matches (empty = match any for this vendor) */
  productIds: number[];
  /** Parse HID report and return button states */
  parseReport: (data: Buffer) => Map<StandardButton, boolean>;
  /** Optional: Parse HID report and return analog stick values (normalized -1.0 to 1.0) */
  parseAnalog?: (data: Buffer) => AnalogState | null;
}

/**
 * Xbox Wired Controller HID format
 * 19-byte reports starting with 0x20
 * Used by wired Xbox 360/One controllers
 *
 * Button mapping by physical position (Xbox → SNES layout):
 * - Xbox A (bottom) → StandardButton.B
 * - Xbox B (right) → StandardButton.A
 * - Xbox X (left) → StandardButton.Y
 * - Xbox Y (top) → StandardButton.X
 */
const xboxWiredProfile: GamepadProfile = {
  name: 'Xbox Wired Controller',
  vendorIds: [VENDOR_MICROSOFT],
  productIds: [], // Match any Microsoft controller
  parseReport: (data: Buffer): Map<StandardButton, boolean> => {
    const buttons = new Map<StandardButton, boolean>();

    // Xbox wired controller HID format (19 bytes):
    // Byte 0: Report type (0x20)
    // Byte 1: Unknown (0x00)
    // Byte 2: Packet counter
    // Byte 3: Unknown (0x2c)
    // Byte 4: Start=0x04, Select=0x08, A=0x10, B=0x20, X=0x40, Y=0x80
    // Byte 5: D-pad - Up=0x01, Down=0x02, Left=0x04, Right=0x08
    // Byte 6: LB=0x01, RB=0x02
    // Bytes 7-9: Triggers
    // Bytes 10-17: Analog sticks (16-bit values)

    if (data.length >= XBOX_WIRED_REPORT_LENGTH && data[0] === XBOX_WIRED_REPORT_TYPE) {
      const buttonsAndMenu = data[XBOX_WIRED_BUTTONS_BYTE];
      const dpad = data[XBOX_WIRED_DPAD_BYTE];
      const shoulders = data[XBOX_WIRED_SHOULDERS_BYTE];

      // D-pad
      buttons.set(StandardButton.Up, (dpad & DPAD_MASK_UP) !== 0);
      buttons.set(StandardButton.Down, (dpad & DPAD_MASK_DOWN) !== 0);
      buttons.set(StandardButton.Left, (dpad & DPAD_MASK_LEFT) !== 0);
      buttons.set(StandardButton.Right, (dpad & DPAD_MASK_RIGHT) !== 0);

      // Face buttons mapped by physical position (Xbox → SNES)
      // Xbox A (bottom, 0x10) → SNES B (bottom)
      buttons.set(StandardButton.B, (buttonsAndMenu & XBOX_WIRED_MASK_A) !== 0);
      // Xbox B (right, 0x20) → SNES A (right)
      buttons.set(StandardButton.A, (buttonsAndMenu & XBOX_WIRED_MASK_B) !== 0);
      // Xbox X (left, 0x40) → SNES Y (left)
      buttons.set(StandardButton.Y, (buttonsAndMenu & XBOX_WIRED_MASK_X) !== 0);
      // Xbox Y (top, 0x80) → SNES X (top)
      buttons.set(StandardButton.X, (buttonsAndMenu & XBOX_WIRED_MASK_Y) !== 0);

      // Shoulder buttons
      buttons.set(StandardButton.L, (shoulders & SHOULDER_MASK_L) !== 0);
      buttons.set(StandardButton.R, (shoulders & SHOULDER_MASK_R) !== 0);

      // Menu buttons
      buttons.set(StandardButton.Start, (buttonsAndMenu & XBOX_WIRED_MASK_START) !== 0);
      buttons.set(StandardButton.Select, (buttonsAndMenu & XBOX_WIRED_MASK_SELECT) !== 0);

      // Xbox/Guide button (byte 4, bit 0x01 or 0x02 depending on controller)
      buttons.set(StandardButton.Guide, (buttonsAndMenu & XBOX_WIRED_MASK_GUIDE_1) !== 0 || (buttonsAndMenu & XBOX_WIRED_MASK_GUIDE_2) !== 0);

      // Also check left analog stick for d-pad (bytes 10-13 are signed 16-bit LE)
      if (data.length >= XBOX_WIRED_LEFT_STICK_Y_OFFSET + 2) {
        applySignedAnalogToDpad(buttons, readInt16LE(data, XBOX_WIRED_LEFT_STICK_X_OFFSET), readInt16LE(data, XBOX_WIRED_LEFT_STICK_Y_OFFSET));
      }

      return buttons;
    }

    return buttons;
  },
  parseAnalog: (data: Buffer): AnalogState | null => {
    // Xbox wired controller format
    // Bytes 10-11: Left stick X (signed 16-bit LE)
    // Bytes 12-13: Left stick Y (signed 16-bit LE)
    // Bytes 14-15: Right stick X (signed 16-bit LE)
    // Bytes 16-17: Right stick Y (signed 16-bit LE)
    if (data.length >= XBOX_WIRED_REPORT_LENGTH && data[0] === XBOX_WIRED_REPORT_TYPE) {
      const leftX = readInt16LE(data, XBOX_WIRED_LEFT_STICK_X_OFFSET) / ANALOG_INT16_MAX;
      const leftY = readInt16LE(data, XBOX_WIRED_LEFT_STICK_Y_OFFSET) / ANALOG_INT16_MAX;
      const rightX = readInt16LE(data, XBOX_WIRED_RIGHT_STICK_X_OFFSET) / ANALOG_INT16_MAX;
      const rightY = readInt16LE(data, XBOX_WIRED_RIGHT_STICK_Y_OFFSET) / ANALOG_INT16_MAX;
      return { leftX, leftY, rightX, rightY };
    }
    return null;
  },
};

/**
 * Xbox One / Series controller profile
 * Works on macOS, Windows, and Linux via Bluetooth or USB
 *
 * Button mapping by physical position (Xbox → SNES layout):
 * - Xbox A (bottom) → StandardButton.B
 * - Xbox B (right) → StandardButton.A
 * - Xbox X (left) → StandardButton.Y
 * - Xbox Y (top) → StandardButton.X
 */
const xboxOneProfile: GamepadProfile = {
  name: 'Xbox One/Series Controller',
  vendorIds: [
    VENDOR_MICROSOFT,
    VENDOR_PDP,
    VENDOR_HORI,
    VENDOR_RAZER,
    VENDOR_POWERA,
  ],
  productIds: [
    // Microsoft Xbox One/Series controllers
    PRODUCT_XBOX_ONE,
    PRODUCT_XBOX_ONE_2015,
    PRODUCT_XBOX_ONE_ELITE,
    PRODUCT_XBOX_ONE_S,
    PRODUCT_XBOX_ONE_S_BT,
    PRODUCT_XBOX_ELITE_S2,
    PRODUCT_XBOX_ELITE_S2_BT,
    PRODUCT_XBOX_SERIES,
    PRODUCT_XBOX_SERIES_BT,
    PRODUCT_XBOX_ADAPTIVE,
    PRODUCT_XBOX_ADAPTIVE_BT,
    PRODUCT_XBOX_ELITE_S2_V2,
  ],
  parseReport: (data: Buffer): Map<StandardButton, boolean> => {
    const buttons = new Map<StandardButton, boolean>();

    // Xbox Series X|S Bluetooth format (17 bytes):
    // Byte 0: Report ID (0x01)
    // Bytes 1-2: Left stick X (16-bit LE)
    // Bytes 3-4: Left stick Y (16-bit LE)
    // Bytes 5-6: Right stick X (16-bit LE)
    // Bytes 7-8: Right stick Y (16-bit LE)
    // Bytes 9-10: Left trigger (16-bit)
    // Bytes 11-12: Right trigger (16-bit)
    // Byte 13: D-pad hat (0=none, 1=N, 2=NE, 3=E, 4=SE, 5=S, 6=SW, 7=W, 8=NW)
    // Byte 14: Face buttons (A=0x01, B=0x02, X=0x08, Y=0x10)
    // Byte 15: LB=0x01, RB=0x02, View=0x04, Menu=0x08, Xbox=0x10

    if (data.length >= XBOX_SERIES_BT_REPORT_LENGTH && data[0] === XBOX_SERIES_BT_REPORT_TYPE) {
      // D-pad from hat switch (byte 13)
      const hat = data[XBOX_SERIES_BT_HAT_BYTE];
      const dpad = hatToDpad(hat, true);

      // Also support left stick as d-pad (bytes 1-4 are 16-bit LE values)
      const leftX = readUint16LE(data, XBOX_SERIES_BT_LEFT_X_OFFSET); // center ~32768
      const leftY = readUint16LE(data, XBOX_SERIES_BT_LEFT_Y_OFFSET);
      const stickDpad = {
        left: leftX < XBOX_SERIES_BT_ANALOG_LOW,
        right: leftX > XBOX_SERIES_BT_ANALOG_HIGH,
        up: leftY < XBOX_SERIES_BT_ANALOG_LOW,
        down: leftY > XBOX_SERIES_BT_ANALOG_HIGH,
      };

      buttons.set(StandardButton.Up, dpad.up || stickDpad.up);
      buttons.set(StandardButton.Down, dpad.down || stickDpad.down);
      buttons.set(StandardButton.Left, dpad.left || stickDpad.left);
      buttons.set(StandardButton.Right, dpad.right || stickDpad.right);

      // Face buttons mapped by physical position (Xbox → SNES)
      const faceButtons = data[XBOX_SERIES_BT_FACE_BUTTONS_BYTE];
      // Xbox A (bottom, 0x01) → SNES B (bottom)
      buttons.set(StandardButton.B, (faceButtons & XBOX_SERIES_BT_MASK_A) !== 0);
      // Xbox B (right, 0x02) → SNES A (right)
      buttons.set(StandardButton.A, (faceButtons & XBOX_SERIES_BT_MASK_B) !== 0);
      // Xbox X (left, 0x08) → SNES Y (left)
      buttons.set(StandardButton.Y, (faceButtons & XBOX_SERIES_BT_MASK_X) !== 0);
      // Xbox Y (top, 0x10) → SNES X (top)
      buttons.set(StandardButton.X, (faceButtons & XBOX_SERIES_BT_MASK_Y) !== 0);

      // Shoulder buttons and menu (byte 15)
      const menuButtons = data[XBOX_SERIES_BT_MENU_BUTTONS_BYTE];
      buttons.set(StandardButton.L, (menuButtons & XBOX_SERIES_BT_MASK_LB) !== 0); // LB
      buttons.set(StandardButton.R, (menuButtons & XBOX_SERIES_BT_MASK_RB) !== 0); // RB
      buttons.set(StandardButton.Select, (menuButtons & XBOX_SERIES_BT_MASK_VIEW) !== 0); // View button
      buttons.set(StandardButton.Start, (menuButtons & XBOX_SERIES_BT_MASK_MENU) !== 0);  // Menu button
      buttons.set(StandardButton.Guide, (menuButtons & XBOX_SERIES_BT_MASK_XBOX) !== 0);  // Xbox button

      return buttons;
    }

    // Xbox wired controller format (19 bytes starting with 0x20)
    // Byte 4: Start=0x04, Select=0x08, A=0x10, B=0x20, X=0x40, Y=0x80
    // Byte 5: D-pad - Up=0x01, Down=0x02, Left=0x04, Right=0x08
    // Byte 6: LB=0x01, RB=0x02
    if (data.length >= XBOX_WIRED_REPORT_LENGTH && data[0] === XBOX_WIRED_REPORT_TYPE) {
      const buttonsAndMenu = data[XBOX_WIRED_BUTTONS_BYTE];
      const dpad = data[XBOX_WIRED_DPAD_BYTE];
      const shoulders = data[XBOX_WIRED_SHOULDERS_BYTE];

      // D-pad
      buttons.set(StandardButton.Up, (dpad & DPAD_MASK_UP) !== 0);
      buttons.set(StandardButton.Down, (dpad & DPAD_MASK_DOWN) !== 0);
      buttons.set(StandardButton.Left, (dpad & DPAD_MASK_LEFT) !== 0);
      buttons.set(StandardButton.Right, (dpad & DPAD_MASK_RIGHT) !== 0);

      // Face buttons mapped by physical position (Xbox → SNES)
      // Xbox A (bottom, 0x10) → SNES B (bottom)
      buttons.set(StandardButton.B, (buttonsAndMenu & XBOX_WIRED_MASK_A) !== 0);
      // Xbox B (right, 0x20) → SNES A (right)
      buttons.set(StandardButton.A, (buttonsAndMenu & XBOX_WIRED_MASK_B) !== 0);
      // Xbox X (left, 0x40) → SNES Y (left)
      buttons.set(StandardButton.Y, (buttonsAndMenu & XBOX_WIRED_MASK_X) !== 0);
      // Xbox Y (top, 0x80) → SNES X (top)
      buttons.set(StandardButton.X, (buttonsAndMenu & XBOX_WIRED_MASK_Y) !== 0);

      // Shoulder buttons
      buttons.set(StandardButton.L, (shoulders & SHOULDER_MASK_L) !== 0);
      buttons.set(StandardButton.R, (shoulders & SHOULDER_MASK_R) !== 0);

      // Menu buttons
      buttons.set(StandardButton.Start, (buttonsAndMenu & XBOX_WIRED_MASK_START) !== 0);
      buttons.set(StandardButton.Select, (buttonsAndMenu & XBOX_WIRED_MASK_SELECT) !== 0);

      // Xbox/Guide button (byte 4, bit 0x01 or 0x02 depending on controller)
      buttons.set(StandardButton.Guide, (buttonsAndMenu & XBOX_WIRED_MASK_GUIDE_1) !== 0 || (buttonsAndMenu & XBOX_WIRED_MASK_GUIDE_2) !== 0);

      // Left analog stick (bytes 10-13 are signed 16-bit LE)
      if (data.length >= XBOX_WIRED_LEFT_STICK_Y_OFFSET + 2) {
        applySignedAnalogToDpad(buttons, readInt16LE(data, XBOX_WIRED_LEFT_STICK_X_OFFSET), readInt16LE(data, XBOX_WIRED_LEFT_STICK_Y_OFFSET));
      }

      return buttons;
    }

    // Fallback for other Xbox controller formats or shorter reports
    if (data.length >= PS_MIN_REPORT_LENGTH) {
      // Try generic format - map by physical position
      const btnByte = data[0];
      buttons.set(StandardButton.B, (btnByte & GENERIC_MASK_BUTTON_1) !== 0); // A → B
      buttons.set(StandardButton.A, (btnByte & GENERIC_MASK_BUTTON_2) !== 0); // B → A
      buttons.set(StandardButton.Select, (btnByte & GENERIC_FALLBACK_MASK_SELECT) !== 0);
      buttons.set(StandardButton.Start, (btnByte & GENERIC_FALLBACK_MASK_START) !== 0);
      buttons.set(StandardButton.Up, (btnByte & GENERIC_FALLBACK_MASK_UP) !== 0);
      buttons.set(StandardButton.Down, (btnByte & GENERIC_FALLBACK_MASK_DOWN) !== 0);
      buttons.set(StandardButton.Left, (btnByte & GENERIC_FALLBACK_MASK_LEFT) !== 0);
      buttons.set(StandardButton.Right, (btnByte & GENERIC_FALLBACK_MASK_RIGHT) !== 0);
    }

    return buttons;
  },
  parseAnalog: (data: Buffer): AnalogState | null => {
    // Xbox Series X|S Bluetooth format (17 bytes)
    if (data.length >= XBOX_SERIES_BT_REPORT_LENGTH && data[0] === XBOX_SERIES_BT_REPORT_TYPE) {
      // Bytes 1-2: Left stick X (unsigned 16-bit, center at 32768)
      // Bytes 3-4: Left stick Y (unsigned 16-bit, center at 32768)
      // Bytes 5-6: Right stick X
      // Bytes 7-8: Right stick Y
      const leftX = (readUint16LE(data, XBOX_SERIES_BT_LEFT_X_OFFSET) - ANALOG_UINT16_CENTER) / ANALOG_INT16_MAX;
      const leftY = (readUint16LE(data, XBOX_SERIES_BT_LEFT_Y_OFFSET) - ANALOG_UINT16_CENTER) / ANALOG_INT16_MAX;
      const rightX = (readUint16LE(data, XBOX_SERIES_BT_RIGHT_X_OFFSET) - ANALOG_UINT16_CENTER) / ANALOG_INT16_MAX;
      const rightY = (readUint16LE(data, XBOX_SERIES_BT_RIGHT_Y_OFFSET) - ANALOG_UINT16_CENTER) / ANALOG_INT16_MAX;
      return { leftX, leftY, rightX, rightY };
    }

    // Xbox wired controller format
    if (data.length >= XBOX_WIRED_REPORT_LENGTH && data[0] === XBOX_WIRED_REPORT_TYPE) {
      const leftX = readInt16LE(data, XBOX_WIRED_LEFT_STICK_X_OFFSET) / ANALOG_INT16_MAX;
      const leftY = readInt16LE(data, XBOX_WIRED_LEFT_STICK_Y_OFFSET) / ANALOG_INT16_MAX;
      const rightX = readInt16LE(data, XBOX_WIRED_RIGHT_STICK_X_OFFSET) / ANALOG_INT16_MAX;
      const rightY = readInt16LE(data, XBOX_WIRED_RIGHT_STICK_Y_OFFSET) / ANALOG_INT16_MAX;
      return { leftX, leftY, rightX, rightY };
    }

    return null;
  },
};

/**
 * Xbox 360 controller profile
 *
 * Button mapping by physical position (Xbox → SNES layout):
 * - Xbox A (bottom) → StandardButton.B
 * - Xbox B (right) → StandardButton.A
 * - Xbox X (left) → StandardButton.Y
 * - Xbox Y (top) → StandardButton.X
 */
const xbox360Profile: GamepadProfile = {
  name: 'Xbox 360 Controller',
  vendorIds: [VENDOR_MICROSOFT],
  productIds: [
    PRODUCT_XBOX_360,
    PRODUCT_XBOX_360_WIRELESS,
    PRODUCT_XBOX_360_WIRELESS_RECEIVER,
    PRODUCT_XBOX_360_WIRELESS_ALT,
    PRODUCT_XBOX_360_WIRELESS_RECEIVER_ALT,
  ],
  parseReport: (data: Buffer): Map<StandardButton, boolean> => {
    const buttons = new Map<StandardButton, boolean>();

    if (data.length < XBOX_360_MIN_REPORT_LENGTH) {
      return buttons;
    }

    // Xbox 360 HID format
    // Byte 2: D-pad and menu buttons
    // Byte 3: Face buttons and shoulders
    const btnByte1 = data[XBOX_360_BUTTONS_BYTE_1];
    const btnByte2 = data[XBOX_360_BUTTONS_BYTE_2];

    // D-pad
    buttons.set(StandardButton.Up, (btnByte1 & XBOX_360_MASK_DPAD_UP) !== 0);
    buttons.set(StandardButton.Down, (btnByte1 & XBOX_360_MASK_DPAD_DOWN) !== 0);
    buttons.set(StandardButton.Left, (btnByte1 & XBOX_360_MASK_DPAD_LEFT) !== 0);
    buttons.set(StandardButton.Right, (btnByte1 & XBOX_360_MASK_DPAD_RIGHT) !== 0);

    // Start/Back (Select)
    buttons.set(StandardButton.Start, (btnByte1 & XBOX_360_MASK_START) !== 0);
    buttons.set(StandardButton.Select, (btnByte1 & XBOX_360_MASK_BACK) !== 0);

    // Face buttons mapped by physical position (Xbox → SNES)
    // Xbox A (bottom, 0x10) → SNES B (bottom)
    buttons.set(StandardButton.B, (btnByte2 & XBOX_360_MASK_A) !== 0);
    // Xbox B (right, 0x20) → SNES A (right)
    buttons.set(StandardButton.A, (btnByte2 & XBOX_360_MASK_B) !== 0);
    // Xbox X (left, 0x40) → SNES Y (left)
    buttons.set(StandardButton.Y, (btnByte2 & XBOX_360_MASK_X) !== 0);
    // Xbox Y (top, 0x80) → SNES X (top)
    buttons.set(StandardButton.X, (btnByte2 & XBOX_360_MASK_Y) !== 0);

    // Shoulder buttons
    buttons.set(StandardButton.L, (btnByte2 & XBOX_360_MASK_LB) !== 0);
    buttons.set(StandardButton.R, (btnByte2 & XBOX_360_MASK_RB) !== 0);

    return buttons;
  },
};

/**
 * PlayStation DualShock 4 profile
 *
 * Button mapping by physical position (PlayStation → SNES layout):
 * - Cross (bottom) → StandardButton.B
 * - Circle (right) → StandardButton.A
 * - Square (left) → StandardButton.Y
 * - Triangle (top) → StandardButton.X
 */
const dualShock4Profile: GamepadProfile = {
  name: 'PlayStation DualShock 4',
  vendorIds: [VENDOR_SONY],
  productIds: [
    PRODUCT_DUALSHOCK4_V1,
    PRODUCT_DUALSHOCK4_V2,
    PRODUCT_DUALSHOCK4_ADAPTER,
  ],
  parseReport: (data: Buffer): Map<StandardButton, boolean> => {
    const buttons = new Map<StandardButton, boolean>();

    if (data.length < PS_MIN_REPORT_LENGTH) {
      return buttons;
    }

    // DS4 HID report format (USB):
    // Byte 0: Report ID (0x01)
    // Byte 1: Left stick X
    // Byte 2: Left stick Y
    // Byte 3: Right stick X
    // Byte 4: Right stick Y
    // Byte 5: Hat switch (lower 4 bits) + face buttons
    // Byte 6-7: Shoulders and menu buttons

    const offset = data[0] === PS_REPORT_ID ? 0 : -1; // Adjust for report ID

    const leftX = data[DS4_LEFT_X_OFFSET + offset] ?? PS_ANALOG_CENTER;
    const leftY = data[DS4_LEFT_Y_OFFSET + offset] ?? PS_ANALOG_CENTER;
    const hatAndButtons = data[DS4_HAT_AND_BUTTONS_OFFSET + offset] ?? 0;
    const btnByte1 = data[DS4_SHOULDERS_OFFSET + offset] ?? 0;

    // Hat switch for d-pad (lower 4 bits)
    const hat = hatAndButtons & DPAD_HAT_MASK;
    const dpad = hatToDpad(hat);

    // Also check left stick
    const stickDpad = analogToDpad(leftX, leftY);

    buttons.set(StandardButton.Up, dpad.up || stickDpad.up);
    buttons.set(StandardButton.Down, dpad.down || stickDpad.down);
    buttons.set(StandardButton.Left, dpad.left || stickDpad.left);
    buttons.set(StandardButton.Right, dpad.right || stickDpad.right);

    // Face buttons mapped by physical position (PlayStation → SNES)
    // Cross (bottom, 0x20) → SNES B (bottom)
    buttons.set(StandardButton.B, (hatAndButtons & DS4_MASK_CROSS) !== 0);
    // Circle (right, 0x40) → SNES A (right)
    buttons.set(StandardButton.A, (hatAndButtons & DS4_MASK_CIRCLE) !== 0);
    // Square (left, 0x10) → SNES Y (left)
    buttons.set(StandardButton.Y, (hatAndButtons & DS4_MASK_SQUARE) !== 0);
    // Triangle (top, 0x80) → SNES X (top)
    buttons.set(StandardButton.X, (hatAndButtons & DS4_MASK_TRIANGLE) !== 0);

    // Shoulder buttons
    buttons.set(StandardButton.L, (btnByte1 & SHOULDER_MASK_L) !== 0);  // L1
    buttons.set(StandardButton.R, (btnByte1 & SHOULDER_MASK_R) !== 0);  // R1
    buttons.set(StandardButton.L2, (btnByte1 & SHOULDER_MASK_L2) !== 0); // L2
    buttons.set(StandardButton.R2, (btnByte1 & SHOULDER_MASK_R2) !== 0); // R2

    // Share = Select, Options = Start
    buttons.set(StandardButton.Select, (btnByte1 & GENERIC_FALLBACK_MASK_UP) !== 0);
    buttons.set(StandardButton.Start, (btnByte1 & GENERIC_FALLBACK_MASK_DOWN) !== 0);

    // PS button (byte 7, bit 0x01)
    if (data.length >= PS_MIN_REPORT_LENGTH) {
      const btnByte2 = data[DS4_PS_BUTTON_OFFSET + offset] ?? 0;
      buttons.set(StandardButton.Guide, (btnByte2 & DUALSENSE_PS_BUTTON_MASK) !== 0);
    }

    return buttons;
  },
  parseAnalog: (data: Buffer): AnalogState | null => {
    if (data.length < PS_MIN_REPORT_LENGTH) {
      return null;
    }

    const offset = data[0] === PS_REPORT_ID ? 0 : -1;

    // DS4 sticks are unsigned 8-bit (0-255, center at 128)
    const leftX = ((data[DS4_LEFT_X_OFFSET + offset] ?? PS_ANALOG_CENTER) - PS_ANALOG_CENTER) / PS_ANALOG_RANGE;
    const leftY = ((data[DS4_LEFT_Y_OFFSET + offset] ?? PS_ANALOG_CENTER) - PS_ANALOG_CENTER) / PS_ANALOG_RANGE;
    const rightX = ((data[DS4_RIGHT_X_OFFSET + offset] ?? PS_ANALOG_CENTER) - PS_ANALOG_CENTER) / PS_ANALOG_RANGE;
    const rightY = ((data[DS4_RIGHT_Y_OFFSET + offset] ?? PS_ANALOG_CENTER) - PS_ANALOG_CENTER) / PS_ANALOG_RANGE;

    return { leftX, leftY, rightX, rightY };
  },
};

/**
 * PlayStation DualSense profile
 *
 * Button mapping by physical position (PlayStation → SNES layout):
 * - Cross (bottom) → StandardButton.B
 * - Circle (right) → StandardButton.A
 * - Square (left) → StandardButton.Y
 * - Triangle (top) → StandardButton.X
 */
const dualSenseProfile: GamepadProfile = {
  name: 'PlayStation DualSense',
  vendorIds: [VENDOR_SONY],
  productIds: [
    PRODUCT_DUALSENSE,
    PRODUCT_DUALSENSE_EDGE,
  ],
  parseReport: (data: Buffer): Map<StandardButton, boolean> => {
    const buttons = new Map<StandardButton, boolean>();

    if (data.length < PS_MIN_REPORT_LENGTH) {
      return buttons;
    }

    // DualSense USB HID format is similar to DS4
    // Byte 0: Report ID (0x01)
    // Byte 1: Left stick X
    // Byte 2: Left stick Y
    // Byte 3: Right stick X
    // Byte 4: Right stick Y
    // Byte 5: Triggers (L2)
    // Byte 6: Triggers (R2)
    // Byte 7: Hat switch + face buttons
    // Byte 8+: Shoulders and menu buttons

    const offset = data[0] === PS_REPORT_ID ? 0 : -1;

    const leftX = data[DUALSENSE_LEFT_X_OFFSET + offset] ?? PS_ANALOG_CENTER;
    const leftY = data[DUALSENSE_LEFT_Y_OFFSET + offset] ?? PS_ANALOG_CENTER;
    const hatAndButtons = data[DUALSENSE_HAT_AND_BUTTONS_OFFSET + offset] ?? 0;
    const btnByte1 = data[DUALSENSE_SHOULDERS_OFFSET + offset] ?? 0;

    // Hat switch (lower 4 bits)
    const hat = hatAndButtons & DPAD_HAT_MASK;
    const dpad = hatToDpad(hat);
    const stickDpad = analogToDpad(leftX, leftY);

    buttons.set(StandardButton.Up, dpad.up || stickDpad.up);
    buttons.set(StandardButton.Down, dpad.down || stickDpad.down);
    buttons.set(StandardButton.Left, dpad.left || stickDpad.left);
    buttons.set(StandardButton.Right, dpad.right || stickDpad.right);

    // Face buttons mapped by physical position (PlayStation → SNES)
    // Cross (bottom, 0x20) → SNES B (bottom)
    buttons.set(StandardButton.B, (hatAndButtons & DS4_MASK_CROSS) !== 0);
    // Circle (right, 0x40) → SNES A (right)
    buttons.set(StandardButton.A, (hatAndButtons & DS4_MASK_CIRCLE) !== 0);
    // Square (left, 0x10) → SNES Y (left)
    buttons.set(StandardButton.Y, (hatAndButtons & DS4_MASK_SQUARE) !== 0);
    // Triangle (top, 0x80) → SNES X (top)
    buttons.set(StandardButton.X, (hatAndButtons & DS4_MASK_TRIANGLE) !== 0);

    // Shoulder buttons
    buttons.set(StandardButton.L, (btnByte1 & SHOULDER_MASK_L) !== 0);  // L1
    buttons.set(StandardButton.R, (btnByte1 & SHOULDER_MASK_R) !== 0);  // R1
    buttons.set(StandardButton.L2, (btnByte1 & SHOULDER_MASK_L2) !== 0); // L2
    buttons.set(StandardButton.R2, (btnByte1 & SHOULDER_MASK_R2) !== 0); // R2

    // Create = Select, Options = Start
    buttons.set(StandardButton.Select, (btnByte1 & GENERIC_FALLBACK_MASK_UP) !== 0);
    buttons.set(StandardButton.Start, (btnByte1 & GENERIC_FALLBACK_MASK_DOWN) !== 0);

    // PS button (byte 9, bit 0x01)
    if (data.length >= DUALSENSE_PS_BUTTON_MIN_LENGTH) {
      const btnByte2 = data[DUALSENSE_PS_BUTTON_OFFSET + offset] ?? 0;
      buttons.set(StandardButton.Guide, (btnByte2 & DUALSENSE_PS_BUTTON_MASK) !== 0);
    }

    return buttons;
  },
  parseAnalog: (data: Buffer): AnalogState | null => {
    if (data.length < PS_MIN_REPORT_LENGTH) {
      return null;
    }

    const offset = data[0] === PS_REPORT_ID ? 0 : -1;

    // DualSense sticks are unsigned 8-bit (0-255, center at 128)
    const leftX = ((data[DUALSENSE_LEFT_X_OFFSET + offset] ?? PS_ANALOG_CENTER) - PS_ANALOG_CENTER) / PS_ANALOG_RANGE;
    const leftY = ((data[DUALSENSE_LEFT_Y_OFFSET + offset] ?? PS_ANALOG_CENTER) - PS_ANALOG_CENTER) / PS_ANALOG_RANGE;
    const rightX = ((data[DUALSENSE_RIGHT_X_OFFSET + offset] ?? PS_ANALOG_CENTER) - PS_ANALOG_CENTER) / PS_ANALOG_RANGE;
    const rightY = ((data[DUALSENSE_RIGHT_Y_OFFSET + offset] ?? PS_ANALOG_CENTER) - PS_ANALOG_CENTER) / PS_ANALOG_RANGE;

    return { leftX, leftY, rightX, rightY };
  },
};

/**
 * Nintendo Switch Pro Controller profile
 *
 * Nintendo uses the same physical button layout as SNES:
 * - B (bottom) → StandardButton.B
 * - A (right) → StandardButton.A
 * - Y (left) → StandardButton.Y
 * - X (top) → StandardButton.X
 */
const switchProProfile: GamepadProfile = {
  name: 'Nintendo Switch Pro Controller',
  vendorIds: [VENDOR_NINTENDO],
  productIds: [
    PRODUCT_SWITCH_PRO,
    PRODUCT_SNES_CONTROLLER,
    PRODUCT_N64_CONTROLLER,
    PRODUCT_GENESIS_CONTROLLER,
  ],
  parseReport: (data: Buffer): Map<StandardButton, boolean> => {
    const buttons = new Map<StandardButton, boolean>();

    if (data.length < SWITCH_PRO_MIN_REPORT_LENGTH) {
      return buttons;
    }

    // Switch Pro Controller USB HID format
    // Various report formats depending on mode
    // Standard HID mode uses different format than Switch mode

    const btnByte1 = data[SWITCH_PRO_BUTTONS_BYTE_1];
    const btnByte2 = data[SWITCH_PRO_BUTTONS_BYTE_2];
    const btnByte3 = data[SWITCH_PRO_BUTTONS_BYTE_3];

    // D-pad from byte 3 (hat-style in standard HID)
    const hat = btnByte3 & DPAD_HAT_MASK;
    const dpad = hatToDpad(hat);

    buttons.set(StandardButton.Up, dpad.up);
    buttons.set(StandardButton.Down, dpad.down);
    buttons.set(StandardButton.Left, dpad.left);
    buttons.set(StandardButton.Right, dpad.right);

    // Face buttons - Nintendo layout matches SNES directly
    // B (bottom, 0x01) → SNES B (bottom)
    buttons.set(StandardButton.B, (btnByte1 & SWITCH_PRO_MASK_B) !== 0);
    // A (right, 0x04) → SNES A (right)
    buttons.set(StandardButton.A, (btnByte1 & SWITCH_PRO_MASK_A) !== 0);
    // Y (left, 0x02) → SNES Y (left)
    buttons.set(StandardButton.Y, (btnByte1 & SWITCH_PRO_MASK_Y) !== 0);
    // X (top, 0x08) → SNES X (top)
    buttons.set(StandardButton.X, (btnByte1 & SWITCH_PRO_MASK_X) !== 0);

    // Shoulder buttons
    buttons.set(StandardButton.L, (btnByte1 & SWITCH_PRO_MASK_L) !== 0);  // L
    buttons.set(StandardButton.R, (btnByte1 & SWITCH_PRO_MASK_R) !== 0);  // R
    buttons.set(StandardButton.L2, (btnByte1 & SWITCH_PRO_MASK_ZL) !== 0); // ZL
    buttons.set(StandardButton.R2, (btnByte1 & SWITCH_PRO_MASK_ZR) !== 0); // ZR

    // +/- buttons
    buttons.set(StandardButton.Start, (btnByte2 & SWITCH_PRO_MASK_PLUS) !== 0);  // +
    buttons.set(StandardButton.Select, (btnByte2 & SWITCH_PRO_MASK_MINUS) !== 0); // -

    // Home button (byte 2, bit 0x10)
    buttons.set(StandardButton.Guide, (btnByte2 & SWITCH_PRO_MASK_HOME) !== 0);

    return buttons;
  },
};

/**
 * 8BitDo controller profile (various retro-style controllers)
 *
 * 8BitDo controllers typically use SNES-style layout
 */
const eightBitDoProfile: GamepadProfile = {
  name: '8BitDo Controller',
  vendorIds: [
    VENDOR_8BITDO,
    VENDOR_MICROSOFT, // 8BitDo in Xbox mode reports as Microsoft
  ],
  productIds: [
    PRODUCT_8BITDO_SN30,
    PRODUCT_8BITDO_SN30_PRO,
    PRODUCT_8BITDO_SN30_PRO_PLUS,
    PRODUCT_8BITDO_PRO_2,
    PRODUCT_8BITDO_ULTIMATE,
    PRODUCT_8BITDO_SF30,
    PRODUCT_8BITDO_SF30_PRO,
  ],
  parseReport: (data: Buffer): Map<StandardButton, boolean> => {
    const buttons = new Map<StandardButton, boolean>();

    if (data.length < EIGHTBITDO_MIN_REPORT_LENGTH) {
      return buttons;
    }

    // 8BitDo controllers in D-input mode
    // Format varies by model, this handles common format
    const leftX = data[EIGHTBITDO_LEFT_X_OFFSET];
    const leftY = data[EIGHTBITDO_LEFT_Y_OFFSET];
    const btnByte1 = data[EIGHTBITDO_BUTTONS_BYTE_1];
    const btnByte2 = data[EIGHTBITDO_BUTTONS_BYTE_2];

    // D-pad from hat or analog stick
    const stickDpad = analogToDpad(leftX, leftY);
    buttons.set(StandardButton.Up, stickDpad.up || (btnByte1 & EIGHTBITDO_MASK_DPAD_UP) !== 0);
    buttons.set(StandardButton.Down, stickDpad.down || (btnByte1 & EIGHTBITDO_MASK_DPAD_DOWN) !== 0);
    buttons.set(StandardButton.Left, stickDpad.left || (btnByte1 & EIGHTBITDO_MASK_DPAD_LEFT) !== 0);
    buttons.set(StandardButton.Right, stickDpad.right || (btnByte1 & EIGHTBITDO_MASK_DPAD_RIGHT) !== 0);

    // Face buttons - 8BitDo uses SNES layout
    // B (bottom, 0x01) → StandardButton.B
    buttons.set(StandardButton.B, (btnByte2 & EIGHTBITDO_MASK_B) !== 0);
    // A (right, 0x02) → StandardButton.A
    buttons.set(StandardButton.A, (btnByte2 & EIGHTBITDO_MASK_A) !== 0);
    // Y (left, 0x04) → StandardButton.Y
    buttons.set(StandardButton.Y, (btnByte2 & EIGHTBITDO_MASK_Y) !== 0);
    // X (top, 0x08) → StandardButton.X
    buttons.set(StandardButton.X, (btnByte2 & EIGHTBITDO_MASK_X) !== 0);

    // Shoulder buttons
    buttons.set(StandardButton.L, (btnByte1 & EIGHTBITDO_MASK_L) !== 0);
    buttons.set(StandardButton.R, (btnByte1 & EIGHTBITDO_MASK_R) !== 0);

    // Start/Select
    buttons.set(StandardButton.Start, (btnByte2 & EIGHTBITDO_MASK_START) !== 0);
    buttons.set(StandardButton.Select, (btnByte2 & EIGHTBITDO_MASK_SELECT) !== 0);

    return buttons;
  },
};

/**
 * Generic USB Gamepad profile
 * Fallback for unknown controllers - tries common HID formats
 * Uses physical position mapping (Xbox-style: bottom=B, right=A, left=Y, top=X)
 */
const genericGamepadProfile: GamepadProfile = {
  name: 'Generic Gamepad',
  vendorIds: [], // Match any vendor
  productIds: [], // Match any product
  parseReport: (data: Buffer): Map<StandardButton, boolean> => {
    const buttons = new Map<StandardButton, boolean>();

    if (data.length < GENERIC_MIN_REPORT_LENGTH) {
      return buttons;
    }

    // Format A: Xbox-style wired controller (19 bytes starting with 0x20)
    // Byte 4: Start=0x04, Select=0x08, A=0x10, B=0x20, X=0x40, Y=0x80
    // Byte 5: D-pad - Up=0x01, Down=0x02, Left=0x04, Right=0x08
    // Byte 6: LB=0x01, RB=0x02
    if (data.length >= XBOX_WIRED_REPORT_LENGTH && data[0] === XBOX_WIRED_REPORT_TYPE) {
      const buttonsAndMenu = data[XBOX_WIRED_BUTTONS_BYTE];
      const dpad = data[XBOX_WIRED_DPAD_BYTE];
      const shoulders = data[XBOX_WIRED_SHOULDERS_BYTE];

      // D-pad
      buttons.set(StandardButton.Up, (dpad & DPAD_MASK_UP) !== 0);
      buttons.set(StandardButton.Down, (dpad & DPAD_MASK_DOWN) !== 0);
      buttons.set(StandardButton.Left, (dpad & DPAD_MASK_LEFT) !== 0);
      buttons.set(StandardButton.Right, (dpad & DPAD_MASK_RIGHT) !== 0);

      // Face buttons mapped by physical position (Xbox → SNES)
      buttons.set(StandardButton.B, (buttonsAndMenu & XBOX_WIRED_MASK_A) !== 0);  // A (bottom)
      buttons.set(StandardButton.A, (buttonsAndMenu & XBOX_WIRED_MASK_B) !== 0);  // B (right)
      buttons.set(StandardButton.Y, (buttonsAndMenu & XBOX_WIRED_MASK_X) !== 0);  // X (left)
      buttons.set(StandardButton.X, (buttonsAndMenu & XBOX_WIRED_MASK_Y) !== 0);  // Y (top)

      // Shoulder buttons
      buttons.set(StandardButton.L, (shoulders & SHOULDER_MASK_L) !== 0);
      buttons.set(StandardButton.R, (shoulders & SHOULDER_MASK_R) !== 0);

      // Menu buttons
      buttons.set(StandardButton.Start, (buttonsAndMenu & XBOX_WIRED_MASK_START) !== 0);
      buttons.set(StandardButton.Select, (buttonsAndMenu & XBOX_WIRED_MASK_SELECT) !== 0);

      // Also check left analog stick for d-pad (bytes 10-13 are signed 16-bit LE)
      if (data.length >= XBOX_WIRED_LEFT_STICK_Y_OFFSET + 2) {
        applySignedAnalogToDpad(buttons, readInt16LE(data, XBOX_WIRED_LEFT_STICK_X_OFFSET), readInt16LE(data, XBOX_WIRED_LEFT_STICK_Y_OFFSET));
      }

      return buttons;
    }

    // Try to detect common generic gamepad formats
    // Most cheap USB gamepads follow similar patterns

    // Format 1: Analog sticks in first 4 bytes, buttons after
    if (data.length >= GENERIC_FORMAT_A_MIN_LENGTH) {
      const leftX = data[GENERIC_ANALOG_OFFSET_X];
      const leftY = data[GENERIC_ANALOG_OFFSET_Y];

      const stickDpad = analogToDpad(leftX, leftY);

      // Many generic gamepads also have hat switch in a button byte
      const possibleHat = data[GENERIC_HAT_BYTE];
      const hatDpad = possibleHat <= GENERIC_MAX_HAT_VALUE ? hatToDpad(possibleHat) : { up: false, down: false, left: false, right: false };

      buttons.set(StandardButton.Up, stickDpad.up || hatDpad.up);
      buttons.set(StandardButton.Down, stickDpad.down || hatDpad.down);
      buttons.set(StandardButton.Left, stickDpad.left || hatDpad.left);
      buttons.set(StandardButton.Right, stickDpad.right || hatDpad.right);

      // Buttons typically in bytes 5-6 for this format
      const btnByte1 = data[GENERIC_BUTTONS_BYTE_1];
      const btnByte2 = data[GENERIC_BUTTONS_BYTE_2];

      // Face buttons - output individually
      buttons.set(StandardButton.B, (btnByte1 & GENERIC_MASK_BUTTON_1) !== 0);  // Button 1 (bottom)
      buttons.set(StandardButton.A, (btnByte1 & GENERIC_MASK_BUTTON_2) !== 0);  // Button 2 (right)
      buttons.set(StandardButton.Y, (btnByte1 & GENERIC_MASK_BUTTON_3) !== 0);  // Button 3 (left)
      buttons.set(StandardButton.X, (btnByte1 & GENERIC_MASK_BUTTON_4) !== 0);  // Button 4 (top)
      buttons.set(StandardButton.L, (btnByte1 & GENERIC_MASK_BUTTON_L) !== 0);  // L shoulder
      buttons.set(StandardButton.R, (btnByte1 & GENERIC_MASK_BUTTON_R) !== 0);  // R shoulder
      buttons.set(StandardButton.Select, (btnByte1 & GENERIC_MASK_BUTTON_SELECT) !== 0 || (btnByte2 & GENERIC_MASK_BUTTON_1) !== 0);
      buttons.set(StandardButton.Start, (btnByte1 & GENERIC_MASK_BUTTON_START) !== 0 || (btnByte2 & GENERIC_MASK_BUTTON_2) !== 0);
    } else {
      // Format 2: Very simple - everything in 1-2 bytes
      const btnByte = data[0];

      buttons.set(StandardButton.B, (btnByte & GENERIC_MASK_BUTTON_1) !== 0);  // Button 1
      buttons.set(StandardButton.A, (btnByte & GENERIC_MASK_BUTTON_2) !== 0);  // Button 2
      buttons.set(StandardButton.Select, (btnByte & GENERIC_FALLBACK_MASK_SELECT) !== 0);
      buttons.set(StandardButton.Start, (btnByte & GENERIC_FALLBACK_MASK_START) !== 0);
      buttons.set(StandardButton.Up, (btnByte & GENERIC_FALLBACK_MASK_UP) !== 0);
      buttons.set(StandardButton.Down, (btnByte & GENERIC_FALLBACK_MASK_DOWN) !== 0);
      buttons.set(StandardButton.Left, (btnByte & GENERIC_FALLBACK_MASK_LEFT) !== 0);
      buttons.set(StandardButton.Right, (btnByte & GENERIC_FALLBACK_MASK_RIGHT) !== 0);
    }

    return buttons;
  },
};

/**
 * All known gamepad profiles, ordered by specificity
 * More specific profiles should come first
 */
export const gamepadProfiles: GamepadProfile[] = [
  xboxWiredProfile,
  xboxOneProfile,
  xbox360Profile,
  dualShock4Profile,
  dualSenseProfile,
  switchProProfile,
  eightBitDoProfile,
  genericGamepadProfile, // Fallback - must be last
];

/**
 * Find the best matching profile for a device
 */
export const findProfile = (vendorId: number, productId: number): GamepadProfile => {
  // First try to find exact vendor + product match
  for (const profile of gamepadProfiles) {
    if (profile.vendorIds.length === 0) {continue;} // Skip generic fallback
    if (!profile.vendorIds.includes(vendorId)) {continue;}
    if (profile.productIds.length > 0 && profile.productIds.includes(productId)) {
      return profile;
    }
  }

  // Then try vendor-only match
  for (const profile of gamepadProfiles) {
    if (profile.vendorIds.length === 0) {continue;}
    if (profile.vendorIds.includes(vendorId) && profile.productIds.length === 0) {
      return profile;
    }
  }

  // Fall back to generic profile
  return genericGamepadProfile;
};

/**
 * Check if a device looks like a gamepad based on HID usage
 */
export const isGamepadDevice = (device: {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
  product?: string;
}): boolean => {
  // HID usage page 0x01 = Generic Desktop Controls
  // Usage 0x04 = Joystick, 0x05 = Gamepad
  if (device.usagePage === HID_USAGE_PAGE_GENERIC_DESKTOP && (device.usage === HID_USAGE_JOYSTICK || device.usage === HID_USAGE_GAMEPAD)) {
    return true;
  }

  // Check for known gaming vendor IDs
  const gamingVendors = [
    VENDOR_MICROSOFT,
    VENDOR_SONY,
    VENDOR_NINTENDO,
    VENDOR_8BITDO,
    VENDOR_PDP,
    VENDOR_HORI,
    VENDOR_RAZER,
    VENDOR_POWERA,
    VENDOR_VALVE,
    VENDOR_LOGITECH,
    VENDOR_DRAGONRISE,
    VENDOR_GENERIC_0810,
    VENDOR_HONEYBEE,
    VENDOR_GENERIC_1A34,
    VENDOR_POWERA_BDA,
  ];

  if (device.vendorId && gamingVendors.includes(device.vendorId)) {
    return true;
  }

  // Check product name for gamepad-related keywords
  const productName = device.product?.toLowerCase() ?? '';
  const gamepadKeywords = [
    'gamepad',
    'controller',
    'joystick',
    'xbox',
    'playstation',
    'dualshock',
    'dualsense',
    'joycon',
    'switch',
    'pro controller',
  ];

  return gamepadKeywords.some((keyword) => productName.includes(keyword));
};
