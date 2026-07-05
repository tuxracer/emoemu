/**
 * Core builder error types
 */

import { createTypedError } from '../../utils/typedError';

export type CoreBuildErrorCode =
  | 'NO_BUILD_CONFIG'
  | 'MISSING_TOOLS'
  | 'OUTPUT_NOT_FOUND';

const { TypedError, isTypedError } = createTypedError<CoreBuildErrorCode>('CoreBuildError');
export const CoreBuildError = TypedError;
export type CoreBuildError = InstanceType<typeof TypedError>;
export const isCoreBuildError = isTypedError;
