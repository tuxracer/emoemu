import { describe, it, expect } from 'vitest';
import { getOptionLock, postProcessingOptionIds } from '.';

describe('getOptionLock', () => {
  const flags = new Map([['video_driver', '--native'], ['video_postprocessing_mode', '--crt']]);

  it('locks a row whose config key is overridden, reporting the flag', () => {
    const keys = new Set(['video_driver']);
    expect(getOptionLock('video_driver', keys, flags)).toEqual({ locked: true, flag: '--native' });
  });

  it('leaves a non-overridden row unlocked', () => {
    const keys = new Set(['video_driver']);
    expect(getOptionLock('audio_enable', keys, flags)).toEqual({ locked: false });
  });

  it('locks every Post-Processing row when the mode is overridden', () => {
    const keys = new Set(['video_postprocessing_mode']);
    // A row that is a post-processing effect (present in the set) but not itself in keys:
    const anEffectId = [...postProcessingOptionIds].find(id => id !== 'video_postprocessing_mode');
    expect(anEffectId).toBeDefined();
    expect(getOptionLock(anEffectId!, keys, flags)).toEqual({ locked: true, flag: '--crt' });
  });
});
