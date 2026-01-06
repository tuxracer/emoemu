import { Button } from './controller.js';

/**
 * Gamepad button mapping profile
 * Maps raw HID report data to NES controller buttons
 */
export interface GamepadProfile {
  name: string;
  /** Vendor IDs this profile matches */
  vendorIds: number[];
  /** Product IDs this profile matches (empty = match any for this vendor) */
  productIds: number[];
  /** Parse HID report and return button states */
  parseReport: (data: Buffer) => Map<Button, boolean>;
}

/**
 * D-pad direction from analog stick or hat switch value
 */
interface DpadState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/**
 * Convert analog stick values to digital d-pad state
 * Most controllers use 0-255 range with 128 as center
 */
function analogToDpad(
  x: number,
  y: number,
  deadzone: number = 50,
  center: number = 128
): DpadState {
  return {
    left: x < center - deadzone,
    right: x > center + deadzone,
    up: y < center - deadzone,
    down: y > center + deadzone,
  };
}

/**
 * Parse 8-direction hat switch value to d-pad state
 * Standard HID hat values: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW, 8/15=center
 */
function hatToDpad(hat: number): DpadState {
  const hatMap: Record<number, DpadState> = {
    0: { up: true, down: false, left: false, right: false },   // N
    1: { up: true, down: false, left: false, right: true },    // NE
    2: { up: false, down: false, left: false, right: true },   // E
    3: { up: false, down: true, left: false, right: true },    // SE
    4: { up: false, down: true, left: false, right: false },   // S
    5: { up: false, down: true, left: true, right: false },    // SW
    6: { up: false, down: false, left: true, right: false },   // W
    7: { up: true, down: false, left: true, right: false },    // NW
  };
  return hatMap[hat] ?? { up: false, down: false, left: false, right: false };
}

/**
 * Parse Xbox-style hat switch value to d-pad state
 * Xbox uses 1-indexed values: 0=none, 1=N, 2=NE, 3=E, 4=SE, 5=S, 6=SW, 7=W, 8=NW
 */
function xboxHatToDpad(hat: number): DpadState {
  const hatMap: Record<number, DpadState> = {
    0: { up: false, down: false, left: false, right: false }, // None
    1: { up: true, down: false, left: false, right: false },  // N
    2: { up: true, down: false, left: false, right: true },   // NE
    3: { up: false, down: false, left: false, right: true },  // E
    4: { up: false, down: true, left: false, right: true },   // SE
    5: { up: false, down: true, left: false, right: false },  // S
    6: { up: false, down: true, left: true, right: false },   // SW
    7: { up: false, down: false, left: true, right: false },  // W
    8: { up: true, down: false, left: true, right: false },   // NW
  };
  return hatMap[hat] ?? { up: false, down: false, left: false, right: false };
}

/**
 * Xbox One / Series controller profile
 * Works on macOS, Windows, and Linux via Bluetooth or USB
 */
