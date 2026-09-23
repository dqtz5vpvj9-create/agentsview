import { tick } from "svelte";
import type { Virtualizer } from "@tanstack/virtual-core";

interface RowMeasurement {
  virtualizer: Virtualizer<HTMLElement, HTMLElement> | undefined;
  index: number;
}

/** Register a row only after Svelte has committed its attributes and children. */
export function measureRow(node: HTMLElement, options: RowMeasurement) {
  let revision = 0;
  let destroyed = false;
  function update(next: RowMeasurement) {
    const current = ++revision;
    void tick().then(() => {
      if (destroyed || current !== revision || !node.isConnected) return;
      // Legacy action updates can precede sibling attributes and content.
      // Wait for that render, and discard any superseded index before the core
      // associates this retained node with a key or reads its current height.
      if (node.dataset.index !== String(next.index)) node.dataset.index = String(next.index);
      next.virtualizer?.measureElement(node);
    });
  }
  update(options);
  return {
    update,
    destroy() {
      destroyed = true;
      revision++;
    },
  };
}

/** Measure horizontal transcript rows in unscaled, fractional layout pixels. */
export function measureRowHeight(node: HTMLElement, entry?: ResizeObserverEntry): number {
  const observed = entry?.borderBoxSize?.[0]?.blockSize;
  if (observed !== undefined) return observed;

  // Client rectangles include CSS zoom and transforms; ResizeObserver and
  // scrollTop use layout pixels. The first synchronous measurement must use
  // the same units as later observer deliveries, without offsetHeight rounding.
  const style = node.ownerDocument.defaultView?.getComputedStyle(node);
  if (style?.height.endsWith("px")) {
    const height = Number.parseFloat(style.height);
    if (Number.isFinite(height)) {
      if (style.boxSizing === "border-box") return height;
      const extra = [
        style.paddingTop,
        style.paddingBottom,
        style.borderTopWidth,
        style.borderBottomWidth,
      ].reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0);
      return height + extra;
    }
  }
  return node.offsetHeight;
}
