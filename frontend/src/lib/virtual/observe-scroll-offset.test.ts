// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Virtualizer } from "@tanstack/virtual-core";
import { observeFreshElementOffset, observeFreshWindowOffset } from "./observe-scroll-offset.js";

describe("scroll-end delivery after a layout compensation", () => {
  let dispose: (() => void) | void;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it.each([false, true])(
    "reads the current element offset on idle, horizontal=%s",
    (horizontal) => {
      vi.useFakeTimers();
      const element = document.createElement("div");
      document.body.append(element);
      const callback = vi.fn();
      const instance = {
        scrollElement: element,
        targetWindow: window,
        options: {
          horizontal,
          isRtl: horizontal,
          useScrollendEvent: false,
          isScrollingResetDelay: 150,
        },
      } as unknown as Virtualizer<HTMLElement, HTMLElement>;
      dispose = observeFreshElementOffset(instance, callback);
      if (horizontal) element.scrollLeft = -150;
      else element.scrollTop = 150;
      element.dispatchEvent(new Event("scroll"));
      expect(callback).toHaveBeenLastCalledWith(150, true);
      vi.advanceTimersByTime(149);
      // A compensation write has occurred, but its scroll event has not fired.
      if (horizontal) element.scrollLeft = -350;
      else element.scrollTop = 350;
      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenLastCalledWith(350, false);
    },
  );

  it("reads current window geometry on idle", () => {
    vi.useFakeTimers();
    const target = new EventTarget() as EventTarget & { scrollY: number };
    target.scrollY = 150;
    const callback = vi.fn();
    const instance = {
      scrollElement: target,
      targetWindow: window,
      options: { horizontal: false, useScrollendEvent: false, isScrollingResetDelay: 150 },
    } as unknown as Virtualizer<Window, HTMLElement>;
    dispose = observeFreshWindowOffset(instance, callback);
    target.dispatchEvent(new Event("scroll"));
    target.scrollY = 350;
    vi.advanceTimersByTime(150);
    expect(callback).toHaveBeenLastCalledWith(350, false);
  });

  it("cancels the pending idle delivery on disposal", () => {
    vi.useFakeTimers();
    const element = document.createElement("div");
    const callback = vi.fn();
    const instance = {
      scrollElement: element,
      targetWindow: window,
      options: { horizontal: false, useScrollendEvent: false, isScrollingResetDelay: 150 },
    } as unknown as Virtualizer<HTMLElement, HTMLElement>;
    dispose = observeFreshElementOffset(instance, callback);
    element.dispatchEvent(new Event("scroll"));
    dispose?.();
    dispose = undefined;
    vi.advanceTimersByTime(150);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