const xboxOneProfile: GamepadProfile = {
  name: 'Xbox One/Series Controller',
  vendorIds: [
    0x045e, // Microsoft
    0x0e6f, // PDP
    0x0f0d, // Hori
    0x1532, // Razer
    0x24c6, // PowerA
  ],
  productIds: [
    // Microsoft Xbox One/Series controllers
    0x02d1, // Xbox One Controller
    0x02dd, // Xbox One Controller (Firmware 2015)
    0x02e3, // Xbox One Elite Controller
    0x02ea, // Xbox One S Controller
    0x02fd, // Xbox One S Controller (Bluetooth)
    0x0b00, // Xbox One Elite Series 2
    0x0b05, // Xbox One Elite Series 2 (Bluetooth)
    0x0b12, // Xbox Series X|S Controller
    0x0b13, // Xbox Series X|S Controller (Bluetooth)
    0x0b20, // Xbox Adaptive Controller
    0x0b21, // Xbox Adaptive Controller (Bluetooth)
    0x0b22, // Xbox Elite Series 2 v2
  ],
  parseReport: (data: Buffer): Map<Button, boolean> => {
    const buttons = new Map<Button, boolean>();

    // Xbox Series X|S Bluetooth format (17 bytes):
    // Byte 0: Report ID (0x01)
    // Bytes 1-2: Left stick X (16-bit LE)
    // Bytes 3-4: Left stick Y (16-bit LE)
    // Bytes 5-6: Right stick X (16-bit LE)
    // Bytes 7-8: Right stick Y (16-bit LE)
    // Bytes 9-10: Left trigger (16-bit)
    // Bytes 11-12: Right trigger (16-bit)
    // Byte 13: D-pad hat (0=none, 1=N, 2=NE, 3=E, 4=SE, 5=S, 6=SW, 7=W, 8=NW)
    // Byte 14: Face buttons (A=0x01, B=0x02, X=0x04, Y=0x08)
    // Byte 15: Menu buttons (LB=0x01, RB=0x02, View=0x04, Menu=0x08, LSB=0x10, RSB=0x20)
    // Byte 16: Xbox button, etc.

    if (data.length >= 17 && data[0] === 0x01) {
      // D-pad from hat switch (byte 13)
      const hat = data[13];
      const dpad = xboxHatToDpad(hat);

      // Also support left stick as d-pad (bytes 1-4 are 16-bit LE values)
      const leftX = data[1] | (data[2] << 8); // 16-bit LE, center ~32768
      const leftY = data[3] | (data[4] << 8);
      const stickDpad = {
        left: leftX < 20000,
        right: leftX > 45000,
        up: leftY < 20000,
        down: leftY > 45000,
      };

      buttons.set(Button.Up, dpad.up || stickDpad.up);
      buttons.set(Button.Down, dpad.down || stickDpad.down);
      buttons.set(Button.Left, dpad.left || stickDpad.left);
      buttons.set(Button.Right, dpad.right || stickDpad.right);

      // Face buttons (byte 14): A=0x01, B=0x02, X=0x04, Y=0x08
      const faceButtons = data[14];
      // Map: A/Y -> NES A, B/X -> NES B
      buttons.set(Button.A, (faceButtons & 0x01) !== 0 || (faceButtons & 0x08) !== 0);
      buttons.set(Button.B, (faceButtons & 0x02) !== 0 || (faceButtons & 0x04) !== 0);

      // Menu buttons (byte 15): View=0x04, Menu=0x08
      const menuButtons = data[15];
      buttons.set(Button.Select, (menuButtons & 0x04) !== 0); // View button
      buttons.set(Button.Start, (menuButtons & 0x08) !== 0);  // Menu button

      return buttons;
    }

    // Fallback for other Xbox controller formats or shorter reports
    if (data.length >= 8) {
      // Try generic format
      const btnByte = data[0];
      buttons.set(Button.A, (btnByte & 0x01) !== 0);
      buttons.set(Button.B, (btnByte & 0x02) !== 0);
      buttons.set(Button.Select, (btnByte & 0x04) !== 0);
      buttons.set(Button.Start, (btnByte & 0x08) !== 0);
      buttons.set(Button.Up, (btnByte & 0x10) !== 0);
      buttons.set(Button.Down, (btnByte & 0x20) !== 0);
      buttons.set(Button.Left, (btnByte & 0x40) !== 0);
      buttons.set(Button.Right, (btnByte & 0x80) !== 0);
    }

    return buttons;
  },
};

/**
 * Xbox 360 controller profile
 */
const xbox360Profile: GamepadProfile = {
  name: 'Xbox 360 Controller',
  vendorIds: [0x045e], // Microsoft
  productIds: [
    0x028e, // Xbox 360 Controller
    0x028f, // Xbox 360 Wireless Controller
    0x0291, // Xbox 360 Wireless Receiver
    0x02a1, // Xbox 360 Wireless Controller
    0x0719, // Xbox 360 Wireless Receiver
  ],
  parseReport: (data: Buffer): Map<Button, boolean> => {
    const buttons = new Map<Button, boolean>();

    if (data.length < 3) {
      return buttons;
    }

    // Xbox 360 HID format
    // Byte 2: D-pad and face buttons
    // Byte 3: More buttons
    const btnByte1 = data[2] ?? 0;
    const btnByte2 = data[3] ?? 0;

    // D-pad
    buttons.set(Button.Up, (btnByte1 & 0x01) !== 0);
    buttons.set(Button.Down, (btnByte1 & 0x02) !== 0);
    buttons.set(Button.Left, (btnByte1 & 0x04) !== 0);
    buttons.set(Button.Right, (btnByte1 & 0x08) !== 0);

    // Start/Back (Select)
    buttons.set(Button.Start, (btnByte1 & 0x10) !== 0);
    buttons.set(Button.Select, (btnByte1 & 0x20) !== 0);

    // A, B, X, Y
    buttons.set(Button.A, (btnByte2 & 0x10) !== 0 || (btnByte2 & 0x80) !== 0); // A or Y
    buttons.set(Button.B, (btnByte2 & 0x20) !== 0 || (btnByte2 & 0x40) !== 0); // B or X

    return buttons;
  },
};

