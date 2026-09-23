// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { mount, tick, unmount } from "svelte";
import type { Virtualizer, VirtualizerOptions } from "@tanstack/virtual-core";
import VirtualizerTest from "./VirtualizerTest.svelte";
import { shouldAdjustTranscriptScroll } from "./transcript-anchor.js";

// Use the installed core, including its real size cache and prepend anchoring.
// Only browser geometry/scroll delivery are supplied by the jsdom fixture.
describe("virtualizer live updates with the real core", () => {
  let component: ReturnType<typeof mount> | undefined;
  afterEach(async () => {
    if (component) await unmount(component);
    component = undefined;
    document.body.innerHTML = "";
  });

  async function setup(initialTop: number) {
    const el = document.createElement("div");
    document.body.append(el);
    el.scrollTop = initialTop;
    Object.defineProperties(el, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 10000 },
    });
    let reportOffset: ((offset: number, scrolling: boolean) => void) | undefined;
    const views: number[] = [];
    function options(keys: readonly string[]): VirtualizerOptions<HTMLElement, HTMLElement> {
      return {
        count: keys.length,
        getItemKey: (i) => keys[i]!,
        getScrollElement: () => el,
        estimateSize: () => 100,
        anchorTo: "end",
        followOnAppend: false,
        observeElementRect: (_v, callback) => {
          callback({ width: 600, height: 100 });
          return () => {};
        },
        observeElementOffset: (_v, callback) => {
          reportOffset = callback;
          callback(el.scrollTop, false);
          return () => {
            reportOffset = undefined;
          };
        },
        scrollToFn: (offset, { adjustments = 0 }) => {
          el.scrollTop = offset + adjustments;
          reportOffset?.(el.scrollTop, false);
        },
      };
    }
    component = mount(VirtualizerTest, {
      target: document.body,
      props: {
        type: "element",
        options: options(["a", "b", "c", "d"]),
        onInstanceChange: (v: Virtualizer<HTMLElement, HTMLElement> | undefined) => {
          if (v) views.push(v.getTotalSize());
        },
      },
    });
    await tick();
    const v = component.getVirtualizer().instance as Virtualizer<HTMLElement, HTMLElement>;
    return { el, v, views, options };
  }

  it("publishes a new total when append leaves the visible range unchanged", async () => {
    const { el, views, options } = await setup(0);
    expect(views.at(-1)).toBe(400);
    component!.setOptions(options(["a", "b", "c", "d", "e"]));
    await tick();
    expect(views.at(-1)).toBe(500);
    expect(el.scrollTop).toBe(0);
  });

  it("preserves a measured key and intra-row offset on prepend", async () => {
    const { el, v, options } = await setup(150);
    v.resizeItem(0, 120);
    await tick();
    const before = v.getVirtualItemForOffset(v.scrollOffset!)!;
    const offsetWithinRow = v.scrollOffset! - before.start;
    expect(before.key).toBe("b");
    component!.setOptions(options(["new", "a", "b", "c", "d"]));
    await tick();
    const after = v.getVirtualItemForOffset(v.scrollOffset!)!;
    expect(after.key).toBe(before.key);
    expect(v.scrollOffset! - after.start).toBe(offsetWithinRow);
    expect(el.scrollTop).toBe(v.scrollOffset);
    expect(v.itemSizeCache.get("a")).toBe(120);
  });

  it("clears measurements and pending anchors when the session changes", async () => {
    const { el, v, options } = await setup(150);
    v.resizeItem(0, 180);
    await tick();
    component!.setOptions({
      ...options(["next-a", "next-b", "next-c", "next-d"]),
      measureCacheKey: "next-session",
    });
    await tick();
    expect(el.scrollTop).toBe(0);
    expect(v.scrollOffset).toBe(0);
    expect(v.getTotalSize()).toBe(400);
    expect(v.itemSizeCache.size).toBe(0);
  });

  it("preserves a measured key through same-count reorder and trim", async () => {
    const { v, options } = await setup(150);
    v.resizeItem(0, 120);
    await tick();
    const before = v.getVirtualItemForOffset(v.scrollOffset!)!;
    const within = v.scrollOffset! - before.start;
    for (const keys of [
      ["c", "a", "b", "d"],
      ["a", "b", "d"],
    ]) {
      component!.setOptions(options(keys));
      await tick();
      const after = v.getVirtualItemForOffset(v.scrollOffset!)!;
      expect(after.key).toBe(before.key);
      expect(v.scrollOffset! - after.start).toBe(within);
    }
  });

  it("keeps a reader anchored across rapid shrink/grow updates reported as backward scrolling", async () => {
    const { el, v, options } = await setup(150);
    component!.setOptions({
      ...options(["a", "b", "c", "d"]),
      shouldAdjustScrollPositionOnItemSizeChange: shouldAdjustTranscriptScroll,
    });
    await tick();
    for (const height of [180, 100, 220, 100]) {
      v.scrollDirection = "backward";
      v.resizeItem(0, height);
      await tick();
      const anchor = v.getVirtualItemForOffset(v.scrollOffset!)!;
      expect(anchor.key).toBe("b");
      expect(v.scrollOffset! - anchor.start).toBe(50);
      expect(el.scrollTop).toBe(v.scrollOffset);
    }
    // Streaming below a partially visible row's top must not drag the reader.
    v.resizeItem(1, 105);
    await tick();
    const top = v.scrollOffset;
    v.resizeItem(1, 500);
    await tick();
    expect(v.scrollOffset).toBe(top);
  });
});
