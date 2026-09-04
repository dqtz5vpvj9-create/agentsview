import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SearchService } from "../api/generated/index.js";
import { createSearchStore, type PaletteSearchResult } from "./search.svelte.js";

vi.mock("../api/generated/index.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/generated/index.js")>(),
  SearchService: { getApiV1Search: vi.fn(), getApiV1SearchContent: vi.fn() },
}));
const service = vi.mocked(SearchService);
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); });
afterEach(() => vi.useRealTimers());

describe("fresh search results", () => {
  it("removes stale hits and errors immediately, before the debounce fires", () => {
    const store = createSearchStore(null);
    store.results = [{ session_id: "old", ordinal: 7 } as PaletteSearchResult];
    store.error = { detail: "Earlier failure", kind: "generic" };
    store.search("new query");
    expect(store.results).toEqual([]);
    expect(store.error).toBeNull();
    expect(store.isSearching).toBe(true);
    expect(service.getApiV1Search).not.toHaveBeenCalled();
    store.clear();
  });

  it("does not let an old failure clear a replacement query's pending state", async () => {
    const store = createSearchStore(null);
    let reject!: (error: Error) => void;
    service.getApiV1Search.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }) as never);
    store.search("first");
    await vi.advanceTimersByTimeAsync(300);
    store.search("second");
    reject(new Error("stale request failed"));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.query).toBe("second");
    expect(store.isSearching).toBe(true);
    expect(store.error).toBeNull();
    expect(store.results).toEqual([]);
    store.clear();
  });

  it("clears old hits when changing sort, not only when typing", () => {
    const store = createSearchStore(null);
    service.getApiV1Search.mockImplementation(() => new Promise(() => {}) as never);
    store.query = "query";
    store.results = [{ session_id: "old" } as PaletteSearchResult];
    store.setSort("recency");
    expect(store.results).toEqual([]);
    expect(store.isSearching).toBe(true);
    store.clear();
  });

  it("cancels the loading state and queued request for whitespace", async () => {
    const store = createSearchStore(null);
    store.search("queued");
    store.search("  ");
    expect(store.isSearching).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(service.getApiV1Search).not.toHaveBeenCalled();
  });
});
