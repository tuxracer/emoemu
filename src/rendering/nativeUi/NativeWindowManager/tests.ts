import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ink-native so tests never open a real window.
// Fixtures must be created inside vi.hoisted() so they exist before the
// hoisted vi.mock() factory runs (vi.mock calls are hoisted above regular
// top-level const declarations, and importing NativeWindowManager below
// pulls in 'ink-native' before the rest of this file's body executes).
const { fakeWindow, fakeRenderer, createStreamsMock } = vi.hoisted(() => {
  const fakeWindow = {
    on: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    clear: vi.fn(),
    close: vi.fn(),
    isClosed: vi.fn(() => false),
    getDimensions: vi.fn(() => ({ columns: 80, rows: 24 })),
  };
  const fakeRenderer = {
    reset: vi.fn(),
    clear: vi.fn(),
    destroy: vi.fn(),
    present: vi.fn(),
    getFramebuffer: vi.fn(() => ({ pixels: new Uint32Array(4), width: 2, height: 2 })),
  };
  const createStreamsMock = vi.fn(() => ({
    stdin: {}, stdout: {}, window: fakeWindow, renderer: fakeRenderer,
  }));
  return { fakeWindow, fakeRenderer, createStreamsMock };
});
vi.mock('ink-native', () => ({
  createStreams: createStreamsMock,
  isFensterAvailable: () => true,
}));

import { NativeWindowManager } from '.';

describe('NativeWindowManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton between tests
    (NativeWindowManager as unknown as { instance: unknown }).instance = null;
  });

  it('creates the window exactly once across repeated init calls', () => {
    const wm = NativeWindowManager.getInstance();
    wm.init({ title: 'emoemu', width: 640, height: 480 });
    wm.init({ title: 'emoemu', width: 640, height: 480 });
    expect(createStreamsMock).toHaveBeenCalledTimes(1);
    expect(wm.isInitialized()).toBe(true);
  });

  it('pauses Ink in game mode and resumes + resets in ui mode', () => {
    const wm = NativeWindowManager.getInstance();
    wm.init({});
    wm.setMode('game');
    expect(fakeWindow.pause).toHaveBeenCalledTimes(1);
    wm.setMode('ui');
    expect(fakeRenderer.reset).toHaveBeenCalledTimes(1);
    expect(fakeRenderer.clear).toHaveBeenCalledTimes(1);
    expect(fakeWindow.resume).toHaveBeenCalledTimes(1);
  });

  it('reports closed after the window close event fires', () => {
    const wm = NativeWindowManager.getInstance();
    wm.init({});
    const closeHandler = fakeWindow.on.mock.calls.find(([evt]) => evt === 'close')?.[1] as () => void;
    expect(closeHandler).toBeDefined();
    expect(wm.isClosed()).toBe(false);
    closeHandler();
    expect(wm.isClosed()).toBe(true);
  });

  it('tears down solely through window.close() on destroy (no separate renderer.destroy())', () => {
    const wm = NativeWindowManager.getInstance();
    wm.init({});
    wm.destroy();
    expect(fakeWindow.close).toHaveBeenCalledTimes(1);
    expect(fakeRenderer.destroy).not.toHaveBeenCalled();
    expect(wm.isInitialized()).toBe(false);
  });
});
