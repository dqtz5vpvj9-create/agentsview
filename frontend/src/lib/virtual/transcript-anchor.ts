import type { VirtualItem, Virtualizer } from "@tanstack/virtual-core";

/** Compensate changes above the reader, including consecutive grow/shrink updates. */
export function shouldAdjustTranscriptScroll(
  item: VirtualItem,
  _delta: number,
  instance: Virtualizer<HTMLElement, HTMLElement>,
): boolean {
  const top = (instance.scrollOffset ?? 0) + instance.scrollAdjustments;
  const measured = instance.itemSizeCache.get(item.key);
  // A remeasurement of the row crossing the viewport changes content below
  // the reader. Only a first estimate or a fully preceding row needs correction.
  // The core's backward-direction suppression is unsuitable for live transcripts:
  // shrink compensation can itself report backward scrolling, then suppress the
  // next growth before scrollend and permanently move a stationary reader.
  return measured === undefined ? item.start < top : item.start + measured <= top;
}
