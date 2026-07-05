/**
 * Config Context
 *
 * Provides app-wide config state, config file path, and the set of settings
 * locked by CLI flags. Avoids prop drilling through RomBrowser and SettingsPanel.
 */

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { Config, CliOverride } from '../../frontend/config';
import { loadConfig } from '../../frontend/config';
import { applyCliOverrides } from '../../cli/parseArgs';

interface ConfigContextValue {
  config: Config;
  configPath?: string;
  setConfig: (config: Config) => void;
  reloadConfig: () => void;
  lockedKeys: ReadonlySet<string>;
  lockedFlagByKey: ReadonlyMap<string, string>;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

interface ConfigProviderProps {
  children: ReactNode;
  initialConfig: Config;
  configPath?: string;
  cliOverrides?: CliOverride[];
}

export const ConfigProvider = ({ children, initialConfig, configPath, cliOverrides = [] }: ConfigProviderProps) => {
  const [config, setConfig] = useState(initialConfig);

  const reloadConfig = useCallback(() => {
    const { config: reloaded } = loadConfig(configPath);
    applyCliOverrides(reloaded, cliOverrides);  // CLI locks outrank the on-disk config
    setConfig(reloaded);
  }, [configPath, cliOverrides]);

  const lockedKeys = useMemo(() => new Set(cliOverrides.map(o => o.key)), [cliOverrides]);
  const lockedFlagByKey = useMemo(
    () => new Map(cliOverrides.map(o => [o.key, o.flag])),
    [cliOverrides],
  );

  return (
    <ConfigContext.Provider value={{ config, configPath, setConfig, reloadConfig, lockedKeys, lockedFlagByKey }}>
      {children}
    </ConfigContext.Provider>
  );
};

export const useConfig = (): ConfigContextValue => {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
};