/**
 * PlayStation DualShock 4 profile
 */
const dualShock4Profile: GamepadProfile = {
  name: 'PlayStation DualShock 4',
  vendorIds: [0x054c], // Sony
  productIds: [
    0x05c4, // DualShock 4 v1
    0x09cc, // DualShock 4 v2
    0x0ba0, // DualShock 4 USB Wireless Adapter
  ],
  parseReport: (data: Buffer): Map<Button, boolean> => {
    const buttons = new Map<Button, boolean>();

    if (data.length < 8) {
      return buttons;
    }

    // DS4 HID report format (USB):
    // Byte 0: Report ID (0x01)
    // Byte 1: Left stick X
    // Byte 2: Left stick Y
    // Byte 3: Right stick X
    // Byte 4: Right stick Y
    // Byte 5: Hat switch (lower 4 bits) + buttons
    // Byte 6-7: More buttons

    const offset = data[0] === 0x01 ? 0 : -1; // Adjust for report ID

    const leftX = data[1 + offset] ?? 128;
    const leftY = data[2 + offset] ?? 128;
    const hatAndButtons = data[5 + offset] ?? 0;
    const btnByte1 = data[6 + offset] ?? 0;

    // Hat switch for d-pad (lower 4 bits)
    const hat = hatAndButtons & 0x0f;
    const dpad = hatToDpad(hat);

    // Also check left stick
    const stickDpad = analogToDpad(leftX, leftY);

    buttons.set(Button.Up, dpad.up || stickDpad.up);
    buttons.set(Button.Down, dpad.down || stickDpad.down);
    buttons.set(Button.Left, dpad.left || stickDpad.left);
    buttons.set(Button.Right, dpad.right || stickDpad.right);

    // Face buttons: Cross=A, Circle=B, Square=B alt, Triangle=A alt
    const cross = (hatAndButtons & 0x20) !== 0;
    const circle = (hatAndButtons & 0x40) !== 0;
    const square = (hatAndButtons & 0x10) !== 0;
    const triangle = (hatAndButtons & 0x80) !== 0;

    buttons.set(Button.A, cross || triangle);
    buttons.set(Button.B, circle || square);

    // Share = Select, Options = Start
    buttons.set(Button.Select, (btnByte1 & 0x10) !== 0);
    buttons.set(Button.Start, (btnByte1 & 0x20) !== 0);

    return buttons;
  },
};

/**
 * PlayStation DualSense profile
 */
