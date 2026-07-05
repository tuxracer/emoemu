/**
 * Extracts a human-readable message from an unknown caught error.
 * Handles Error instances, strings, and other values.
 */
export const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
};
