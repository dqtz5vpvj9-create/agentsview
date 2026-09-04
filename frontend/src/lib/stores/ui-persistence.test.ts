import { describe, expect, it, vi } from "vite-plus/test";
import { tick } from "svelte";

describe("UI persistence", () => {
  it("restores and persists the transcript sort order", async () => {
    const original = globalThis.localStorage;
    const values = new Map<string, string>([
      ["agentsview-sort-newest-first", "true"],
    ]);
    const setItem = vi.fn((key: string, value: string) => {
      values.set(key, value);
    });

    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem,
      },
      writable: true,
      configurable: true,
    });

    try {
      // @ts-expect-error -- query string gives this test a fresh singleton.
      const mod = await import("./ui.svelte.js?sortPreference");

      expect(mod.ui.sortNewestFirst).toBe(true);

      mod.ui.toggleSort();
      await tick();

      expect(values.get("agentsview-sort-newest-first")).toBe("false");
      expect(setItem).toHaveBeenCalledWith(
        "agentsview-sort-newest-first",
        "false",
      );
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        value: original,
        writable: true,
        configurable: true,
      });
    }
  });

  it("restores the desktop sidebar without letting mobile layout overwrite it", async () => {
    const originalStorage = globalThis.localStorage;
    const originalMatchMedia = window.matchMedia;
    const values = new Map<string, string>([
      ["agentsview-sidebar-open", "false"],
    ]);
    let viewportListener: ((event: MediaQueryListEvent) => void) | undefined;

    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn(() => ({
        matches: false,
        media: "(max-width: 760px)",
        onchange: null,
        addEventListener: (
          _type: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => {
          viewportListener = listener;
        },
        removeEventListener: vi.fn(),
        addListener: (
          listener: (event: MediaQueryListEvent) => void,
        ) => {
          viewportListener = listener;
        },
        removeListener: vi.fn(),
        dispatchEvent: () => true,
      })),
      writable: true,
      configurable: true,
    });

    try {
      // @ts-expect-error -- query string gives this test a fresh singleton.
      const mod = await import("./ui.svelte.js?sidebarPreference");

      expect(mod.ui.isMobileViewport).toBe(false);
      expect(mod.ui.sidebarOpen).toBe(false);

      mod.ui.toggleSidebar();
      await tick();
      expect(mod.ui.sidebarOpen).toBe(true);
      expect(values.get("agentsview-sidebar-open")).toBe("true");

      viewportListener?.({ matches: true } as MediaQueryListEvent);
      await tick();
      expect(mod.ui.isMobileViewport).toBe(true);
      expect(mod.ui.sidebarOpen).toBe(false);
      expect(values.get("agentsview-sidebar-open")).toBe("true");

      viewportListener?.({ matches: false } as MediaQueryListEvent);
      await tick();
      expect(mod.ui.isMobileViewport).toBe(false);
      expect(mod.ui.sidebarOpen).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        value: originalStorage,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, "matchMedia", {
        value: originalMatchMedia,
        writable: true,
        configurable: true,
      });
    }
  });
});