const dualSenseProfile: GamepadProfile = {
  name: 'PlayStation DualSense',
  vendorIds: [0x054c], // Sony
  productIds: [
    0x0ce6, // DualSense
    0x0df2, // DualSense Edge
  ],
  parseReport: (data: Buffer): Map<Button, boolean> => {
    const buttons = new Map<Button, boolean>();

    if (data.length < 8) {
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
    // Byte 7: Hat switch + buttons
    // Byte 8+: More buttons

    const offset = data[0] === 0x01 ? 0 : -1;

    const leftX = data[1 + offset] ?? 128;
    const leftY = data[2 + offset] ?? 128;
    const hatAndButtons = data[7 + offset] ?? 0;
    const btnByte1 = data[8 + offset] ?? 0;

    // Hat switch (lower 4 bits)
    const hat = hatAndButtons & 0x0f;
    const dpad = hatToDpad(hat);
    const stickDpad = analogToDpad(leftX, leftY);

    buttons.set(Button.Up, dpad.up || stickDpad.up);
    buttons.set(Button.Down, dpad.down || stickDpad.down);
    buttons.set(Button.Left, dpad.left || stickDpad.left);
    buttons.set(Button.Right, dpad.right || stickDpad.right);

    // Face buttons
    const cross = (hatAndButtons & 0x20) !== 0;
    const circle = (hatAndButtons & 0x40) !== 0;
    const square = (hatAndButtons & 0x10) !== 0;
    const triangle = (hatAndButtons & 0x80) !== 0;

    buttons.set(Button.A, cross || triangle);
    buttons.set(Button.B, circle || square);

    // Create = Select, Options = Start
    buttons.set(Button.Select, (btnByte1 & 0x10) !== 0);
    buttons.set(Button.Start, (btnByte1 & 0x20) !== 0);

    return buttons;
  },
};

/**
 * Nintendo Switch Pro Controller profile
 */
const switchProProfile: GamepadProfile = {
  name: 'Nintendo Switch Pro Controller',
  vendorIds: [0x057e], // Nintendo
  productIds: [
    0x2009, // Switch Pro Controller
    0x2017, // SNES Controller
    0x2019, // N64 Controller
    0x201e, // Sega Genesis Controller
  ],
  parseReport: (data: Buffer): Map<Button, boolean> => {
    const buttons = new Map<Button, boolean>();

    if (data.length < 4) {
      return buttons;
    }

    // Switch Pro Controller USB HID format
    // Various report formats depending on mode
    // Standard HID mode uses different format than Switch mode

    const btnByte1 = data[1] ?? 0;
    const btnByte2 = data[2] ?? 0;
    const btnByte3 = data[3] ?? 0;

    // D-pad from byte 3 (hat-style in standard HID)
    const hat = btnByte3 & 0x0f;
    const dpad = hatToDpad(hat);

    buttons.set(Button.Up, dpad.up);
    buttons.set(Button.Down, dpad.down);
    buttons.set(Button.Left, dpad.left);
    buttons.set(Button.Right, dpad.right);

    // Face buttons: A=NES A, B=NES B (Switch layout: right=A, bottom=B)
    buttons.set(Button.A, (btnByte1 & 0x04) !== 0 || (btnByte1 & 0x08) !== 0); // A or X
    buttons.set(Button.B, (btnByte1 & 0x01) !== 0 || (btnByte1 & 0x02) !== 0); // B or Y

    // +/- buttons
    buttons.set(Button.Start, (btnByte2 & 0x02) !== 0);  // +
    buttons.set(Button.Select, (btnByte2 & 0x01) !== 0); // -

    return buttons;
  },
};

/**
 * 8BitDo controller profile (various retro-style controllers)
 */
const eightBitDoProfile: GamepadProfile = {
  name: '8BitDo Controller',
  vendorIds: [
    0x2dc8, // 8BitDo
    0x045e, // 8BitDo in Xbox mode reports as Microsoft
  ],
  productIds: [
    0x2100, // 8BitDo SN30
    0x2101, // 8BitDo SN30 Pro
    0x2109, // 8BitDo SN30 Pro+
    0x3010, // 8BitDo Pro 2
    0x3106, // 8BitDo Ultimate
    0x6001, // 8BitDo SF30
    0x6100, // 8BitDo SF30 Pro
  ],
  parseReport: (data: Buffer): Map<Button, boolean> => {
    const buttons = new Map<Button, boolean>();

    if (data.length < 6) {
      return buttons;
    }

    // 8BitDo controllers in D-input mode
    // Format varies by model, this handles common format
    const leftX = data[0] ?? 128;
    const leftY = data[1] ?? 128;
    const btnByte1 = data[4] ?? 0;
    const btnByte2 = data[5] ?? 0;

    // D-pad from hat or analog stick
    const stickDpad = analogToDpad(leftX, leftY);
    buttons.set(Button.Up, stickDpad.up || (btnByte1 & 0x01) !== 0);
    buttons.set(Button.Down, stickDpad.down || (btnByte1 & 0x02) !== 0);
    buttons.set(Button.Left, stickDpad.left || (btnByte1 & 0x04) !== 0);
    buttons.set(Button.Right, stickDpad.right || (btnByte1 & 0x08) !== 0);

    // Face buttons
    buttons.set(Button.A, (btnByte2 & 0x02) !== 0 || (btnByte2 & 0x08) !== 0);
    buttons.set(Button.B, (btnByte2 & 0x01) !== 0 || (btnByte2 & 0x04) !== 0);

    // Start/Select
    buttons.set(Button.Start, (btnByte2 & 0x20) !== 0);
    buttons.set(Button.Select, (btnByte2 & 0x10) !== 0);

    return buttons;
  },
};

/**
 * Generic USB Gamepad profile
 * Fallback for unknown controllers - tries common HID formats
 */
const genericGamepadProfile: GamepadProfile = {
  name: 'Generic Gamepad',
  vendorIds: [], // Match any vendor
  productIds: [], // Match any product
  parseReport: (data: Buffer): Map<Button, boolean> => {
    const buttons = new Map<Button, boolean>();

    if (data.length < 2) {
      return buttons;
    }

    // Try to detect common generic gamepad formats
    // Most cheap USB gamepads follow similar patterns

    // Format 1: Analog sticks in first 4 bytes, buttons after
    if (data.length >= 6) {
      const leftX = data[0];
      const leftY = data[1];

      // Check if these look like analog values (usually 0-255)
      if (leftX !== undefined && leftY !== undefined) {
        const stickDpad = analogToDpad(leftX, leftY);

        // Many generic gamepads also have hat switch in a button byte
        const possibleHat = data[4] ?? 8;
        const hatDpad = possibleHat <= 8 ? hatToDpad(possibleHat) : { up: false, down: false, left: false, right: false };

        buttons.set(Button.Up, stickDpad.up || hatDpad.up);
        buttons.set(Button.Down, stickDpad.down || hatDpad.down);
        buttons.set(Button.Left, stickDpad.left || hatDpad.left);
        buttons.set(Button.Right, stickDpad.right || hatDpad.right);
      }

      // Buttons typically in bytes 5-6 for this format
      const btnByte1 = data[5] ?? 0;
      const btnByte2 = data[6] ?? 0;

      // Common mapping: bits 0-3 for face buttons
      buttons.set(Button.A, (btnByte1 & 0x02) !== 0 || (btnByte1 & 0x08) !== 0);
      buttons.set(Button.B, (btnByte1 & 0x01) !== 0 || (btnByte1 & 0x04) !== 0);
      buttons.set(Button.Select, (btnByte1 & 0x10) !== 0 || (btnByte2 & 0x01) !== 0);
      buttons.set(Button.Start, (btnByte1 & 0x20) !== 0 || (btnByte2 & 0x02) !== 0);
    } else {
      // Format 2: Very simple - everything in 1-2 bytes
      const btnByte = data[0];

      buttons.set(Button.A, (btnByte & 0x01) !== 0);
      buttons.set(Button.B, (btnByte & 0x02) !== 0);
      buttons.set(Button.Select, (btnByte & 0x04) !== 0);
      buttons.set(Button.Start, (btnByte & 0x08) !== 0);
      buttons.set(Button.Up, (btnByte & 0x10) !== 0);
      buttons.set(Button.Down, (btnByte & 0x20) !== 0);
      buttons.set(Button.Left, (btnByte & 0x40) !== 0);
      buttons.set(Button.Right, (btnByte & 0x80) !== 0);
    }

    return buttons;
  },
};

/**
 * All known gamepad profiles, ordered by specificity
 * More specific profiles should come first
 */
export const gamepadProfiles: GamepadProfile[] = [
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
export function findProfile(vendorId: number, productId: number): GamepadProfile {
  // First try to find exact vendor + product match
  for (const profile of gamepadProfiles) {
    if (profile.vendorIds.length === 0) continue; // Skip generic fallback
    if (!profile.vendorIds.includes(vendorId)) continue;
    if (profile.productIds.length > 0 && profile.productIds.includes(productId)) {
      return profile;
    }
  }

  // Then try vendor-only match
  for (const profile of gamepadProfiles) {
    if (profile.vendorIds.length === 0) continue;
    if (profile.vendorIds.includes(vendorId) && profile.productIds.length === 0) {
      return profile;
    }
  }

  // Fall back to generic profile
  return genericGamepadProfile;
}

/**
 * Check if a device looks like a gamepad based on HID usage
 */
export function isGamepadDevice(device: {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
  product?: string;
}): boolean {
  // HID usage page 0x01 = Generic Desktop Controls
  // Usage 0x04 = Joystick, 0x05 = Gamepad
  if (device.usagePage === 0x01 && (device.usage === 0x04 || device.usage === 0x05)) {
    return true;
  }

  // Check for known gaming vendor IDs
  const gamingVendors = [
    0x045e, // Microsoft
    0x054c, // Sony
    0x057e, // Nintendo
    0x2dc8, // 8BitDo
    0x0e6f, // PDP
    0x0f0d, // Hori
    0x1532, // Razer
    0x24c6, // PowerA
    0x28de, // Valve (Steam Controller)
    0x046d, // Logitech
    0x0079, // DragonRise (generic USB gamepads)
    0x0810, // Various generic gamepads
    0x12ab, // Honey Bee (generic)
    0x1a34, // Various generic
    0x20d6, // PowerA/BDA
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
}
