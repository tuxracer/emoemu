/**
 * ROM Label Formatting Utility
 *
 * Fixes common formatting issues in ROM titles:
 * - Converts ALL CAPS to Title Case
 * - Moves trailing articles (The, A, An) to the front
 */

import {
  TRAILING_ARTICLES,
  LOWERCASE_WORDS,
  ROMAN_NUMERAL_PATTERN,
} from './consts';
import { getSupportedExtensions } from '../../coreRegistry';

export * from './consts';

/**
 * Check if a word is a Roman numeral.
 */
const isRomanNumeral = (word: string): boolean => {
  const cleaned = word.replace(/[^a-zA-Z]/g, '');
  return cleaned.length > 0 && ROMAN_NUMERAL_PATTERN.test(cleaned);
};

/**
 * Check if a string is all uppercase (ignoring non-letter characters).
 * Returns false for strings with no letters.
 */
const isAllCaps = (str: string): boolean => {
  const letters = str.replace(/[^a-zA-Z]/g, '');
  return letters.length > 0 && letters === letters.toUpperCase();
};

/**
 * Capitalize the first letter of a word, preserving the rest.
 */
const capitalizeFirst = (word: string): string => {
  if (word.length === 0) { return word; }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
};

/**
 * Convert a string to title case.
 * - First word is always capitalized
 * - Articles, short prepositions, and conjunctions are lowercase (unless first word)
 * - Roman numerals stay uppercase
 */
const toTitleCase = (str: string): string => {
  const words = str.split(/(\s+)/); // Split but keep whitespace

  let isFirstWord = true;
  return words.map((segment) => {
    // Preserve whitespace segments
    if (/^\s+$/.test(segment)) {
      return segment;
    }

    const word = segment;
    const lowerWord = word.toLowerCase();

    // Roman numerals stay uppercase
    if (isRomanNumeral(word)) {
      isFirstWord = false;
      return word.toUpperCase();
    }

    // First word is always capitalized
    if (isFirstWord) {
      isFirstWord = false;
      return capitalizeFirst(word);
    }

    // Check if this word should stay lowercase
    if (LOWERCASE_WORDS.has(lowerWord)) {
      return lowerWord;
    }

    // Capitalize the word
    return capitalizeFirst(word);
  }).join('');
};

/**
 * Strip file extension from the end of a label (case-insensitive).
 * Uses extensions supported by loaded cores.
 * "Super Mario Bros.NES" -> "Super Mario Bros"
 */
const stripFileExtension = (str: string): string => {
  // Match any extension at the end (e.g., ".NES", ".nes", ".sfc")
  const match = str.match(/(\.[a-zA-Z0-9]+)$/);
  if (match) {
    const ext = match[1].toLowerCase();
    // Get supported extensions from loaded cores (already lowercase with dot)
    const supportedExtensions = new Set(getSupportedExtensions());
    if (supportedExtensions.has(ext)) {
      return str.slice(0, -ext.length).trim();
    }
  }
  return str;
};

/**
 * Move trailing articles to the front of the title.
 * "Legend of Zelda, The" -> "The Legend of Zelda"
 * "Legend of Zelda. The" -> "The Legend of Zelda"
 * "Boy and His Blob, A" -> "A Boy and His Blob"
 */
const moveTrailingArticle = (str: string): string => {
  for (const article of TRAILING_ARTICLES) {
    // Match ", The" or ". The" with any amount of whitespace (case insensitive)
    const pattern = new RegExp(`[,.]\\s*${article}\\s*$`, 'i');
    const match = str.match(pattern);
    if (match) {
      const withoutArticle = str.slice(0, match.index).trim();
      // Use the canonical article casing
      return `${article} ${withoutArticle}`;
    }
  }
  return str;
};

/**
 * Format a ROM label for display.
 * - Strips file extensions (.nes, .sfc, etc.)
 * - Replaces underscores with spaces
 * - Moves trailing articles (The, A, An) to the front
 * - Converts ALL CAPS titles to Title Case
 * - Normalizes whitespace
 */
export const formatRomLabel = (label: string): string => {
  let result = label.trim();

  // Strip file extension first
  result = stripFileExtension(result);

  // Replace underscores with spaces
  result = result.replace(/_/g, ' ');

  // Check if all caps BEFORE any transformations
  const wasAllCaps = isAllCaps(result);

  // Move trailing articles to front
  result = moveTrailingArticle(result);

  // Convert all caps to title case (based on original check)
  if (wasAllCaps) {
    result = toTitleCase(result);
  }

  // Normalize whitespace (collapse multiple spaces)
  result = result.replace(/\s+/g, ' ').trim();

  return result;
};
