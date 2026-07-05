import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfig,
  updateConfigValue,
  ensureConfigExists,
  DEFAULT_CONFIG,
} from '.';
import {
  getConfigDirectory,
  getDefaultConfigPath,
} from '../../utils/paths';

describe('Config System', () => {
  const testDir = join(tmpdir(), 'emoemu-config-test');
  const testConfigPath = join(testDir, 'test.cfg');

  beforeEach(() => {
    // Create test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testConfigPath)) {
      unlinkSync(testConfigPath);
    }
    // Clean up nested directories
    const nestedDir = join(testDir, 'nested');
    if (existsSync(nestedDir)) {
      rmSync(nestedDir, { recursive: true });
    }
  });

  describe('getConfigDirectory', () => {
    it('should return a valid path', () => {
      const dir = getConfigDirectory();
      expect(dir).toBeDefined();
      expect(typeof dir).toBe('string');
      expect(dir.length).toBeGreaterThan(0);
    });
  });

  describe('getDefaultConfigPath', () => {
    it('should return a path ending with emoemu.cfg', () => {
      const path = getDefaultConfigPath();
      expect(path).toContain('emoemu.cfg');
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have all required keys', () => {
      expect(DEFAULT_CONFIG.video_driver).toBe(null);  // null = Auto (system-specific default)
      expect(DEFAULT_CONFIG.video_scale).toBe(null);  // null = Auto (system-specific default)
      expect(DEFAULT_CONFIG.audio_enable).toBe(true);
      expect(DEFAULT_CONFIG.savestate_auto_load).toBe(true);
      expect(DEFAULT_CONFIG.savestate_auto_save).toBe(true);
    });

    it('should have valid video driver', () => {
      // null = Auto, otherwise must be a valid driver
      const validDrivers = [null, 'kitty', 'terminal', 'ascii', 'emoji'];
      expect(validDrivers).toContain(DEFAULT_CONFIG.video_driver);
    });
  });

  describe('loadConfig', () => {
    it('should return defaults when no config file exists', () => {
      const { config, loadedFrom } = loadConfig('/nonexistent/path.cfg');
      expect(loadedFrom).toBeNull();
      expect(config.video_driver).toBe(DEFAULT_CONFIG.video_driver);
      expect(config.video_scale).toBe(DEFAULT_CONFIG.video_scale);
    });

    it('should load config from custom path', () => {
      // Create a test config file
      const configContent = `
# Test config
video_driver = "terminal"
video_scale = 3
audio_enable = false
`;
      writeFileSync(testConfigPath, configContent);

      const { config, loadedFrom } = loadConfig(testConfigPath);
      expect(loadedFrom).toBe(testConfigPath);
      expect(config.video_driver).toBe('terminal');
      expect(config.video_scale).toBe(3);
      expect(config.audio_enable).toBe(false);
    });

    it('should handle quoted and unquoted values', () => {
      const configContent = `
video_driver = "terminal"
video_scale = 4
audio_enable = true
`;
      writeFileSync(testConfigPath, configContent);

      const { config } = loadConfig(testConfigPath);
      expect(config.video_driver).toBe('terminal');
      expect(config.video_scale).toBe(4);
      expect(config.audio_enable).toBe(true);
    });

    it('should skip comment lines', () => {
      const configContent = `
# This is a comment
video_driver = "ascii"
# Another comment
video_scale = 5
`;
      writeFileSync(testConfigPath, configContent);

      const { config } = loadConfig(testConfigPath);
      expect(config.video_driver).toBe('ascii');
      expect(config.video_scale).toBe(5);
    });

    it('should skip empty lines', () => {
      const configContent = `

video_driver = "emoji"

video_scale = 1

`;
      writeFileSync(testConfigPath, configContent);

      const { config } = loadConfig(testConfigPath);
      expect(config.video_driver).toBe('emoji');
      expect(config.video_scale).toBe(1);
    });

    it('should handle boolean values correctly', () => {
      const configContent = `
audio_enable = false
savestate_compression = true
fps_show_enable = true
`;
      writeFileSync(testConfigPath, configContent);

      const { config } = loadConfig(testConfigPath);
      expect(config.audio_enable).toBe(false);
      expect(config.savestate_compression).toBe(true);
      expect(config.fps_show_enable).toBe(true);
    });

    it('should handle float values correctly', () => {
      const configContent = `
video_gamma = 1.3
video_scanlines = 0.5
video_bloom = 0.75
`;
      writeFileSync(testConfigPath, configContent);

      const { config } = loadConfig(testConfigPath);
      expect(config.video_gamma).toBeCloseTo(1.3);
      expect(config.video_scanlines).toBeCloseTo(0.5);
      expect(config.video_bloom).toBeCloseTo(0.75);
    });

    it('should merge with defaults for missing keys', () => {
      const configContent = `
video_driver = "terminal"
`;
      writeFileSync(testConfigPath, configContent);

      const { config } = loadConfig(testConfigPath);
      expect(config.video_driver).toBe('terminal');
      // All other values should be defaults
      expect(config.video_scale).toBe(DEFAULT_CONFIG.video_scale);
      expect(config.audio_enable).toBe(DEFAULT_CONFIG.audio_enable);
    });

    it('should ignore unknown keys', () => {
      const configContent = `
video_driver = "kitty"
unknown_key = "value"
another_unknown = 123
`;
      writeFileSync(testConfigPath, configContent);

      const { config } = loadConfig(testConfigPath);
      expect(config.video_driver).toBe('kitty');
      // Should not crash and should have valid config
      expect(config).toBeDefined();
    });

    it('should fall back to Auto (null) for legacy/invalid video_driver values', () => {
      const configContent = `
video_driver = "sdl"
`;
      writeFileSync(testConfigPath, configContent);

      const { config } = loadConfig(testConfigPath);
      // "sdl" was removed in the ink-native migration; unknown values fall back to Auto
      expect(config.video_driver).toBe(null);
    });

    it('should preserve a valid video_driver value', () => {
      const configContent = `
video_driver = "native"
`;
      writeFileSync(testConfigPath, configContent);

      const { config } = loadConfig(testConfigPath);
      expect(config.video_driver).toBe('native');
    });
  });

  describe('updateConfigValue', () => {
    it('should create config file if it does not exist', () => {
      expect(existsSync(testConfigPath)).toBe(false);

      updateConfigValue('video_driver', 'terminal', testConfigPath);

      expect(existsSync(testConfigPath)).toBe(true);
      const content = readFileSync(testConfigPath, 'utf-8');
      expect(content).toContain('video_driver = "terminal"');
    });

    it('should uncomment and update existing commented setting', () => {
      // Create a config with commented setting
      const configContent = `# emoemu Configuration
# video_driver = "kitty"
# video_scale = 2
`;
      writeFileSync(testConfigPath, configContent);

      updateConfigValue('video_driver', 'terminal', testConfigPath);

      const content = readFileSync(testConfigPath, 'utf-8');
      expect(content).toContain('video_driver = "terminal"');
      // Should not have the commented version anymore
      expect(content).not.toContain('# video_driver');
    });

    it('should update existing uncommented setting', () => {
      const configContent = `video_driver = "kitty"
video_scale = 2
`;
      writeFileSync(testConfigPath, configContent);

      updateConfigValue('video_driver', 'ascii', testConfigPath);

      const content = readFileSync(testConfigPath, 'utf-8');
      expect(content).toContain('video_driver = "ascii"');
      expect(content).not.toContain('video_driver = "kitty"');
    });

    it('should append setting if not found in file', () => {
      const configContent = `# emoemu Configuration
video_driver = "kitty"
`;
      writeFileSync(testConfigPath, configContent);

      updateConfigValue('fps_show_enable', true, testConfigPath);

      const content = readFileSync(testConfigPath, 'utf-8');
      expect(content).toContain('fps_show_enable = true');
    });

    it('should handle boolean values', () => {
      writeFileSync(testConfigPath, '# audio_enable = true\n');

      updateConfigValue('audio_enable', false, testConfigPath);

      const content = readFileSync(testConfigPath, 'utf-8');
      expect(content).toContain('audio_enable = false');
    });

    it('should handle numeric values', () => {
      writeFileSync(testConfigPath, '# video_scale = 2\n');

      updateConfigValue('video_scale', 4, testConfigPath);

      const content = readFileSync(testConfigPath, 'utf-8');
      expect(content).toContain('video_scale = 4');
    });

    it('should handle float values', () => {
      writeFileSync(testConfigPath, '# video_gamma = 1.0\n');

      updateConfigValue('video_gamma', 1.5, testConfigPath);

      const content = readFileSync(testConfigPath, 'utf-8');
      expect(content).toContain('video_gamma = 1.5');
    });

    it('should create parent directories if needed', () => {
      const deepPath = join(testDir, 'nested', 'dir', 'test.cfg');

      updateConfigValue('video_driver', 'terminal', deepPath);

      expect(existsSync(deepPath)).toBe(true);
      const content = readFileSync(deepPath, 'utf-8');
      expect(content).toContain('video_driver = "terminal"');
    });
  });

  describe('ensureConfigExists', () => {
    // Note: This test uses the actual default path, so we skip modifying it
    // to avoid affecting user's real config. Instead we test the behavior.
    it('should return the default config path', () => {
      const path = ensureConfigExists();
      expect(path).toBe(getDefaultConfigPath());
    });
  });

  describe('round-trip', () => {
    it('should preserve values through updateConfigValue and loadConfig', () => {
      // Start with empty file
      writeFileSync(testConfigPath, '# emoemu Configuration\n');

      // Update multiple values
      updateConfigValue('video_driver', 'ascii', testConfigPath);
      updateConfigValue('video_scale', 5, testConfigPath);
      updateConfigValue('video_gamma', 1.5, testConfigPath);
      updateConfigValue('audio_enable', false, testConfigPath);
      updateConfigValue('fps_show_enable', true, testConfigPath);
      updateConfigValue('savestate_compression', false, testConfigPath);

      const { config: loadedConfig } = loadConfig(testConfigPath);

      expect(loadedConfig.video_driver).toBe('ascii');
      expect(loadedConfig.video_scale).toBe(5);
      expect(loadedConfig.video_gamma).toBeCloseTo(1.5);
      expect(loadedConfig.audio_enable).toBe(false);
      expect(loadedConfig.fps_show_enable).toBe(true);
      expect(loadedConfig.savestate_compression).toBe(false);
    });

    it('should preserve other settings when updating one value', () => {
      const configContent = `video_driver = "terminal"
video_scale = 3
audio_enable = false
`;
      writeFileSync(testConfigPath, configContent);

      // Update just one value
      updateConfigValue('video_scale', 5, testConfigPath);

      const { config } = loadConfig(testConfigPath);
      expect(config.video_driver).toBe('terminal');
      expect(config.video_scale).toBe(5);
      expect(config.audio_enable).toBe(false);
    });
  });
});
