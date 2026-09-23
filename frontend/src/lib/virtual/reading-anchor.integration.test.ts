// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { mount, tick, unmount } from "svelte";
import type { Virtualizer, VirtualizerOptions } from "@tanstack/virtual-core";
import VirtualizerTest from "./VirtualizerTest.svelte";
import { shouldAdjustTranscriptScroll } from "./transcript-anchor.js";

type Core = Virtualizer<HTMLElement, HTMLElement>;
type Options = VirtualizerOptions<HTMLElement, HTMLElement> & {
  preserveScrollAnchor: boolean;
  measureCacheKey?: string;
  shouldAdjustScrollPositionOnItemSizeChange?: Core["shouldAdjustScrollPositionOnItemSizeChange"];
};

// Real Svelte adapter and pinned TanStack core; jsdom supplies controlled geometry.
describe("reading preservation without implicit latest following", () => {
  let component: ReturnType<typeof mount> | undefined;
  afterEach(async () => {
    if (component) await unmount(component);
    component = undefined;
    document.body.innerHTML = "";
  });

  async function setup(top = 150, viewport = 100, preserve = true) {
    const el = document.createElement("div");
    document.body.append(el);
    el.scrollTop = top;
    let core: Core | undefined;
    let reportOffset: ((offset: number, scrolling: boolean) => void) | undefined;
    Object.defineProperties(el, {
      clientHeight: { value: viewport },
      scrollHeight: { get: () => core?.getTotalSize() ?? 400 },
    });
    function options(keys: readonly string[]): Options {
      return {
        count: keys.length,
        getItemKey: (index) => keys[index]!,
        getScrollElement: () => el,
        estimateSize: () => 100,
        // Deliberately pass end anchoring: preservation must disable its resize
        // following while leaving the generic adapter's opt-out behavior intact.
        anchorTo: "end",
        followOnAppend: false,
        preserveScrollAnchor: preserve,
        shouldAdjustScrollPositionOnItemSizeChange: shouldAdjustTranscriptScroll,
        observeElementRect: (_v, callback) => {
          callback({ width: 600, height: viewport });
          return () => {};
        },
        observeElementOffset: (_v, callback) => {
          reportOffset = callback;
          callback(el.scrollTop, false);
          return () => { reportOffset = undefined; };
        },
        scrollToFn: (offset, { adjustments = 0 }) => {
          el.scrollTop = Math.max(0, Math.min(offset + adjustments, el.scrollHeight - viewport));
          reportOffset?.(el.scrollTop, false);
        },
      };
    }
    component = mount(VirtualizerTest, {
      target: document.body,
      props: {
        type: "element",
        options: options(["a", "b", "c", "d"]),
        onInstanceChange: (value: Core | undefined) => { core = value; },
      },
    });
    await tick();
    const v = component.getVirtualizer().instance as Core;
    for (let index = 0; index < 4; index++) v.resizeItem(index, 100);
    await tick();
    return { el, v, options };
  }

  it("preserves b at +50 through an interior swap with unchanged edge keys", async () => {
    const { el, v, options } = await setup();
    component!.setOptions(options(["a", "c", "b", "d"]));
    await tick();
    expect(el.scrollTop).toBe(250);
    expect(v.scrollOffset).toBe(250);
    const row = v.getVirtualItemForOffset(v.scrollOffset!)!;
    expect(row.key).toBe("b");
    expect(v.scrollOffset! - row.start).toBe(50);
  });

  it("invalidates positions when a stable key extractor changes its interior order", async () => {
    const { el, v, options } = await setup();
    const keys = ["a", "b", "c", "d"];
    const getItemKey = (index: number) => keys[index]!;
    component!.setOptions({ ...options(keys), getItemKey });
    await tick();
    keys.splice(1, 2, "c", "b");
    component!.setOptions({ ...options(keys), getItemKey });
    await tick();
    expect(el.scrollTop).toBe(250);
    expect(v.getVirtualItemForOffset(v.scrollOffset!)!.key).toBe("b");
  });

  it("keeps the latest reading anchor across multiple updates in one flush", async () => {
    const { el, v, options } = await setup();
    component!.setOptions(options(["a", "c", "b", "d"]));
    component!.setOptions(options(["a", "d", "b", "c"]));
    await tick();
    expect(el.scrollTop).toBe(250);
    expect(v.getVirtualItemForOffset(v.scrollOffset!)!.key).toBe("b");
  });

  it("preserves a surviving successor after the current row is deleted", async () => {
    const { el, v, options } = await setup();
    component!.setOptions(options(["a", "c", "d"]));
    await tick();
    v.getTotalSize();
    const successor = v.measurementsCache.find((row) => row.key === "c")!;
    expect(successor.start - el.scrollTop).toBe(50);
    expect(v.scrollOffset).toBe(el.scrollTop);
  });

  it("does not follow streaming growth when already at the bottom", async () => {
    const { el, v } = await setup(300);
    for (const height of [200, 350, 550]) {
      v.resizeItem(3, height);
      await tick();
      expect(el.scrollTop).toBe(300);
      expect(v.scrollOffset).toBe(300);
    }
  });

  it("does not follow when previously fitting content starts to overflow", async () => {
    const { el, v } = await setup(0, 500);
    v.resizeItem(3, 450);
    await tick();
    expect(v.getTotalSize()).toBe(750);
    expect(el.scrollTop).toBe(0);
    expect(v.scrollOffset).toBe(0);
  });

  it("still preserves the reader on prepend at the bottom", async () => {
    const { el, v, options } = await setup(300);
    component!.setOptions(options(["new", "a", "b", "c", "d"]));
    await tick();
    expect(el.scrollTop).toBe(400);
    expect(v.getVirtualItemForOffset(v.scrollOffset!)!.key).toBe("d");
  });

  it("clamps an unreachable reading anchor after trimming the tail", async () => {
    const { el, v, options } = await setup(350, 50);
    component!.setOptions(options(["a", "b"]));
    await tick();
    expect(el.scrollTop).toBe(150);
    expect(v.scrollOffset).toBe(150);
    expect(v.getVirtualItems().length).toBeGreaterThan(0);
  });

  it("discards the previous anchor on session reset and full replacement", async () => {
    const { el, v, options } = await setup();
    component!.setOptions({ ...options(["x", "y"]), measureCacheKey: "next-session" });
    await tick();
    expect(el.scrollTop).toBe(0);
    expect(v.scrollOffset).toBe(0);
    component!.setOptions(options([]));
    await tick();
    expect(el.scrollTop).toBe(0);
    expect(v.getVirtualItems()).toEqual([]);
  });

  it("retains native end-following for callers that do not opt into preservation", async () => {
    const { el, v } = await setup(300, 100, false);
    v.resizeItem(3, 200);
    await tick();
    expect(el.scrollTop).toBe(400);
  });
});
