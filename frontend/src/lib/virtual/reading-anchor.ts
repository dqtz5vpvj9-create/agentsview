/** A layout snapshot uses stable keys and unscaled CSS pixel coordinates. */
export interface ReadingRow<Key> {
  key: Key;
  start: number;
}

export interface ReadingAnchor<Key> {
  key: Key;
  offset: number;
}

/**
 * undefined: the order is unchanged; leave scrolling alone.
 * null: no previous row survives; start the replacement at the beginning.
 * Otherwise preserve a retained row's position, including interior reorders.
 */
export function captureReadingAnchor<Key>(
  previous: readonly ReadingRow<Key>[],
  nextKeys: readonly Key[],
  scrollOffset: number,
): ReadingAnchor<Key> | null | undefined {
  if (
    previous.length === nextKeys.length &&
    previous.every((row, index) => row.key === nextKeys[index])
  ) return undefined;
  if (previous.length === 0 || nextKeys.length === 0) return null;

  let index = previous.length - 1;
  while (index > 0 && previous[index]!.start > scrollOffset) index--;
  const retained = new Set(nextKeys);
  // Prefer the reader's row, then the next surviving row, then its predecessor.
  // Keep the replacement row's own screen position, not the deleted row's offset.
  for (let i = index; i < previous.length; i++) {
    const row = previous[i]!;
    if (retained.has(row.key)) return { key: row.key, offset: scrollOffset - row.start };
  }
  for (let i = index - 1; i >= 0; i--) {
    const row = previous[i]!;
    if (retained.has(row.key)) return { key: row.key, offset: scrollOffset - row.start };
  }
  return null;
}

/** Resolve against NEW measurements; do not clamp to the old DOM scrollHeight. */
export function resolveReadingAnchor<Key>(
  anchor: ReadingAnchor<Key> | null,
  rows: readonly ReadingRow<Key>[],
): number {
  if (anchor === null) return 0;
  const row = rows.find((item) => item.key === anchor.key);
  return row ? Math.max(0, row.start + anchor.offset) : 0;
}

/** The upper bound is valid only after the new sizer has committed to the DOM. */
export function clampReadingOffset(offset: number, scrollSize: number, viewportSize: number): number {
  return Math.max(0, Math.min(offset, Math.max(0, scrollSize - viewportSize)));
}
