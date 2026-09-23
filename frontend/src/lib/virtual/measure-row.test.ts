// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Virtualizer } from "@tanstack/virtual-core";
import { measureRow, measureRowHeight } from "./measure-row.js";

describe("transcript row layout height", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("retains fractional border-box sizes from ResizeObserver", () => {
    const node = document.createElement("div");
    const entry = { borderBoxSize: [{ blockSize: 107.375 }] } as unknown as ResizeObserverEntry;
    expect(measureRowHeight(node, entry)).toBe(107.375);
  });

  it.each([0.8, 1, 1.25, 1.5])("agrees with observer units at visual scale %s", (scale) => {
    const node = document.createElement("div");
    node.style.cssText = "box-sizing: border-box; height: 107.375px; padding: 5px 12px";
    document.body.append(node);
    const rect = vi
      .spyOn(node, "getBoundingClientRect")
      .mockReturnValue({ height: 107.375 * scale } as DOMRect);
    Object.defineProperty(node, "offsetHeight", { value: 107 });
    expect(measureRowHeight(node)).toBe(107.375);
    expect(rect).not.toHaveBeenCalled();
  });

  it("includes content-box padding and borders", () => {
    const node = document.createElement("div");
    node.style.cssText =
      "box-sizing: content-box; height: 90.5px; padding: 4.25px 0; border: 1px solid";
    document.body.append(node);
    expect(measureRowHeight(node)).toBe(101);
  });

  it("falls back to layout height when the used height is unavailable", () => {
    const node = document.createElement("div");
    Object.defineProperty(node, "offsetHeight", { value: 112 });
    expect(measureRowHeight(node)).toBe(112);
  });

  it("updates a retained node index before registering it after a prepend", () => {
    const node = document.createElement("div");
    const seen: string[] = [];
    const virtualizer = {
      measureElement: (element: HTMLElement) => seen.push(element.dataset.index!),
    } as unknown as Virtualizer<HTMLElement, HTMLElement>;
    const action = measureRow(node, { virtualizer, index: 4 });
    expect(node.dataset.index).toBe("4");
    action.update({ virtualizer, index: 5 });
    action.update({ virtualizer, index: 6 });
    expect(seen).toEqual(["4", "5", "6"]);
  });
});
