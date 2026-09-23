import {
  observeElementOffset,
  observeWindowOffset,
  type VirtualizerOptions,
} from "@tanstack/virtual-core";

// A ResizeObserver compensation can write scrollTop after the last scroll
// event but before the core's scroll-end debounce fires. That debounce holds
// the previous event's offset. Read the DOM again on idle delivery so it cannot
// undo the compensation before the browser reports the next scroll event.
export const observeFreshElementOffset: VirtualizerOptions<
  HTMLElement,
  HTMLElement
>["observeElementOffset"] = (instance, callback) =>
  observeElementOffset(instance, (offset, scrolling) => {
    const element = instance.scrollElement;
    if (!scrolling && element) {
      offset = instance.options.horizontal
        ? element.scrollLeft * (instance.options.isRtl ? -1 : 1)
        : element.scrollTop;
    }
    callback(offset, scrolling);
  });

export const observeFreshWindowOffset: VirtualizerOptions<
  Window,
  HTMLElement
>["observeElementOffset"] = (instance, callback) =>
  observeWindowOffset(instance, (offset, scrolling) => {
    const element = instance.scrollElement;
    if (!scrolling && element) {
      offset = instance.options.horizontal ? element.scrollX : element.scrollY;
    }
    callback(offset, scrolling);
  });
