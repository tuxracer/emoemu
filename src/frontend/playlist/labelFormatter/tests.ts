/**
 * Tests for ROM label formatting utility
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatRomLabel } from '.';

// Mock the core registry to provide test extensions (lowercase, matching real behavior)
vi.mock('../../coreRegistry', () => ({
  getSupportedExtensions: () => ['.nes', '.sfc', '.md', '.gba', '.bin'],
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('formatRomLabel', () => {
  describe('trailing article handling', () => {
    it('moves "The" from end to beginning', () => {
      expect(formatRomLabel('Legend of Zelda, The')).toBe('The Legend of Zelda');
    });

    it('moves "A" from end to beginning', () => {
      expect(formatRomLabel('Boy and His Blob, A')).toBe('A Boy and His Blob');
    });

    it('moves "An" from end to beginning', () => {
      expect(formatRomLabel('American Tail, An')).toBe('An American Tail');
    });

    it('handles no space after comma', () => {
      expect(formatRomLabel('Legend of Zelda,The')).toBe('The Legend of Zelda');
    });

    it('handles multiple spaces after comma', () => {
      expect(formatRomLabel('Legend of Zelda,  The')).toBe('The Legend of Zelda');
      expect(formatRomLabel('Legend of Zelda,   The')).toBe('The Legend of Zelda');
    });

    it('handles period instead of comma', () => {
      expect(formatRomLabel('Legend of Zelda. The')).toBe('The Legend of Zelda');
      expect(formatRomLabel('Legend of Zelda.The')).toBe('The Legend of Zelda');
      expect(formatRomLabel('Legend of Zelda.   The')).toBe('The Legend of Zelda');
    });

    it('is case-insensitive for article matching', () => {
      expect(formatRomLabel('Legend of Zelda, THE')).toBe('The Legend of Zelda');
      expect(formatRomLabel('Legend of Zelda, the')).toBe('The Legend of Zelda');
    });

    it('does not modify titles without trailing articles', () => {
      expect(formatRomLabel('Super Mario Bros')).toBe('Super Mario Bros');
    });

    it('does not match articles in the middle', () => {
      expect(formatRomLabel('The Legend of Zelda')).toBe('The Legend of Zelda');
    });
  });

  describe('all caps to title case', () => {
    it('converts all caps to title case', () => {
      expect(formatRomLabel('THE LEGEND OF ZELDA')).toBe('The Legend of Zelda');
    });

    it('lowercases articles and prepositions in the middle', () => {
      expect(formatRomLabel('SUPER MARIO BROS')).toBe('Super Mario Bros');
      expect(formatRomLabel('STREETS OF RAGE')).toBe('Streets of Rage');
    });

    it('preserves Roman numerals', () => {
      expect(formatRomLabel('FINAL FANTASY III')).toBe('Final Fantasy III');
      expect(formatRomLabel('MEGA MAN II')).toBe('Mega Man II');
      expect(formatRomLabel('SUPER MARIO BROS IV')).toBe('Super Mario Bros IV');
    });

    it('does not modify mixed case titles', () => {
      expect(formatRomLabel('The Legend of Zelda')).toBe('The Legend of Zelda');
      expect(formatRomLabel('Super Mario Bros.')).toBe('Super Mario Bros.');
    });

    it('handles single word all caps', () => {
      expect(formatRomLabel('TETRIS')).toBe('Tetris');
    });
  });

  describe('combined transformations', () => {
    it('moves article and converts case', () => {
      expect(formatRomLabel('LEGEND OF ZELDA, THE')).toBe('The Legend of Zelda');
    });

    it('handles complex titles', () => {
      expect(formatRomLabel('ADVENTURES OF LOLO III, THE')).toBe('The Adventures of Lolo III');
    });
  });

  describe('file extension stripping', () => {
    it('strips .NES extension (uppercase)', () => {
      expect(formatRomLabel('The Legend of Zelda.NES')).toBe('The Legend of Zelda');
    });

    it('strips .nes extension (lowercase)', () => {
      expect(formatRomLabel('Super Mario Bros.nes')).toBe('Super Mario Bros');
    });

    it('strips various ROM extensions', () => {
      expect(formatRomLabel('Sonic.md')).toBe('Sonic');
      expect(formatRomLabel('Zelda.sfc')).toBe('Zelda');
      expect(formatRomLabel('Pokemon.gba')).toBe('Pokemon');
      expect(formatRomLabel('Game.bin')).toBe('Game');
    });

    it('strips extension and converts all caps', () => {
      expect(formatRomLabel('SUPER MARIO BROS.NES')).toBe('Super Mario Bros');
    });

    it('does not strip unknown extensions', () => {
      expect(formatRomLabel('Game.xyz')).toBe('Game.xyz');
    });

    it('handles extension with spaces before it', () => {
      expect(formatRomLabel('Super Mario Bros .nes')).toBe('Super Mario Bros');
    });
  });

  describe('underscore handling', () => {
    it('replaces underscores with spaces (mixed case preserved)', () => {
      expect(formatRomLabel('Super_Mario_Bros')).toBe('Super Mario Bros');
    });

    it('replaces underscores and converts all caps', () => {
      expect(formatRomLabel('SUPER_MARIO_ALL_STARS')).toBe('Super Mario All Stars');
    });

    it('handles multiple underscores', () => {
      expect(formatRomLabel('LEGEND__OF__ZELDA')).toBe('Legend of Zelda');
    });
  });

  describe('whitespace handling', () => {
    it('trims leading and trailing whitespace', () => {
      expect(formatRomLabel('  Super Mario Bros  ')).toBe('Super Mario Bros');
    });

    it('normalizes multiple spaces in the middle', () => {
      expect(formatRomLabel('Super  Mario   Bros')).toBe('Super Mario Bros');
      expect(formatRomLabel('Mario    Bros')).toBe('Mario Bros');
    });

    it('normalizes tabs and other whitespace', () => {
      expect(formatRomLabel('Super\tMario\t\tBros')).toBe('Super Mario Bros');
    });
  });
});
