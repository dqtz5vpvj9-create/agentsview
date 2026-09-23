import { onDestroy, untrack } from "svelte";
import {
  Virtualizer,
  type VirtualizerOptions,
  observeElementOffset,
  observeElementRect,
  elementScroll,
  observeWindowOffset,
  observeWindowRect,
  windowScroll,
  // kit-ui-check-ignore: the transcript needs TanStack's measurement and anchor controls.
} from "@tanstack/virtual-core";

type PartialKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

type ElementOpts = PartialKeys<
  VirtualizerOptions<HTMLElement, HTMLElement>,
  "observeElementOffset" | "observeElementRect" | "scrollToFn"
> & { measureCacheKey?: unknown };

type WindowOpts = PartialKeys<
  VirtualizerOptions<Window, HTMLElement>,
  "observeElementOffset" | "observeElementRect" | "scrollToFn" | "getScrollElement"
> & { measureCacheKey?: unknown };

type BaseOpts<TScroll extends Element | Window, TItem extends Element> =
  VirtualizerOptions<TScroll, TItem> & { measureCacheKey?: unknown };

function createBaseVirtualizer<TScroll extends Element | Window, TItem extends Element>(
  optsFn: () => BaseOpts<TScroll, TItem>,
) {
  let instance: Virtualizer<TScroll, TItem> | undefined;
  let dispose: (() => void) | undefined;
  let lastMeasureCacheKey: unknown;
  let resetScroll = false;
  let destroyed = false;
  let version = $state(0);

  function notify() {
    // Publishing is synchronous, just like the official Svelte adapter.
    // Never make an options effect depend on its own invalidation counter.
    if (!destroyed) untrack(() => { version += 1; });
  }

  $effect.pre(() => {
    const opts = optsFn();
    untrack(() => {
      const reset = instance !== undefined && opts.measureCacheKey !== lastMeasureCacheKey;
      const resolved: VirtualizerOptions<TScroll, TItem> = {
        ...opts,
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
          // Use the public invalidation API so the core also rebuilds its
          // memoized measurements, even when the item count is unchanged.
          instance.scrollOffset = 0;
          instance.measure();
          resetScroll = true;
        }
      }
      lastMeasureCacheKey = opts.measureCacheKey;
      // setOptions need not emit onChange when the visible range is unchanged.
      // Publish the new count/key mapping before Svelte renders any rows.
      notify();
    });
  });

  $effect(() => {
    void version;
    untrack(() => {
      // Commit the sizer and row positions before applying the core's pending
      // anchor adjustment. An old scrollHeight could otherwise clamp it.
      instance?._willUpdate();
      if (resetScroll && instance?.scrollElement) {
        resetScroll = false;
        instance.scrollToOffset(0);
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

export function createVirtualizer(optsFn: () => ElementOpts) {
  return createBaseVirtualizer<HTMLElement, HTMLElement>(() => {
    const opts = optsFn();
    const scrollEl = opts.getScrollElement?.() ?? null;
    return {
      observeElementOffset,
      observeElementRect,
      scrollToFn: elementScroll,
      ...opts,
      initialOffset: scrollEl?.scrollTop ?? 0,
    };
  });
}

export function createWindowVirtualizer(optsFn: () => WindowOpts) {
  return createBaseVirtualizer<Window, HTMLElement>(() => ({
    observeElementOffset: observeWindowOffset,
    observeElementRect: observeWindowRect,
    scrollToFn: windowScroll,
    getScrollElement: () => window,
    ...optsFn(),
    initialOffset: 0,
  }));
}
