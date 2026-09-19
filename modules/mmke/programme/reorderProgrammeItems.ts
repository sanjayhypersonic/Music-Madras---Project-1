// Pure ordering logic for Programme items (brief §4 — "the data model
// must support programmes containing multiple works and ordered items").
// No database, no framework. The repository layer loads the current
// items, calls these functions, and persists the resulting order values.

export interface OrderedProgrammeItem {
  id: string;
  order: number;
}

/**
 * The order value a newly-appended item should receive.
 */
export function computeNextOrder(existingItems: OrderedProgrammeItem[]): number {
  if (existingItems.length === 0) {
    return 1;
  }
  return Math.max(...existingItems.map((item) => item.order)) + 1;
}

/**
 * Moves the item with `movedItemId` to `targetIndex` (0-based) within the
 * given items (which may be in any order on input), and returns a new
 * array with every item's `order` renumbered contiguously from 1,
 * reflecting the new sequence. Does not mutate the input.
 */
export function reorderProgrammeItems<T extends OrderedProgrammeItem>(
  items: T[],
  movedItemId: string,
  targetIndex: number
): T[] {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const currentIndex = sorted.findIndex((item) => item.id === movedItemId);

  if (currentIndex === -1) {
    throw new Error(`Item ${movedItemId} is not part of this set of programme items.`);
  }

  const clampedTargetIndex = Math.max(0, Math.min(targetIndex, sorted.length - 1));

  const [moved] = sorted.splice(currentIndex, 1);
  sorted.splice(clampedTargetIndex, 0, moved);

  return sorted.map((item, index) => ({ ...item, order: index + 1 }));
}
