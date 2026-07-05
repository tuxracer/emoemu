/**
 * Core downloader error types
 */

import { createTypedError } from '../../utils/typedError';

export type CoreDownloadErrorCode =
  | 'UNSUPPORTED_PLATFORM'
  | 'FETCH_INDEX_FAILED'
  | 'EXTRACT_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'NO_RESPONSE_BODY';

const { TypedError, isTypedError } = createTypedError<CoreDownloadErrorCode>('CoreDownloadError');
export const CoreDownloadError = TypedError;
export type CoreDownloadError = InstanceType<typeof TypedError>;
export const isCoreDownloadError = isTypedError;
