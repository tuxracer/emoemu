/**
 * State Manager
 *
 * Handles save state management for emulator cores.
 * Save states are stored as gzipped JSON files with validation.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { gzipSync, gunzipSync, constants } from 'zlib';
import type { CoreState } from '../core/core.js';

/**
 * Extended save state format with metadata
 */
export interface SaveStateFile {
  /** Core state data */
  state: CoreState;

  /** Frame count at time of save */
  frameCount: number;

  /** Timestamp when saved */
  savedAt: string;

  /** ROM path (for validation) */
  romPath: string;
}

/**
 * State validation result
 */
export interface StateValidation {
  /** Whether the state is valid */
  valid: boolean;

  /** Error message if invalid */
  error?: string;

  /** The parsed state if valid */
  state?: SaveStateFile;
}

/**
 * State manager for save/load operations
 */
export class StateManager {
  private romPath: string;
  private coreId: string;
  private stateVersion: number;

  /**
   * Create a state manager for a ROM.
   *
   * @param romPath Path to the ROM file
   * @param coreId Core identifier for validation
   * @param stateVersion Expected state version
   */
  constructor(romPath: string, coreId: string, stateVersion: number) {
    this.romPath = romPath;
    this.coreId = coreId;
    this.stateVersion = stateVersion;
  }

  /**
   * Get the path for the save state file.
   * Replaces the ROM extension with .state
   */
  getStatePath(): string {
    // Remove common ROM extensions and add .state
    return this.romPath.replace(/\.(nes|gba|sfc|smc|gb|gbc)$/i, '.state');
  }

  /**
   * Check if a save state exists for this ROM
   */
  hasSavedState(): boolean {
    return existsSync(this.getStatePath());
  }

  /**
   * Validate a state file without loading it into the emulator.
   *
   * @returns Validation result with parsed state if valid
   */
  validateState(): StateValidation {
    const statePath = this.getStatePath();

    if (!existsSync(statePath)) {
      return { valid: false, error: 'State file not found' };
    }

    try {
      const data = readFileSync(statePath);

      // Check for gzip magic number (0x1f 0x8b)
      const isGzipped = data[0] === 0x1f && data[1] === 0x8b;
      const json = isGzipped
        ? gunzipSync(data).toString('utf-8')
        : data.toString('utf-8');

      const parsed = JSON.parse(json);

      // Handle both old format (direct CoreState) and new format (SaveStateFile)
      let state: SaveStateFile;
      if (parsed.state) {
        // New format
        state = parsed as SaveStateFile;
      } else if (parsed.version && parsed.coreId) {
        // CoreState directly (from NESCore)
        state = {
          state: parsed as CoreState,
          frameCount: (parsed as { frameCount?: number }).frameCount ?? 0,
          savedAt: new Date().toISOString(),
          romPath: this.romPath,
        };
      } else if (parsed.version && parsed.cpu) {
        // Old NES format (version, cpu, ppu, etc.)
        state = {
          state: {
            version: parsed.version,
            coreId: 'nes',
            gameId: parsed.romPath || this.romPath,
            data: parsed,
          },
          frameCount: parsed.frameCount ?? 0,
          savedAt: new Date().toISOString(),
          romPath: parsed.romPath || this.romPath,
        };
      } else {
        return { valid: false, error: 'Invalid state file format' };
      }

      // Validate core ID
      if (state.state.coreId !== this.coreId) {
        return {
          valid: false,
          error: `Wrong core: expected '${this.coreId}', got '${state.state.coreId}'`,
        };
      }

      // Validate version
      if (state.state.version !== this.stateVersion) {
        return {
          valid: false,
          error: `Incompatible version: expected ${this.stateVersion}, got ${state.state.version}`,
        };
      }

      return { valid: true, state };
    } catch (err) {
      return {
        valid: false,
        error: `Failed to parse state file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Load state from file.
   *
   * @returns The core state if valid, null otherwise
   */
  loadState(): CoreState | null {
    const validation = this.validateState();
    if (!validation.valid || !validation.state) {
      return null;
    }
    return validation.state.state;
  }

  /**
   * Save state to file.
   *
   * @param coreState The core state to save
   * @param frameCount Current frame count
   */
  saveState(coreState: CoreState, frameCount: number): void {
    const statePath = this.getStatePath();

    const saveFile: SaveStateFile = {
      state: coreState,
      frameCount,
      savedAt: new Date().toISOString(),
      romPath: this.romPath,
    };

    try {
      const json = JSON.stringify(saveFile);
      const compressed = gzipSync(json, { level: constants.Z_BEST_COMPRESSION });
      writeFileSync(statePath, compressed);
      console.log(`Saved state: ${statePath}`);
    } catch (err) {
      console.error(
        `Failed to save state: ${statePath}`,
        err instanceof Error ? err.message : err
      );
    }
  }

  /**
   * Delete the save state file.
   */
  deleteState(): void {
    const statePath = this.getStatePath();
    if (existsSync(statePath)) {
      try {
        unlinkSync(statePath);
      } catch {
        // Ignore errors when deleting
      }
    }
  }

  /**
   * Get information about the saved state without fully loading it.
   *
   * @returns State info or null if no valid state
   */
  getStateInfo(): { frameCount: number; savedAt: string } | null {
    const validation = this.validateState();
    if (!validation.valid || !validation.state) {
      return null;
    }
    return {
      frameCount: validation.state.frameCount,
      savedAt: validation.state.savedAt,
    };
  }
}
