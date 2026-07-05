/*
 * Derived in part from RetroArch's netplay implementation (network/netplay/)
 * Copyright (C) 2010-2017 Hans-Kristian Arntzen, Daniel De Matteis,
 * Gregor Richards, and other RetroArch contributors.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See the LICENSE file and src/netplay/index.ts for details.
 */

import type { SyncManager } from '../SyncManager';
import type { ReplayCoreHooks } from './types';

export * from './types';

/**
 * Connect a SyncManager's rollback events to the core so rollbacks
 * actually rewind and re-run emulation:
 *
 * rollback-start -> beginReplay (suppress audio)
 * restore-state  -> load the pre-divergence savestate into the core
 * run-frame      -> apply corrected input, run the core, re-capture the
 *                   frame's state into the ring (so later rollbacks and
 *                   CRC checks see the corrected history)
 * rollback-end   -> endReplay (restore audio)
 */
export const wireRollbackReplay = (syncManager: SyncManager, hooks: ReplayCoreHooks): void => {
  // Reused serialize scratch for replayed frames; safe because the frame
  // ring copies the bytes in storeReplayState
  let captureScratch: Buffer | null = null;

  syncManager.on('rollback-start', () => {
    hooks.beginReplay?.();
  });

  syncManager.on('restore-state', (_frameNumber, state) => {
    hooks.restoreState(state);
  });

  syncManager.on('run-frame', (frameNumber, input) => {
    hooks.applyInput(input);
    hooks.runFrame();

    const state = hooks.captureState(captureScratch);
    if (state !== null) {
      captureScratch = state;
      syncManager.storeReplayState(frameNumber, state, hooks.captureCrcBasis?.() ?? undefined);
    }
  });

  syncManager.on('rollback-end', () => {
    hooks.endReplay?.();
  });
};
