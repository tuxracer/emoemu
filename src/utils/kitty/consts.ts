// Kitty graphics protocol chunk size for base64 data
export const KITTY_CHUNK_SIZE = 4096;

// Detection timeout in ms
export const KITTY_GRAPHICS_DETECT_TIMEOUT_MS = 100;
export const KITTY_GRAPHICS_RESPONSE_CLEAR_DELAY_MS = 10;

// Kitty graphics protocol query - request image ID support
export const KITTY_GRAPHICS_QUERY = '\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\';

// Escape sequences for cursor visibility
export const HIDE_CURSOR = '\x1b[?25l';
export const SHOW_CURSOR = '\x1b[?25h';
