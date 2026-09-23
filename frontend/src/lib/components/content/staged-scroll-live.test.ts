import { describe, expect, it, vi } from "vite-plus/test";
import { settleVirtualScroll } from "./staged-scroll.js";

describe("navigation during live refresh", () => {
  it("resolves the target message again after a prepend", async () => {
    let target = 2;
    let frames = 0;
    const virtualizer = {
      options: { count: 10 },
      getVirtualItems: () => frames >= 2 ? [{ index: target }] : [],
      getOffsetForIndex: vi.fn((index: number) => [index * 100, "start"] as const),
      scrollToOffset: vi.fn(),
      scrollToIndex: vi.fn(),
    };
    expect(await settleVirtualScroll({
      index: 2, getIndex: () => target, align: "start",
      getVirtualizer: () => virtualizer,
      getCount: () => virtualizer.options.count,
      isCurrent: () => true,
      nextFrame: async () => {
        frames++;
        target = 5;
        virtualizer.options.count = 13;
      },
    })).toBe(true);
    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(2, { align: "start" });
    expect(virtualizer.getOffsetForIndex).toHaveBeenCalledWith(5, "start");
    expect(virtualizer.scrollToOffset).toHaveBeenCalledWith(500, { align: "start" });
  });

  it("cancels when the target disappears instead of using its old index", async () => {
    let target = 2;
    const scroll = vi.fn();
    const virtualizer = {
      options: { count: 10 }, getVirtualItems: () => [],
      getOffsetForIndex: () => undefined,
      scrollToOffset: scroll, scrollToIndex: vi.fn(),
    };
    expect(await settleVirtualScroll({
      index: 2, getIndex: () => target, align: "start",
      getVirtualizer: () => virtualizer, getCount: () => 10,
      isCurrent: () => true, nextFrame: async () => { target = -1; },
    })).toBe(false);
    expect(scroll).not.toHaveBeenCalled();
    expect(virtualizer.scrollToIndex).toHaveBeenCalledTimes(1);
  });

  it("cancels after manual intent while a frame is pending", async () => {
    let current = true;
    const virtualizer = {
      options: { count: 10 }, getVirtualItems: () => [],
      getOffsetForIndex: () => undefined,
      scrollToOffset: vi.fn(), scrollToIndex: vi.fn(),
    };
    expect(await settleVirtualScroll({
      index: 2, align: "end",
      getVirtualizer: () => virtualizer, getCount: () => 10,
      isCurrent: () => current, nextFrame: async () => { current = false; },
    })).toBe(false);
    expect(virtualizer.scrollToOffset).not.toHaveBeenCalled();
    expect(virtualizer.scrollToIndex).toHaveBeenCalledTimes(1);
  });
});
