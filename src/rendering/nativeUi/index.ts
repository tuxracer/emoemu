/**
 * Native UI Module
 *
 * Provides the shared window manager for native window mode and re-exports
 * ink-native components for UI rendering.
 */

// Window manager for the shared native window (UI + game)
export {
  NativeWindowManager,
  getWindowManager,
  type WindowMode,
  type WindowConfig,
} from './NativeWindowManager';

// Re-export ink-native for native UI rendering
export { createStreams, isFensterAvailable } from 'ink-native';

// Re-export constants
export * from './consts';
