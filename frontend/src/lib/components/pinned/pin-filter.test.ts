import { describe, expect, it } from "vite-plus/test";
import type { PinnedMessage } from "../../api/types.js";
import { filterPins, indexPins } from "./pin-filter.js";

const pins = [
  { id: 1, session_id: "session-a", content: "x".repeat(500) + "量子编译", session_project: "Compiler", session_agent: "codex" },
  { id: 2, session_id: "session-b", content: "Unicode ＡＩ example", session_display_name: "Notes" },
  { id: 3, session_id: "session-c", content: null },
] as PinnedMessage[];

describe("pinned message filtering", () => {
  it("finds content beyond the preview limit", () => {
    expect(filterPins(indexPins(pins), "量子编译").map((pin) => pin.id)).toEqual([1]);
  });
  it("matches multiple words across content and metadata", () => {
    expect(filterPins(indexPins(pins), "CODEX 量子").map((pin) => pin.id)).toEqual([1]);
    expect(filterPins(indexPins(pins), "codex missing")).toEqual([]);
  });
  it("normalizes full-width forms without changing stored content", () => {
    expect(filterPins(indexPins(pins), "ai")[0]?.content).toBe("Unicode ＡＩ example");
  });
  it("includes fallback session metadata for older pins", () => {
    expect(filterPins(indexPins(pins, (pin) => pin.id === 3 ? ["Legacy Project"] : []), "legacy")[0]?.id).toBe(3);
  });
  it("clearing the filter restores all pins in their original order", () => {
    expect(filterPins(indexPins(pins), " \n ")).toEqual(pins);
    expect(filterPins(indexPins([]), "query")).toEqual([]);
  });
});
