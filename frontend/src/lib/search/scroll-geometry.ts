/** Viewport-coordinate geometry for nested, independently scrolling blocks. */
export interface SearchRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function isRectWithin(target: SearchRect, viewport: SearchRect, padding = 0): boolean {
  return target.top >= viewport.top + padding && target.bottom <= viewport.bottom - padding &&
    target.left >= viewport.left + padding && target.right <= viewport.right - padding;
}

/** Both rectangles use viewport coordinates; their origins need not be zero. */
export function centeredOffset(
  currentOffset: number,
  targetStart: number,
  targetEnd: number,
  viewportStart: number,
  viewportEnd: number,
): number {
  return currentOffset + (targetStart + targetEnd - viewportStart - viewportEnd) / 2;
}

function viewportFor(element: HTMLElement): SearchRect {
  const rect = element.getBoundingClientRect();
  const top = rect.top + element.clientTop;
  const left = rect.left + element.clientLeft;
  return { top, left, bottom: top + element.clientHeight, right: left + element.clientWidth };
}

/** Move only clipped axes; a visible occurrence never causes recentering. */
export function revealInContainer(
  element: HTMLElement,
  readTarget: () => SearchRect,
  vertical = true,
  horizontal = true,
  scrollVertical: (offset: number) => void = (offset) => { element.scrollTop = offset; },
): boolean {
  const viewport = viewportFor(element);
  const target = readTarget();
  let moved = false;
  if (vertical && element.clientHeight > 0 &&
      (target.top < viewport.top || target.bottom > viewport.bottom)) {
    const offset = Math.max(0, Math.min(
      element.scrollHeight - element.clientHeight,
      centeredOffset(element.scrollTop, target.top, target.bottom, viewport.top, viewport.bottom),
    ));
    if (offset !== element.scrollTop) { scrollVertical(offset); moved = true; }
  }
  if (horizontal && element.clientWidth > 0 &&
      (target.left < viewport.left || target.right > viewport.right)) {
    const offset = Math.max(0, Math.min(
      element.scrollWidth - element.clientWidth,
      centeredOffset(element.scrollLeft, target.left, target.right, viewport.left, viewport.right),
    ));
    if (offset !== element.scrollLeft) { element.scrollLeft = offset; moved = true; }
  }
  return moved;
}

/** Reveal inner panes first so their clipped text has valid outer geometry. */
export function scrollNestedContainers(
  block: HTMLElement,
  root: HTMLElement,
  readTarget: () => SearchRect,
): boolean {
  if (!root.contains(block)) return false;
  let moved = false;
  for (let node: HTMLElement | null = block; node && node !== root; node = node.parentElement) {
    const style = getComputedStyle(node);
    const vertical = /^(auto|scroll|overlay)$/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    const horizontal = /^(auto|scroll|overlay)$/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
    if (vertical || horizontal) moved = revealInContainer(node, readTarget, vertical, horizontal) || moved;
  }
  return moved;
}
