/**
 * Native Dialog Utilities
 *
 * Renders Ink dialogs in native window mode using the shared NativeWindowManager
 * streams. In terminal mode, renders to the standard terminal.
 */
import { render, type Instance } from 'ink';
import type { ReactNode } from 'react';
import { getWindowManager, isFensterAvailable } from '../../rendering/nativeUi';
import { logger } from '../../utils/logger';
import { cleanupInkInstance } from '../../utils/terminal';

export interface DialogRenderOptions {
  /** Whether to use native window mode (default: auto-detect from video driver) */
  nativeMode?: boolean;
  /** Dialog title (for the native window) */
  title?: string;
  /** Scale factor for native mode (null = auto-detect from display) */
  scaleFactor?: number | null;
}

interface NativeDialogContext {
  instance: Instance;
  cleanup: () => void;
}

export const isNativeModeAvailable = (): boolean => {
  return isFensterAvailable();
};

export const renderDialog = (
  component: ReactNode,
  options: DialogRenderOptions = {},
): Promise<NativeDialogContext> => {
  const useNative = options.nativeMode && isNativeModeAvailable();
  if (useNative) {
    return renderDialogNative(component, options);
  }
  const instance = render(component);
  return Promise.resolve({
    instance,
    cleanup: () => {
      // Terminal mode cleanup is handled by Ink
    },
  });
};

const renderDialogNative = (
  component: ReactNode,
  options: DialogRenderOptions,
): Promise<NativeDialogContext> => {
  return new Promise((resolve, reject) => {
    try {
      const windowManager = getWindowManager();
      if (!windowManager.isInitialized()) {
        windowManager.init({ title: options.title ?? 'emoemu', scaleFactor: options.scaleFactor });
      }
      windowManager.setMode('ui');

      const stdin = windowManager.getStdin();
      const stdout = windowManager.getStdout();
      const window = windowManager.getWindow();

      // Clear before rendering to avoid artifacts from the previous view.
      windowManager.clearScreen();

      const onClose = () => {
        stdin.push('\x1b'); // Send escape to trigger exit
      };
      window.on('close', onClose);

      logger.info('Native dialog mode enabled (shared window)', 'Native-UI');

      const instance = render(component, {
        exitOnCtrlC: false,
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
      });

      const cleanup = () => {
        // Detach this dialog's close listener; DO NOT close the shared window.
        window.off('close', onClose);
        windowManager.getRenderer().reset();
      };

      resolve({ instance, cleanup });
    } catch (error) {
      logger.warn(`Native dialog failed: ${error}`, 'Native-UI');
      reject(error);
    }
  });
};

export const showDialog = async (
  component: ReactNode,
  options: DialogRenderOptions = {},
): Promise<Instance> => {
  const { instance, cleanup } = await renderDialog(component, options);
  void instance.waitUntilExit().then(() => {
    cleanup();
  });
  return instance;
};

export const launchDialog = <T,>(
  createComponent: (onChoice: (value: T) => void) => ReactNode,
  defaultValue: T,
  options: DialogRenderOptions = {},
): Promise<T> => new Promise((resolve) => {
  let choice = defaultValue;
  const component = createComponent((value) => {
    choice = value;
  });
  void renderDialog(component, options).then(({ instance, cleanup }) => {
    void instance.waitUntilExit().then(() => {
      cleanup();
      cleanupInkInstance(instance, resolve, choice);
    });
  });
});
