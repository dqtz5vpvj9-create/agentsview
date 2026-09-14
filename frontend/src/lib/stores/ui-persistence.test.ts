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
});
