/**
 * Application-wide constants
 */

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

/** Application version (e.g., "0.1.0") */
export const VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

/** Build date in YYYYMMDD format (e.g., "20260121") */
export const BUILD_DATE =
  typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : '';

/** Application version with build date (e.g., "0.1.0 (20260121)") */
export const VERSION_WITH_DATE = BUILD_DATE
  ? `${VERSION} (${BUILD_DATE})`
  : VERSION;
