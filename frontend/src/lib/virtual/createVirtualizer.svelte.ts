import { onDestroy, untrack } from "svelte";
import { observeFreshElementOffset, observeFreshWindowOffset } from "./observe-scroll-offset.js";
import { captureReadingAnchor, resolveReadingAnchor, clampReadingOffset, type ReadingAnchor } from "./reading-anchor.js";
import {
  Virtualizer,
  type VirtualizerOptions,
  type VirtualItem,
  observeElementRect,
  elementScroll,
  observeWindowRect,
  windowScroll,
  // kit-ui-check-ignore: the transcript needs TanStack's measurement and anchor controls.
} from "@tanstack/virtual-core";

type PartialKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

type AdapterOptions<TScroll extends Element | Window, TItem extends Element> = {
  measureCacheKey?: unknown;
  /** Preserve a reading key on order changes, without enabling implicit end-following. */
  preserveScrollAnchor?: boolean;
  shouldAdjustScrollPositionOnItemSizeChange?: Virtualizer<
    TScroll,
    TItem
  >["shouldAdjustScrollPositionOnItemSizeChange"];
};

type ElementOpts = PartialKeys<
  VirtualizerOptions<HTMLElement, HTMLElement>,
  "observeElementOffset" | "observeElementRect" | "scrollToFn"
> &
  AdapterOptions<HTMLElement, HTMLElement>;

type WindowOpts = PartialKeys<
  VirtualizerOptions<Window, HTMLElement>,
  "observeElementOffset" | "observeElementRect" | "scrollToFn" | "getScrollElement"
> &
  AdapterOptions<Window, HTMLElement>;

type BaseOpts<TScroll extends Element | Window, TItem extends Element> = VirtualizerOptions<
  TScroll,
  TItem
> &
  AdapterOptions<TScroll, TItem>;

