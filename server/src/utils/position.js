/**
 * LexoRank-inspired floating-point position utilities for task ordering.
 *
 * This system uses fractional indexing to avoid rewriting all task positions on every move.
 * Instead of integer positions (1, 2, 3...), we use floating-point numbers that allow
 * insertion between any two existing positions by taking the midpoint.
 *
 * Initial positions: 1000, 2000, 3000...
 * Insert between two tasks: midpoint = (before + after) / 2
 * Rebalance when any gap < 1 (floating-point exhaustion)
 *
 * Example:
 * - Initial: [1000, 2000, 3000]
 * - Insert at position 1: (null + 1000) / 2 = 500 → [500, 1000, 2000, 3000]
 * - Insert between 1000 and 2000: (1000 + 2000) / 2 = 1500 → [500, 1000, 1500, 2000, 3000]
 * - After many inserts, gaps become < 1, trigger rebalance to redistribute evenly
 *
 * Advantages:
 * - O(1) insert operation (no mass updates)
 * - Handles concurrent moves gracefully (last-write-wins with position recalculation)
 * - Automatic rebalancing prevents floating-point exhaustion
 *
 * Trade-offs:
 * - Positions are floating-point, not human-readable integers
 * - Requires periodic rebalancing (handled automatically by needsRebalance check)
 */

const INITIAL_GAP = 1000;
const MIN_GAP = 1;

/**
 * Returns the midpoint position for inserting between two tasks.
 * @param {number|null} beforePos - Position of task before insertion point (null = beginning)
 * @param {number|null} afterPos  - Position of task after insertion point (null = end)
 * @returns {number}
 */
const getInsertPosition = (beforePos, afterPos) => {
  if (beforePos === null && afterPos === null) return INITIAL_GAP;
  if (beforePos === null) return afterPos - INITIAL_GAP;
  if (afterPos === null) return beforePos + INITIAL_GAP;
  return (beforePos + afterPos) / 2;
};

/**
 * Returns a position that places the task at the end of the list.
 * @param {number|null} lastPos - Current last task's position (null if column empty)
 * @returns {number}
 */
const getAppendPosition = (lastPos) => {
  if (lastPos === null || lastPos === undefined) return INITIAL_GAP;
  return lastPos + INITIAL_GAP;
};

/**
 * Returns true if any adjacent pair of tasks has a gap smaller than MIN_GAP.
 * This indicates floating-point exhaustion and triggers a rebalance operation.
 * @param {Array<{position: number}>} tasks - Sorted by position ascending
 * @returns {boolean}
 */
const needsRebalance = (tasks) => {
  if (tasks.length < 2) return false;
  const sorted = [...tasks].sort((a, b) => a.position - b.position);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].position - sorted[i - 1].position < MIN_GAP) return true;
  }
  return false;
};

/**
 * Redistributes tasks with evenly spaced positions (1000, 2000, 3000...).
 * This is called when floating-point gaps become too small (< MIN_GAP).
 * @param {Array<{position: number}>} tasks - Array of task objects
 * @returns {Array<{position: number}>} New array with updated positions
 */
const rebalance = (tasks) => {
  const sorted = [...tasks].sort((a, b) => a.position - b.position);
  return sorted.map((task, idx) => ({
    ...task,
    position: (idx + 1) * INITIAL_GAP,
  }));
};

module.exports = { getInsertPosition, getAppendPosition, needsRebalance, rebalance };
