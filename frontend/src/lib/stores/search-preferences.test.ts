import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SearchService } from "../api/generated/index.js";
import { createSearchStore, SEARCH_SORT_STORAGE_KEY } from "./search.svelte.js";

vi.mock("../api/generated/index.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/generated/index.js")>(),
  SearchService: { getApiV1Search: vi.fn(), getApiV1SearchContent: vi.fn() },
}));
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); });
afterEach(() => vi.useRealTimers());

describe("search continuity", () => {
  it("preserves the query and sort while cancelling queued work", async () => {
    const store = createSearchStore(null);
    store.setSort("recency");
    store.search("量子编译", "project");
    store.pause();
    expect(store.query).toBe("量子编译");
    expect(store.project).toBe("project");
    expect(store.sort).toBe("recency");
    expect(store.results).toEqual([]);
    expect(store.isSearching).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(SearchService.getApiV1Search).not.toHaveBeenCalled();
    store.clear();
    expect(store.query).toBe("");
  });

  it("persists sort but does not write search text to preferences", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const store = createSearchStore(storage);
    store.setSort("recency");
    store.search("query text");
    store.pause();
    expect(createSearchStore(storage).sort).toBe("recency");
    expect([...values.entries()]).toEqual([[SEARCH_SORT_STORAGE_KEY, "recency"]]);
  });

  it("keeps working with blocked or invalid preference storage", () => {
    const storage = { getItem() { throw new Error("unavailable"); }, setItem() { throw new Error("unavailable"); } };
    const store = createSearchStore(storage);
    expect(store.sort).toBe("relevance");
    expect(() => store.setSort("recency")).not.toThrow();
    store.pause();
    expect(store.sort).toBe("recency");
    expect(createSearchStore({ getItem: () => "invalid", setItem() {} }).sort).toBe("relevance");
  });
});
