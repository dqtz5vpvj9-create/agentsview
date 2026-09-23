import { describe, expect, it } from "vite-plus/test";
import type { VirtualItem, Virtualizer } from "@tanstack/virtual-core";
import { shouldAdjustTranscriptScroll } from "./transcript-anchor.js";

function instance(top: number, height?: number) {
  return {
    scrollOffset: top,
    scrollAdjustments: 0,
    scrollDirection: "backward",
    itemSizeCache: new Map(height === undefined ? [] : [["reader", height]]),
  } as unknown as Virtualizer<HTMLElement, HTMLElement>;
}
const row: VirtualItem = { key: "reader", index: 3, start: 300, size: 100, end: 400, lane: 0 };

describe("transcript size compensation", () => {
  it("does not move a partially visible row whose first measurement equalled its estimate", () => {
    expect(shouldAdjustTranscriptScroll(row, 100, instance(350))).toBe(false);
  });
  it("leaves a measured partially visible row anchored during both growth and shrink", () => {
    for (const delta of [100, -20]) {
      expect(shouldAdjustTranscriptScroll(row, delta, instance(350, 100))).toBe(false);
    }
  });
  it("compensates a fully preceding row even after a backward compensation", () => {
    for (const height of [undefined, 100]) {
      for (const delta of [100, -20]) {
        expect(shouldAdjustTranscriptScroll(row, delta, instance(450, height))).toBe(true);
      }
    }
  });
});
