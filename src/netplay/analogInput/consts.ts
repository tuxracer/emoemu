/** Minimum signed 16-bit axis value */
export const ANALOG_AXIS_MIN = -32768;

/** Maximum signed 16-bit axis value */
export const ANALOG_AXIS_MAX = 32767;

/** Mask for one 16-bit axis within the packed stick word */
export const ANALOG_AXIS_MASK = 0xffff;

/** Bit offset of the Y axis within the packed stick word */
export const ANALOG_Y_SHIFT = 16;

/** Sign bit of a 16-bit axis value */
export const ANALOG_SIGN_BIT = 0x8000;

/** Two's complement adjustment for a negative 16-bit axis */
export const ANALOG_SIGN_ADJUST = 0x10000;
