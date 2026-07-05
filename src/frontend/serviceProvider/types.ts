/**
 * Service provider error types
 */

import { createTypedError } from '../../utils/typedError';

export type ServiceErrorCode =
  | 'NOT_INITIALIZED';

const { TypedError, isTypedError } = createTypedError<ServiceErrorCode>('ServiceError');
export const ServiceError = TypedError;
export type ServiceError = InstanceType<typeof TypedError>;
export const isServiceError = isTypedError;
