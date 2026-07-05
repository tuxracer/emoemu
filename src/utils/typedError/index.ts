/**
 * Factory for creating typed error classes with machine-readable error codes.
 *
 * Usage:
 * ```typescript
 * type MyErrorCode = 'NOT_FOUND' | 'TIMEOUT';
 * const { TypedError: MyError, isTypedError: isMyError } = createTypedError<MyErrorCode>('MyError');
 * throw new MyError('NOT_FOUND', 'Resource not found');
 * ```
 */
export const createTypedError = <T extends string>(name: string) => {
  class TypedError extends Error {
    readonly code: T;
    constructor(code: T, details?: string) {
      super(details ? `${code}: ${details}` : code);
      this.name = name;
      this.code = code;
    }
  }

  const isTypedError = (error: unknown): error is TypedError => {
    return error instanceof TypedError;
  };

  return { TypedError, isTypedError };
};
