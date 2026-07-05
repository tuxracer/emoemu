/** Articles that can appear at end of title (case-insensitive matching) */
export const TRAILING_ARTICLES = ['The', 'A', 'An'];

/** Words that should be lowercase in title case (unless first word) */
export const LOWERCASE_WORDS = new Set([
  'a', 'an', 'the',           // articles
  'and', 'but', 'or', 'nor',  // conjunctions
  'for', 'yet', 'so',         // FANBOYS conjunctions
  'at', 'by', 'in', 'of',     // short prepositions
  'on', 'to', 'up', 'as',
  'vs', 'vs.',                // versus
]);

/** Roman numeral pattern (I, II, III, IV, V, etc.) */
export const ROMAN_NUMERAL_PATTERN = /^(M{0,3})(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i;
