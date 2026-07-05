import { readFileSync, writeFileSync, existsSync, utimesSync, unlinkSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import type { Core } from '../../core/core';
import type { Config } from '../../frontend/config';
import { getSavestatesDirectory, getSavefilesDirectory } from '../../frontend/config';
import { logger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { ensureDirectory } from '../../utils/ensureDirectory';

/**
 * Get the directory for save state files.
 * Uses ROM directory if savestates_in_content_dir is true (default),
 * otherwise uses configured savestate_directory or platform default.
 */
export const getSavestateDirectory = (config: Config | null, romPath: string): string => {
  if (!config || config.savestates_in_content_dir !== false) {
    return dirname(romPath);
  }
  return getSavestatesDirectory(config);
};

/**
 * Get the path for the save state file.
 * Format: [rom basename without extension].state.auto
 */
export const getStatePath = (config: Config | null, romPath: string): string => {
  const dir = getSavestateDirectory(config, romPath);
  const name = basename(romPath, extname(romPath));
  return join(dir, `${name}.state.auto`);
};

/**
 * Get the directory for battery save (.srm) files.
 * Uses ROM directory if savefiles_in_content_dir is true (default),
 * otherwise uses configured savefile_directory or platform default.
 */
export const getSavefileDirectory = (config: Config | null, romPath: string): string => {
  if (!config || config.savefiles_in_content_dir !== false) {
    return dirname(romPath);
  }
  return getSavefilesDirectory(config);
};

/**
 * Get the path for the battery save (.srm) file.
 * Uses RetroArch-compatible naming: [rom basename without extension].srm
 */
export const getSrmPath = (config: Config | null, romPath: string): string => {
  const dir = getSavefileDirectory(config, romPath);
  const name = basename(romPath, extname(romPath));
  return join(dir, name + '.srm');
};

/**
 * Load battery save from .srm file (RetroArch-compatible format).
 * Raw binary SRAM data, no header.
 */
export const loadBatterySave = (core: Core, config: Config | null, romPath: string): void => {
  if (!core.hasBatterySave()) {
    return;
  }

  const srmPath = getSrmPath(config, romPath);
  if (!existsSync(srmPath)) {
    return;
  }

  try {
    const data = readFileSync(srmPath);
    core.setBatteryRam(new Uint8Array(data));
  } catch (err) {
    logger.warn(`Failed to load battery save: ${srmPath} - ${getErrorMessage(err)}`, 'SaveFile');
  }
};

/**
 * Save battery RAM to .srm file (RetroArch-compatible format).
 * Raw binary SRAM data, no header.
 */
export const saveBatterySave = (core: Core, config: Config | null, romPath: string): void => {
  if (!core.hasBatterySave()) {
    return;
  }

  const batteryRam = core.getBatteryRam();
  if (!batteryRam) {
    return;
  }

  const srmPath = getSrmPath(config, romPath);
  try {
    ensureDirectory(dirname(srmPath));
    writeFileSync(srmPath, Buffer.from(batteryRam));
    // Force update mtime even if content is identical
    const now = new Date();
    utimesSync(srmPath, now, now);
  } catch (err) {
    logger.error(`Failed to save battery save: ${srmPath} - ${getErrorMessage(err)}`, 'SaveFile');
  }
};

/** Check if a save state exists for the given ROM. */
export const hasSavedState = (config: Config | null, romPath: string): boolean => {
  return existsSync(getStatePath(config, romPath));
};

/**
 * Save the current state to a .state.auto file.
 * For libretro cores: raw binary (RetroArch-compatible)
 */
export const saveState = (core: Core, config: Config | null, romPath: string): void => {
  const statePath = getStatePath(config, romPath);
  try {
    const state = core.getState();
    if (!state) {
      return; // Core doesn't support save states
    }

    ensureDirectory(dirname(statePath));
    writeFileSync(statePath, state);
  } catch (err) {
    logger.error(`Failed to save state: ${statePath} - ${getErrorMessage(err)}`, 'SaveState');
  }
};

/**
 * Load state from a save state file.
 * @returns true if state was loaded successfully
 */
export const loadStateFromFile = (core: Core, statePath: string): boolean => {
  if (!existsSync(statePath)) {
    return false;
  }

  try {
    const fileData = readFileSync(statePath);
    core.setState(fileData);
    return true;
  } catch (err) {
    logger.error(`Failed to load state: ${statePath} - ${getErrorMessage(err)}`, 'SaveState');
    return false;
  }
};

/** Delete the save state file for the given ROM. */
export const deleteSavedState = (config: Config | null, romPath: string): void => {
  const statePath = getStatePath(config, romPath);
  if (existsSync(statePath)) {
    try {
      unlinkSync(statePath);
    } catch (err) {
      logger.warn(`Failed to delete save state: ${statePath} - ${getErrorMessage(err)}`, 'SaveState');
    }
  }
};