function createBaseVirtualizer<TScroll extends Element | Window, TItem extends Element>(
  optsFn: () => BaseOpts<TScroll, TItem>,
) {
  let instance: Virtualizer<TScroll, TItem> | undefined;
  let dispose: (() => void) | undefined;
  let lastMeasureCacheKey: unknown;
  let resetScroll = false;
  let pendingReadingAnchor = false;
  let destroyed = false;
  let version = $state(0);

  function notify() {
    // Publishing is synchronous, just like the official Svelte adapter.
    // Never make an options effect depend on its own invalidation counter.
    if (!destroyed)
      untrack(() => {
        version += 1;
      });
  }

  $effect.pre(() => {
    const opts = optsFn();
    untrack(() => {
      const reset = instance !== undefined && opts.measureCacheKey !== lastMeasureCacheKey;
      const { preserveScrollAnchor, ...coreOpts } = opts;
      const getKey = opts.getItemKey ?? defaultItemKey;
      const orderedKeys = preserveScrollAnchor
        ? Array.from({ length: opts.count }, (_, index) => getKey(index))
        : undefined;
      let anchor: ReadingAnchor<VirtualItem["key"]> | null | undefined = undefined;
      // The old key extractor belongs to the old ordered message snapshot.
      // Read its measurements before setOptions replaces that snapshot.
      if (
        instance && !reset && preserveScrollAnchor && instance.options.enabled &&
        opts.enabled !== false && instance.scrollElement &&
        instance.scrollElement === opts.getScrollElement()
      ) {
        instance.getTotalSize();
        anchor = captureReadingAnchor(
          instance.measurementsCache,
          orderedKeys!,
          instance.scrollOffset ?? 0,
        );
      }
      if (!preserveScrollAnchor) pendingReadingAnchor = false;
      const resolved: VirtualizerOptions<TScroll, TItem> = {
        ...coreOpts,
        // Core end anchoring also follows streaming resizes at the bottom,
        // even with followOnAppend=false. The transcript owns following.
        ...(orderedKeys ? {
          anchorTo: "start" as const,
          followOnAppend: false,
          // A fresh snapshot also invalidates core positions when a caller
          // retains its key-extractor function across a same-count reorder.
          getItemKey: (index: number) => orderedKeys[index]!,
        } : {}),
        initialOffset: reset ? 0 : (instance?.scrollOffset ?? opts.initialOffset),
        onChange: (v, sync) => {
          if (destroyed) return;
          notify();
          opts.onChange?.(v, sync);
        },
      };
      if (!instance) {
        instance = new Virtualizer(resolved);
        dispose = instance._didMount();
      } else {
        instance.setOptions(resolved);
        if (reset) {
          instance.scrollOffset = 0;
          instance.measure();
          resetScroll = true;
          pendingReadingAnchor = false;
        } else if (anchor !== undefined) {
          instance.getTotalSize();
          // Publish the new range BEFORE rendering, then write scrollTop
          // after the sizer grows. Never clamp against the previous DOM.
          instance.scrollOffset = resolveReadingAnchor(anchor, instance.measurementsCache);
          instance.scrollAdjustments = 0;
          pendingReadingAnchor = true;
        }
      }
      // TanStack exposes this policy as an instance hook, not a core option.
      instance.shouldAdjustScrollPositionOnItemSizeChange =
        opts.shouldAdjustScrollPositionOnItemSizeChange;
      lastMeasureCacheKey = opts.measureCacheKey;
      // setOptions need not emit onChange when the visible range is unchanged.
      notify();
    });
  });

  $effect(() => {
    void version;
    untrack(() => {
      // Commit the sizer and row positions before applying scroll adjustments.
      instance?._willUpdate();
      if (resetScroll && instance?.scrollElement) {
        resetScroll = false;
        pendingReadingAnchor = false;
        instance.scrollToOffset(0);
      } else if (pendingReadingAnchor && instance?.scrollElement) {
        pendingReadingAnchor = false;
        const element = instance.scrollElement;
        const horizontal = instance.options.horizontal;
        const scrollSize = "document" in element
          ? element.document.documentElement[horizontal ? "scrollWidth" : "scrollHeight"]
          : element[horizontal ? "scrollWidth" : "scrollHeight"];
        const viewportSize = "document" in element
          ? element[horizontal ? "innerWidth" : "innerHeight"]
          : element[horizontal ? "clientWidth" : "clientHeight"];
        const target = clampReadingOffset(instance.scrollOffset ?? 0, scrollSize, viewportSize);
        const clamped = target !== instance.scrollOffset;
        instance.scrollOffset = target;
        // Use the configured writer without replacing a pending scrollToIndex
        // reconciliation. Explicit navigation remains the owner of its target.
        instance.options.scrollToFn(target, { behavior: "auto" }, instance);
        if (clamped) notify();
      }
    });
  });

  onDestroy(() => {
    destroyed = true;
    dispose?.();
  });

  return {
    get instance() {
      void version;
      return instance;
    },
  };
}

function defaultItemKey(index: number): string | number | bigint {
  return index;
}

export function createVirtualizer(optsFn: () => ElementOpts) {
  return createBaseVirtualizer<HTMLElement, HTMLElement>(() => {
    const opts = optsFn();
    const scrollEl = opts.getScrollElement?.() ?? null;
    return {
      observeElementOffset: observeFreshElementOffset,
      observeElementRect,
      scrollToFn: elementScroll,
      ...opts,
      initialOffset: scrollEl?.scrollTop ?? 0,
    };
  });
}

export function createWindowVirtualizer(optsFn: () => WindowOpts) {
  return createBaseVirtualizer<Window, HTMLElement>(() => ({
    observeElementOffset: observeFreshWindowOffset,
    observeElementRect: observeWindowRect,
    scrollToFn: windowScroll,
    getScrollElement: () => window,
    ...optsFn(),
    initialOffset: 0,
  }));
}
