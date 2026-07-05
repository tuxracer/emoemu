/**
 * Shared input utilities for keyboard and gamepad handling.
 */

/**
 * Create a Map of opposite D-pad directions for preventing simultaneous
 * Up+Down or Left+Right presses.
 *
 * The returned map accepts any button type T for lookups, returning
 * the opposite direction if found, or undefined if not a directional button.
 *
 * @param Up - The up button value
 * @param Down - The down button value
 * @param Left - The left button value
 * @param Right - The right button value
 * @returns Map from each direction to its opposite
 */
export const createOppositeDirections = <T extends number>(
  Up: T,
  Down: T,
  Left: T,
  Right: T
): Map<T, T> => {
  // Create a Map with explicit type to allow any T as lookup key
  const map = new Map<T, T>();
  map.set(Up, Down);
  map.set(Down, Up);
  map.set(Left, Right);
  map.set(Right, Left);
  return map;
};
