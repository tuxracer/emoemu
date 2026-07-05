/**
 * Netplay protocol error types
 */

import { createTypedError } from '../../utils/typedError';

export type ProtocolErrorCode =
  | 'INVALID_INPUT_PAYLOAD'
  | 'INVALID_NOINPUT_PAYLOAD'
  | 'INVALID_INFO_PAYLOAD'
  | 'INVALID_SYNC_PAYLOAD'
  | 'INVALID_MODE_PAYLOAD'
  | 'INVALID_CRC_PAYLOAD'
  | 'INVALID_SAVESTATE_PAYLOAD'
  | 'DECOMPRESS_FAILED';

const { TypedError, isTypedError } = createTypedError<ProtocolErrorCode>('ProtocolError');
export const ProtocolError = TypedError;
export type ProtocolError = InstanceType<typeof TypedError>;
export const isProtocolError = isTypedError;
