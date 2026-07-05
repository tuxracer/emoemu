import type { ThumbnailType } from '.';

/**
 * Characters that must be replaced with underscore in RetroArch thumbnail filenames.
 * These characters are not allowed in playlist labels used as filenames:
 * & * / : < > ? \ | "
 */
export const THUMBNAIL_FORBIDDEN_CHARS = /[&*\/:<>?\\|"]/g;

/** Directory names for each thumbnail type (RetroArch-compatible) */
export const THUMBNAIL_TYPE_DIRS: Record<ThumbnailType, string> = {
  boxart: 'Named_Boxarts',
  snap: 'Named_Snaps',
  title: 'Named_Titles',
};

/** All thumbnail types in display priority order (snap > title > boxart) */
export const THUMBNAIL_TYPES: ThumbnailType[] = ['snap', 'title', 'boxart'];
