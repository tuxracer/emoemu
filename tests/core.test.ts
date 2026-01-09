import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerCore,
  getCoreFactory,
  detectCoreFactory,
  listCores,
  getSupportedExtensions,
  isRomSupported,
} from '../src/frontend/core-registry.js';

// Import NES core to register it
import '../src/cores/nes/index.js';

describe('Core Registry', () => {
  describe('NES Core Registration', () => {
    it('should have NES core registered', () => {
      const factory = getCoreFactory('nes');
      expect(factory).toBeDefined();
    });

    it('should return correct system info for NES', () => {
      const factory = getCoreFactory('nes');
      expect(factory).toBeDefined();

      const info = factory!.getSystemInfo();
      expect(info.id).toBe('nes');
      expect(info.name).toBe('Nintendo Entertainment System');
      expect(info.width).toBe(256);
      expect(info.height).toBe(240);
      expect(info.fps).toBeCloseTo(60.0988, 2);
      expect(info.sampleRate).toBe(44100);
      expect(info.maxPlayers).toBe(2);
      expect(info.colorSpace).toBe('palette');
      expect(info.buttons).toHaveLength(8);
    });

    it('should have correct NES button definitions', () => {
      const factory = getCoreFactory('nes');
      const info = factory!.getSystemInfo();

      const buttonNames = info.buttons.map((b) => b.name);
      expect(buttonNames).toContain('A');
      expect(buttonNames).toContain('B');
      expect(buttonNames).toContain('Start');
      expect(buttonNames).toContain('Select');
      expect(buttonNames).toContain('Up');
      expect(buttonNames).toContain('Down');
      expect(buttonNames).toContain('Left');
      expect(buttonNames).toContain('Right');
    });
  });

  describe('Core Detection', () => {
    it('should detect NES core for .nes extension', () => {
      const factory = detectCoreFactory('game.nes');
      expect(factory).toBeDefined();
      expect(factory!.getSystemInfo().id).toBe('nes');
    });

    it('should detect NES core for .NES extension (case insensitive)', () => {
      const factory = detectCoreFactory('game.NES');
      expect(factory).toBeDefined();
      expect(factory!.getSystemInfo().id).toBe('nes');
    });

    it('should detect NES core for .unf extension', () => {
      const factory = detectCoreFactory('game.unf');
      expect(factory).toBeDefined();
      expect(factory!.getSystemInfo().id).toBe('nes');
    });

    it('should return undefined for unsupported extension', () => {
      const factory = detectCoreFactory('game.gba');
      expect(factory).toBeUndefined();
    });

    it('should return undefined for file without extension', () => {
      const factory = detectCoreFactory('game');
      expect(factory).toBeUndefined();
    });
  });

  describe('isRomSupported', () => {
    it('should return true for supported extensions', () => {
      expect(isRomSupported('game.nes')).toBe(true);
      expect(isRomSupported('game.unf')).toBe(true);
    });

    it('should return false for unsupported extensions', () => {
      expect(isRomSupported('game.gba')).toBe(false);
      expect(isRomSupported('game.smc')).toBe(false);
    });
  });

  describe('listCores', () => {
    it('should list NES core', () => {
      const cores = listCores();
      expect(cores.length).toBeGreaterThanOrEqual(1);

      const nesCore = cores.find((c) => c.id === 'nes');
      expect(nesCore).toBeDefined();
      expect(nesCore!.name).toBe('Nintendo Entertainment System');
      expect(nesCore!.extensions).toContain('.nes');
      expect(nesCore!.extensions).toContain('.unf');
    });
  });

  describe('getSupportedExtensions', () => {
    it('should include NES extensions', () => {
      const extensions = getSupportedExtensions();
      expect(extensions).toContain('.nes');
      expect(extensions).toContain('.unf');
    });

    it('should return sorted extensions', () => {
      const extensions = getSupportedExtensions();
      const sorted = [...extensions].sort();
      expect(extensions).toEqual(sorted);
    });
  });
});

describe('NESCore Interface', () => {
  it('should create a valid NES core instance', () => {
    const factory = getCoreFactory('nes');
    expect(factory).toBeDefined();

    const core = factory!.create();
    expect(core).toBeDefined();
    expect(core.getSystemInfo().id).toBe('nes');

    // Clean up
    core.destroy();
  });

  it('should have all required Core interface methods', () => {
    const factory = getCoreFactory('nes');
    const core = factory!.create();

    // Lifecycle
    expect(typeof core.getSystemInfo).toBe('function');
    expect(typeof core.loadRom).toBe('function');
    expect(typeof core.reset).toBe('function');
    expect(typeof core.destroy).toBe('function');

    // Emulation
    expect(typeof core.runFrame).toBe('function');
    expect(typeof core.isFrameComplete).toBe('function');

    // Video
    expect(typeof core.getFramebuffer).toBe('function');

    // Audio
    expect(typeof core.getAudioConfig).toBe('function');
    expect(typeof core.setAudioCallback).toBe('function');

    // Input
    expect(typeof core.setButtonState).toBe('function');
    expect(typeof core.getButtonState).toBe('function');

    // State
    expect(typeof core.getState).toBe('function');
    expect(typeof core.setState).toBe('function');
    expect(typeof core.getStateVersion).toBe('function');

    // Battery
    expect(typeof core.hasBatterySave).toBe('function');
    expect(typeof core.getBatteryRam).toBe('function');
    expect(typeof core.setBatteryRam).toBe('function');

    core.destroy();
  });

  it('should return correct audio config', () => {
    const factory = getCoreFactory('nes');
    const core = factory!.create();

    const audioConfig = core.getAudioConfig();
    expect(audioConfig.sampleRate).toBe(44100);
    expect(audioConfig.channels).toBe(1);

    core.destroy();
  });

  it('should return state version', () => {
    const factory = getCoreFactory('nes');
    const core = factory!.create();

    const version = core.getStateVersion();
    expect(typeof version).toBe('number');
    expect(version).toBeGreaterThan(0);

    core.destroy();
  });
});
