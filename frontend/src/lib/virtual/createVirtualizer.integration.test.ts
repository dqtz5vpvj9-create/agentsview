// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { mount, tick, unmount } from "svelte";
import type { Virtualizer, VirtualizerOptions } from "@tanstack/virtual-core";
import VirtualizerTest from "./VirtualizerTest.svelte";

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
        count: keys.length, getItemKey: (i) => keys[i]!,
        getScrollElement: () => el, estimateSize: () => 100,
        anchorTo: "end", followOnAppend: false,
        observeElementRect: (_v, callback) => {
          callback({ width: 600, height: 100 });
          return () => {};
        },
        observeElementOffset: (_v, callback) => {
          reportOffset = callback;
          callback(el.scrollTop, false);
          return () => { reportOffset = undefined; };
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
        type: "element", options: options(["a", "b", "c", "d"]),
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
});
