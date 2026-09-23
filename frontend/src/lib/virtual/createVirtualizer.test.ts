// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mount, tick, unmount } from "svelte";
import VirtualizerTest from "./VirtualizerTest.svelte";

type Options = Record<string, unknown>;
interface FakeInstance {
  options: Options;
  scrollOffset?: number;
  itemSizeCache: Map<string, number>;
}
const state = vi.hoisted(() => ({
  instance: undefined as FakeInstance | undefined,
  dispose: vi.fn(),
  scroll: vi.fn(),
}));

// Intentionally silent setOptions: unchanged ranges do not guarantee onChange.
vi.mock("@tanstack/virtual-core", async () => ({
  ...await vi.importActual<typeof import("@tanstack/virtual-core")>("@tanstack/virtual-core"),
  Virtualizer: class implements FakeInstance {
    options: Options;
    scrollOffset?: number;
    itemSizeCache = new Map<string, number>();
    constructor(options: Options) {
      this.options = options;
      state.instance = this;
    }
    setOptions(options: Options) { this.options = options; }
    _willUpdate() {}
    _didMount() { return state.dispose; }
    measure() { this.itemSizeCache.clear(); }
    scrollToOffset = state.scroll;
  },
}));

describe("virtualizer adapter", () => {
  let component: ReturnType<typeof mount> | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    state.instance = undefined;
  });
  afterEach(async () => {
    if (component) await unmount(component);
    component = undefined;
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  async function setup(type: "element" | "window", options: Options) {
    const changed = vi.fn();
    component = mount(VirtualizerTest, {
      target: document.body,
      props: { type, options, onInstanceChange: changed },
    });
    await tick();
    return { changed, instance: state.instance! };
  }

  it.each([
    { type: "element" as const, top: 200, supplied: 999, expected: 200 },
    { type: "element" as const, top: 0, supplied: 500, expected: 0 },
    { type: "element" as const, top: null, supplied: 999, expected: 0 },
    { type: "window" as const, top: 200, supplied: 999, expected: 0 },
    { type: "window" as const, top: 0, supplied: 500, expected: 0 },
  ])("preserves initialOffset semantics: $type/$top", async ({ type, top, supplied, expected }) => {
    const el = document.createElement("div");
    el.scrollTop = top ?? 0;
    const { instance } = await setup(type, {
      count: 10,
      estimateSize: () => 50,
      getScrollElement: () => top === null ? null : el,
      initialOffset: supplied,
    });
    expect(instance.options.initialOffset).toBe(expected);
  });

  it.each([false, true])("publishes onChange(sync=%s) without a timer", async (sync) => {
    const { changed, instance } = await setup("element", {
      count: 10, getScrollElement: () => null, estimateSize: () => 50,
    });
    const initial = changed.mock.calls.length;
    (instance.options.onChange as (v: unknown, sync: boolean) => void)(instance, sync);
    await tick();
    expect(changed).toHaveBeenCalledTimes(initial + 1);
    expect(changed.mock.calls.at(-1)?.[0]).toBe(instance);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["element", "window"] as const)("publishes silent count and key changes: %s", async (type) => {
    const el = document.createElement("div");
    el.scrollTop = 150;
    const options = { count: 10, getScrollElement: () => el, estimateSize: () => 50 };
    const { changed, instance } = await setup(type, options);
    instance.scrollOffset = 150;
    instance.itemSizeCache.set("retained", 75);
    let calls = changed.mock.calls.length;
    for (const count of [11, 11, 9, 0]) {
      component!.setOptions({ ...options, count, getItemKey: (i: number) => `revision-${calls}-${i}` });
      await tick();
      expect(changed).toHaveBeenCalledTimes(++calls);
      expect(state.instance).toBe(instance);
      expect(instance.options.count).toBe(count);
      expect(instance.options.initialOffset).toBe(150);
      expect(instance.itemSizeCache.get("retained")).toBe(75);
    }
    expect(state.scroll).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disposes observers once and ignores a late notification after unmount", async () => {
    const { changed, instance } = await setup("element", {
      count: 10, getScrollElement: () => null, estimateSize: () => 50,
    });
    const onChange = instance.options.onChange as (v: unknown, sync: boolean) => void;
    await unmount(component!);
    component = undefined;
    const calls = changed.mock.calls.length;
    onChange(instance, true);
    await tick();
    expect(state.dispose).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
});
