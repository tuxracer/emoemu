/**
 * App Capabilities Context
 *
 * Provides app-wide information about terminal and system capabilities.
 * This avoids prop drilling for commonly needed capability flags.
 */

import { createContext, useContext, type ReactNode } from 'react';

/**
 * App capabilities that are detected at startup and available throughout the app.
 */
export interface AppCapabilities {
  /** Whether the terminal supports Kitty graphics protocol */
  kittyGraphicsSupported: boolean;
  /** Whether the native window backend is available for rendering */
  nativeSupported: boolean;
}

const AppCapabilitiesContext = createContext<AppCapabilities | null>(null);

interface AppCapabilitiesProviderProps {
  children: ReactNode;
  capabilities: AppCapabilities;
}

/**
 * Provider for app-wide capabilities.
 * Should wrap the entire app (or UI tree) to make capabilities available.
 */
export const AppCapabilitiesProvider = ({ children, capabilities }: AppCapabilitiesProviderProps) => {
  return (
    <AppCapabilitiesContext.Provider value={capabilities}>
      {children}
    </AppCapabilitiesContext.Provider>
  );
};

/**
 * Hook to access app capabilities.
 * Must be used within an AppCapabilitiesProvider.
 *
 * @throws Error if used outside of AppCapabilitiesProvider
 */
export const useAppCapabilities = (): AppCapabilities => {
  const context = useContext(AppCapabilitiesContext);
  if (!context) {
    throw new Error('useAppCapabilities must be used within an AppCapabilitiesProvider');
  }
  return context;
};

/**
 * Hook to check if Kitty graphics protocol is supported.
 * Convenience wrapper around useAppCapabilities.
 */
export const useKittyGraphicsSupported = (): boolean => {
  return useAppCapabilities().kittyGraphicsSupported;
};

/**
 * Hook to check if the native window backend is supported.
 * Convenience wrapper around useAppCapabilities.
 */
export const useNativeSupported = (): boolean => {
  return useAppCapabilities().nativeSupported;
};
