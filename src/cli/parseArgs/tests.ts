import { describe, it, expect } from 'vitest';
import { parseArgs, updateOptionsFromConfig, applyCliOverrides, remapDriverOverride } from '.';
import type { Config } from '../../frontend/config';
import { DEFAULT_CONFIG } from '../../frontend/config';
import { SettingsManager } from '../../frontend/SettingsManager';

const MISSING_CONFIG = '/nonexistent/emoemu-parseargs-test.cfg';

describe('cliOverrides', () => {
  it('records a video_driver override with its flag for --native', () => {
    const options = parseArgs(['--config', MISSING_CONFIG, '--native']);
    const o = options.cliOverrides.find(x => x.key === 'video_driver');
    expect(o).toEqual({ key: 'video_driver', value: 'native', flag: '--native' });
  });

  it('records audio, gamepad, save-state, status and frame-limit overrides', () => {
    const options = parseArgs([
      '--config', MISSING_CONFIG,
      '--no-audio', '--no-gamepad', '--no-save-state', '--status', '--frame-limit', '30',
    ]);
    const keys = options.cliOverrides.map(o => o.key).sort();
    expect(keys).toEqual([
      'audio_enable', 'audio_mute_enable', 'fps_show_enable', 'input_joypad_enable',
      'savestate_auto_load', 'savestate_auto_save', 'video_frame_limit',
    ].sort());
    expect(options.cliOverrides.find(o => o.key === 'video_frame_limit'))
      .toEqual({ key: 'video_frame_limit', value: 30, flag: '--frame-limit' });
  });

  it('records no overrides when no menu-backed flag is passed', () => {
    const options = parseArgs(['--config', MISSING_CONFIG]);
    expect(options.cliOverrides).toEqual([]);
  });
});

describe('applyCliOverrides', () => {
  it('merges override values onto the config', () => {
    const config: Config = { ...DEFAULT_CONFIG, video_driver: 'kitty', audio_enable: true };
    applyCliOverrides(config, [
      { key: 'video_driver', value: 'native', flag: '--native' },
      { key: 'audio_enable', value: false, flag: '--no-audio' },
    ]);
    expect(config.video_driver).toBe('native');
    expect(config.audio_enable).toBe(false);
  });
});

describe('CLI overrides survive the browser->game reload', () => {
  it('keeps --native as the Emulator render-mode source when config selects kitty', () => {
    const options = parseArgs(['--config', MISSING_CONFIG, '--native']);
    const reloaded: Config = { ...DEFAULT_CONFIG, video_driver: 'kitty' };

    // Mirror src/index.ts browser->game reload:
    options.config = reloaded;
    applyCliOverrides(reloaded, options.cliOverrides);
    updateOptionsFromConfig(options, reloaded);

    expect(options.renderMode).toBe('native');
    const sm = new SettingsManager(options.config);
    expect(sm.get('renderMode')).toBe('native');
  });

  it('keeps --frame-limit through the reload even if config says a different limit', () => {
    const options = parseArgs(['--config', MISSING_CONFIG, '--frame-limit', '30']);
    const reloaded: Config = { ...DEFAULT_CONFIG, video_frame_limit: 0 };

    options.config = reloaded;
    applyCliOverrides(reloaded, options.cliOverrides);
    updateOptionsFromConfig(options, reloaded);

    expect(options.frameLimit).toBe(30);
    expect(reloaded.video_frame_limit).toBe(30);
  });
});

describe('post-processing overrides', () => {
  it('locks the Post-Processing mode as crt for --crt', () => {
    const options = parseArgs(['--config', MISSING_CONFIG, '--crt']);
    const mode = options.cliOverrides.find(o => o.key === 'video_postprocessing_mode');
    expect(mode).toEqual({ key: 'video_postprocessing_mode', value: 'crt', flag: '--crt' });
  });

  it('locks custom mode and the specific effect key for an individual effect flag', () => {
    const options = parseArgs(['--config', MISSING_CONFIG, '--gamma', '2.0']);
    const keys = options.cliOverrides.map(o => o.key);
    expect(keys).toContain('video_postprocessing_mode');
    expect(options.cliOverrides.find(o => o.key === 'video_postprocessing_mode')?.value).toBe('custom');
    expect(options.cliOverrides.find(o => o.key === 'video_gamma'))
      .toEqual({ key: 'video_gamma', value: 2.0, flag: '--gamma' });
  });

  it('records no post-processing override when no effect flag is passed', () => {
    const options = parseArgs(['--config', MISSING_CONFIG, '--native']);
    expect(options.cliOverrides.some(o => o.key === 'video_postprocessing_mode')).toBe(false);
  });
});

describe('remapDriverOverride', () => {
  it('rewrites a video_driver override value in place so a re-merge yields the fallback driver', () => {
    const overrides = [{ key: 'video_driver' as const, value: 'native', flag: '--native' }];
    remapDriverOverride(overrides, 'native', 'kitty');

    const config: Config = { ...DEFAULT_CONFIG, video_driver: 'terminal' };
    applyCliOverrides(config, overrides);

    expect(config.video_driver).toBe('kitty');
  });

  it('leaves other overrides untouched when the value does not match', () => {
    const overrides = [{ key: 'video_driver' as const, value: 'kitty', flag: '--kitty' }];
    remapDriverOverride(overrides, 'native', 'terminal');

    expect(overrides[0].value).toBe('kitty');
  });
});

describe('--no-audio', () => {
  it('mutes audio at runtime via SettingsManager, not just displaying OFF', () => {
    const options = parseArgs(['--config', MISSING_CONFIG, '--no-audio']);

    const config: Config = { ...DEFAULT_CONFIG };
    applyCliOverrides(config, options.cliOverrides);
    const sm = new SettingsManager(config);

    expect(sm.get('audioMuted')).toBe(true);
    // The Audio menu row (id audio_enable) must still lock.
    expect(options.cliOverrides.find(o => o.key === 'audio_enable')).toEqual({
      key: 'audio_enable', value: false, flag: '--no-audio',
    });
  });
});
