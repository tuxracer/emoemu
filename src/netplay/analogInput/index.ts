/*
 * Derived in part from RetroArch's netplay implementation (network/netplay/)
 * Copyright (C) 2010-2017 Hans-Kristian Arntzen, Daniel De Matteis,
 * Gregor Richards, and other RetroArch contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See the LICENSE file and src/netplay/index.ts for details.
 */

import { clamp } from 'remeda';
import {
  ANALOG_AXIS_MIN,
  ANALOG_AXIS_MAX,
  ANALOG_AXIS_MASK,
  ANALOG_Y_SHIFT,
  ANALOG_SIGN_BIT,
  ANALOG_SIGN_ADJUST,
} from './consts';

export * from './consts';

/**
 * Analog stick packing for the netplay INPUT command.
 *
 * RetroArch packs one stick per 32-bit word: `(u16)x | ((u16)y << 16)`,
 * with each axis a signed 16-bit value stored as two's complement.
 */

const toSigned16 = (value: number): number => {
  return (value & ANALOG_SIGN_BIT) !== 0 ? value - ANALOG_SIGN_ADJUST : value;
};

/** Pack a stick's X/Y axes (signed, clamped to int16) into one word */
export const packAnalogStick = (x: number, y: number): number => {
  const cx = clamp(Math.round(x), { min: ANALOG_AXIS_MIN, max: ANALOG_AXIS_MAX });
  const cy = clamp(Math.round(y), { min: ANALOG_AXIS_MIN, max: ANALOG_AXIS_MAX });
  return (((cy & ANALOG_AXIS_MASK) << ANALOG_Y_SHIFT) | (cx & ANALOG_AXIS_MASK)) >>> 0;
};

/** Extract the signed X axis from a packed stick word */
export const unpackAnalogX = (word: number): number => {
  return toSigned16(word & ANALOG_AXIS_MASK);
};

/** Extract the signed Y axis from a packed stick word */
export const unpackAnalogY = (word: number): number => {
  return toSigned16((word >>> ANALOG_Y_SHIFT) & ANALOG_AXIS_MASK);
};
