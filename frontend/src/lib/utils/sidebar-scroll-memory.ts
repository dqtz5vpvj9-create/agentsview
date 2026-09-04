import {
  STORAGE_KEY_GROUP,
  type GroupMode,
} from "../components/sidebar/session-list-utils.js";

const SCROLL_KEY_PREFIX = "agentsview-sidebar-scroll";

export interface SidebarScrollStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SidebarScrollMemoryOptions {
  root?: Document;
  storage?: SidebarScrollStorage;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

function scrollKey(mode: GroupMode): string {
  return `${SCROLL_KEY_PREFIX}:${mode}`;
}

function currentGroupMode(storage: SidebarScrollStorage): GroupMode {
  try {
    const stored = storage.getItem(STORAGE_KEY_GROUP);
    if (stored === "agent" || stored === "project") return stored;
  } catch {
    // Storage is optional; ungrouped mode remains usable.
  }
  return "none";
}

/** Read a finite, non-negative saved scroll position. */
export function readSidebarScrollTop(
  mode: GroupMode,
  storage: SidebarScrollStorage,
): number {
  try {
    const value = Number(storage.getItem(scrollKey(mode)));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Persist a normalized scroll position for one grouping mode. */
export function writeSidebarScrollTop(
  mode: GroupMode,
  value: number,
  storage: SidebarScrollStorage,
): void {
  if (!Number.isFinite(value)) return;
  try {
    storage.setItem(
      scrollKey(mode),
      String(Math.max(0, Math.round(value))),
    );
  } catch {
    // Storage is optional; scrolling continues in memory.
  }
}

/**
 * Restore and persist the virtualized sidebar's scroll position. The
 * observer waits for the list's spacer height before restoring, and keeps
 * separate positions for ungrouped, agent, and project views.
 */
export function installSidebarScrollMemory(
  options: SidebarScrollMemoryOptions = {},
): () => void {
  if (typeof document === "undefined") return () => {};

  const root = options.root ?? document;
  const storage = options.storage ?? window.localStorage;
  const requestFrame = options.requestFrame ?? window.requestAnimationFrame.bind(window);
  const cancelFrame = options.cancelFrame ?? window.cancelAnimationFrame.bind(window);

  let scroller: HTMLElement | null = null;
  let scrollerObserver: MutationObserver | null = null;
  let scrollFrame: number | null = null;
  let activeMode: GroupMode = "none";
  let targetTop = 0;
  let restored = false;

  function flushScroll() {
    scrollFrame = null;
    if (!scroller) return;
    writeSidebarScrollTop(
      currentGroupMode(storage),
      scroller.scrollTop,
      storage,
    );
  }

  function handleScroll() {
    if (scrollFrame !== null) return;
    scrollFrame = requestFrame(flushScroll);
  }

  function syncMode() {
    const nextMode = currentGroupMode(storage);
    if (nextMode === activeMode) return;
    activeMode = nextMode;
    targetTop = readSidebarScrollTop(activeMode, storage);
    restored = targetTop === 0;
    if (restored && scroller) scroller.scrollTop = 0;
  }

  function attemptRestore() {
    if (!scroller || restored) return;
    syncMode();
    const maxTop = Math.max(
      0,
      scroller.scrollHeight - scroller.clientHeight,
    );
    if (maxTop === 0 && targetTop > 0) return;
    scroller.scrollTop = Math.min(targetTop, maxTop);
    restored = true;
  }

  function disconnectScroller() {
    if (scrollFrame !== null) {
      cancelFrame(scrollFrame);
      flushScroll();
    }
    scrollerObserver?.disconnect();
    scrollerObserver = null;
    scroller?.removeEventListener("scroll", handleScroll);
    scroller = null;
  }

  function connectScroller() {
    const next = root.querySelector<HTMLElement>(
      "#session-sidebar .session-list-scroll",
    );
    if (next === scroller) {
      syncMode();
      attemptRestore();
      return;
    }

    disconnectScroller();
    if (!next) return;

    scroller = next;
    activeMode = currentGroupMode(storage);
    targetTop = readSidebarScrollTop(activeMode, storage);
    restored = targetTop === 0;
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    scrollerObserver = new MutationObserver(() => {
      syncMode();
      attemptRestore();
    });
    scrollerObserver.observe(scroller, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    attemptRestore();
  }

  const rootObserver = new MutationObserver(connectScroller);
  rootObserver.observe(root.documentElement, {
    childList: true,
    subtree: true,
  });
  connectScroller();

  return () => {
    rootObserver.disconnect();
    disconnectScroller();
  };
}
