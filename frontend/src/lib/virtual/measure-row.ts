import type { Virtualizer } from "@tanstack/virtual-core";

interface RowMeasurement {
  virtualizer: Virtualizer<HTMLElement, HTMLElement> | undefined;
  index: number;
}

/** Keep the element's index current before handing it to the core observer. */
export function measureRow(node: HTMLElement, options: RowMeasurement) {
  function update(next: RowMeasurement) {
    // Svelte can run an action update before the sibling attribute update.
    // Reading an old data-index after a prepend associates the retained node
    // with another key and can unobserve its neighbour permanently.
    if (node.dataset.index !== String(next.index)) node.dataset.index = String(next.index);
    next.virtualizer?.measureElement(node);
  }
  update(options);
  return { update };
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
