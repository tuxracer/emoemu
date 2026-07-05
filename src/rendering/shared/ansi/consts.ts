// Escape character
export const ESC = '\x1b';

// Common sequences
export const RESET = '\x1b[0m';
export const HALF_BLOCK_TOP = '\u2580';    // Upper half block
export const HALF_BLOCK_BOTTOM = '\u2584'; // Lower half block
export const FULL_BLOCK = '\u2588';        // Full block

// Kitty graphics protocol
export const APC = `${ESC}_G`;  // Application Program Command for graphics
export const ST = `${ESC}\\`;   // String Terminator
