/**
 * Default core options for emoemu compatibility.
 *
 * Since emoemu is terminal-based and doesn't have GPU support, some cores
 * need specific options to work (e.g., software rendering for N64).
 * These defaults are applied automatically when creating a core.
 *
 * Keys are matched against the core's library name (case-insensitive).
 */
export const DEFAULT_CORE_OPTIONS: Record<string, Record<string, string>> = {
  // N64: Use Angrylion software renderer (no GPU required)
  // Also enable auto-crop to remove black borders many N64 games add
  'mupen64plus': {
    'mupen64plus-rdp-plugin': 'angrylion',
    'mupen64plus-rsp-plugin': 'cxd4',  // Required for Angrylion (HLE RSP won't work)
    'mupen64plus-cpucore': 'cached_interpreter',  // ARM64 doesn't have dynarec
    'mupen64plus-angrylion-multithread': 'all threads',
    'mupen64plus-aspect': '4:3',
    'mupen64plus-43screensize': '640x480',
    'mupen64plus-CropMode': 'Auto',
    // Angrylion VI settings (VI filter can cause black screen)
    'mupen64plus-angrylion-vioverlay': 'Filtered',
    'mupen64plus-angrylion-sync': 'Low',
    'mupen64plus-virefresh': 'Auto',
    // Disable frame duping to ensure we always get frames
    'mupen64plus-FrameDuping': 'False',
    // Controller pak (memory pak enables save support)
    'mupen64plus-pak1': 'memory',
    'mupen64plus-pak2': 'none',
    'mupen64plus-pak3': 'none',
    'mupen64plus-pak4': 'none',
    // Analog stick settings (deadzone 0 for full sensitivity)
    'mupen64plus-astick-deadzone': '0',
    'mupen64plus-astick-sensitivity': '100',
  },
};
