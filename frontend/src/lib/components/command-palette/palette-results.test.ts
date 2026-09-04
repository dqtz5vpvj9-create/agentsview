import { describe, expect, it } from "vite-plus/test";
import type { Session } from "../../api/types.js";
import type { PaletteSearchResult } from "../../stores/search.svelte.js";
import { hasArchiveQuery, mergePaletteResults } from "./palette-results.js";

const session = { id: "local", project: "量子", agent: "codex", first_message: "Review", started_at: "" } as Session;
describe("short archive queries", () => {
  it.each(["量", "量子", "a", "AI", "  门  "])("searches nonempty query %s", (query) => {
    expect(hasArchiveQuery(query)).toBe(true);
  });
  it.each(["", " ", "\n\t"])("does not search whitespace %s", (query) => {
    expect(hasArchiveQuery(query)).toBe(false);
  });
  it("retains short local project matches while the archive is pending", () => {
    const results = mergePaletteResults([], [session], "量子");
    expect(results.map((result) => result.session_id)).toEqual(["local"]);
    expect(results[0]?.ordinal).toBe(-1);
  });
  it("prefers the archive message ordinal over a duplicate local match", () => {
    const hit = { session_id: "local", ordinal: 42 } as PaletteSearchResult;
    expect(mergePaletteResults([hit], [session], "量")).toEqual([hit]);
  });
  it("keeps ordinary long-query ordering unchanged and does not mutate inputs", () => {
    const results: PaletteSearchResult[] = [];
    expect(mergePaletteResults(results, [session], "Review")).toBe(results);
    mergePaletteResults(results, [session], "量");
    expect(results).toEqual([]);
  });
});
