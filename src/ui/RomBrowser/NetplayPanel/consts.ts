// Port number constants
export const PORT_MAX = 65535;
export const DECIMAL_BASE = 10;

// Input delay options for netplay
export const inputDelayOptions = [
  { value: 0, label: '0 (Lowest latency)' },
  { value: 1, label: '1' },
  { value: 2, label: '2 (Recommended)' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 8, label: '8 (High latency)' },
];

/** Delay before sending first discovery query (ms) */
export const DISCOVERY_INITIAL_DELAY_MS = 100;

/** Interval for sending discovery queries (ms) */
export const DISCOVERY_QUERY_INTERVAL_MS = 2000;

/** How long hosts are considered "alive" after last seen (ms) */
export const DISCOVERY_HOST_MAX_AGE_MS = 10000;
