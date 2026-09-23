import { describe, expect, it } from "vite-plus/test";
import { captureReadingAnchor, resolveReadingAnchor, clampReadingOffset } from "./reading-anchor.js";

function layout(keys: readonly string[], heights: Record<string, number> = {}) {
  let start = 0;
  return keys.map((key) => {
    const row = { key, start };
    start += heights[key] ?? 100;
    return row;
  });
}

describe("reading anchors", () => {
  it("preserves an interior swap whose count and edge keys are unchanged", () => {
    const before = layout(["a", "b", "c", "d"]);
    const after = layout(["a", "c", "b", "d"]);
    const anchor = captureReadingAnchor(before, after.map((row) => row.key), 150);
    expect(anchor).toEqual({ key: "b", offset: 50 });
    expect(resolveReadingAnchor(anchor!, after)).toBe(250);
  });

  it("leaves same-order content updates to size-change compensation", () => {
    const rows = layout(["a", "b", "c", "d"]);
    expect(captureReadingAnchor(rows, ["a", "b", "c", "d"], 150)).toBeUndefined();
  });

  it("uses fractional measured heights for both sort directions", () => {
    const heights = { a: 101.25, b: 92.5, c: 153.75, d: 110.25 };
    for (const keys of [["a", "b", "c", "d"], ["d", "c", "b", "a"]]) {
      const before = layout(keys, heights);
      const next = [keys[0]!, keys[2]!, keys[1]!, keys[3]!];
      const after = layout(next, heights);
      const offset = before[1]!.start + 30.25;
      const anchor = captureReadingAnchor(before, next, offset)!;
      const target = resolveReadingAnchor(anchor, after);
      const row = after.find((item) => item.key === keys[1])!;
      expect(target - row.start).toBe(30.25);
    }
  });

  it("preserves a surviving successor's screen position when the reader's row is removed", () => {
    const next = ["a", "c", "d"];
    const anchor = captureReadingAnchor(layout(["a", "b", "c", "d"]), next, 150);
    expect(anchor).toEqual({ key: "c", offset: -50 });
    expect(resolveReadingAnchor(anchor!, layout(next))).toBe(50);
  });

  it("falls back to a surviving predecessor when there is no successor", () => {
    const anchor = captureReadingAnchor(layout(["a", "b", "c", "d"]), ["a", "b"], 350);
    expect(anchor).toEqual({ key: "b", offset: 250 });
    expect(clampReadingOffset(resolveReadingAnchor(anchor!, layout(["a", "b"])), 200, 100))
      .toBe(100);
  });

  it("resets replacement and empty lists with no surviving key", () => {
    const before = layout(["a", "b"]);
    for (const next of [[], ["x", "y"]]) {
      const anchor = captureReadingAnchor(before, next, 150);
      expect(anchor).toBeNull();
      expect(resolveReadingAnchor(anchor!, layout(next))).toBe(0);
    }
  });

  it("clamps only against the committed scroll extent", () => {
    expect(clampReadingOffset(450.25, 800.5, 100)).toBe(450.25);
    expect(clampReadingOffset(450.25, 300.5, 100)).toBe(200.5);
    expect(clampReadingOffset(20, 50, 100)).toBe(0);
    expect(clampReadingOffset(-5, 500, 100)).toBe(0);
  });
});
