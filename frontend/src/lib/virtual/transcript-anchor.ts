import type { VirtualItem, Virtualizer } from "@tanstack/virtual-core";

/** Compensate changes entirely above the reading point, regardless of direction. */
export function shouldAdjustTranscriptScroll(
  item: VirtualItem,
  _delta: number,
  instance: Virtualizer<HTMLElement, HTMLElement>,
): boolean {
  const top = (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
  // Core may omit a cache entry when the first measured height exactly equals
  // the estimate. A missing entry must not make later streaming growth of the
  // partially visible reading row look like a prepend/first-measure correction.
  const previousHeight = instance.itemSizeCache.get(item.key) ?? item.size;
  return item.start + previousHeight <= top;
}
