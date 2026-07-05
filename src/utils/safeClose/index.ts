/**
 * Safely close a resource, ignoring any errors during cleanup.
 */
export const safeClose = (resource: { close: () => void }): void => {
  try {
    resource.close();
  } catch {
    // Ignore errors during cleanup
  }
};
