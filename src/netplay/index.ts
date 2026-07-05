/*
 * emoemu - Terminal Retro Emulator
 * Copyright (C) 2026 Derek Petersen
 *
 * This module is derived in part from RetroArch's netplay implementation
 * (https://github.com/libretro/RetroArch, network/netplay/):
 * Copyright (C) 2010-2014 - Hans-Kristian Arntzen
 * Copyright (C) 2011-2017 - Daniel De Matteis
 * Copyright (C) 2016-2017 - Gregor Richards
 *
 * emoemu is free software: you can redistribute it and/or modify it under the
 * terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * emoemu is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
 * details. You should have received a copy of the GNU General Public License
 * along with emoemu; if not, see <https://www.gnu.org/licenses/>.
 */

export * from './consts';
export * from './types';
export * from './protocol';
export * from './NetplayConnection';
export * from './crc32';
export {
  FrameBuffer,
  createFrameBuffer,
  INPUTS_PER_DEVICE,
} from './FrameBuffer';
export {
  InputBuffer,
  createInputBuffer,
  INPUT_JOYPAD,
  INPUT_ANALOG_LEFT,
  INPUT_ANALOG_RIGHT,
} from './InputBuffer';
export * from './SyncManager';
export * from './NetplayServer';
export * from './NetplayClient';
export {
  DISCOVERY_QUERY_MAGIC,
  DISCOVERY_RESPONSE_MAGIC,
  QUERY_PACKET_SIZE,
  NETPLAY_HOST_STR_LEN,
  NETPLAY_HOST_LONGSTR_LEN,
  MS_PER_USEC,
  BROADCAST_INTERVAL_MS,
  PASSWORD_FLAG,
  SPECTATE_PASSWORD_FLAG,
  DISCOVERY_HEADER_FIELDS,
  DISCOVERY_PACKET_SIZE,
  type DiscoverySessionInfo,
  DiscoveryBroadcaster,
  DiscoveryListener,
} from './NetplayDiscovery';
export * from './netplayLogger';
