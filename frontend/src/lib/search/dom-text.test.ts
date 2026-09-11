// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";
import { domText, findOccurrences } from "./dom-text.js";

describe("domText", () => {
  it("represents br elements as newlines", () => {
    const root = document.createElement("div");
    root.innerHTML = "first<br>second<br><br>fourth";

    expect(domText(root)).toBe("first\nsecond\n\nfourth");
  });

  it("concatenates sibling text nodes without separators", () => {
    const root = document.createElement("div");
    root.append("alpha");
    const span = document.createElement("span");
    span.textContent = "beta";
    root.append(span, "gamma");

    expect(domText(root)).toBe("alphabetagamma");
  });
});

describe("findOccurrences", () => {
  it("matches ASCII text without regard to case", () => {
    expect(findOccurrences("One ONE one", "oNe")).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 11 },
    ]);
  });

  it("maps length-changing lowercase folds to original offsets", () => {
    expect(findOccurrences("AİB", "i\u0307")).toEqual([
      { start: 1, end: 2 },
    ]);
    expect(findOccurrences("AİB", "i")).toEqual([
      { start: 1, end: 2 },
    ]);
  });

  it("preserves offsets for capital sharp s", () => {
    expect(findOccurrences("Straẞe", "straße")).toEqual([
      { start: 0, end: 6 },
    ]);
  });

  it("returns non-overlapping occurrences from left to right", () => {
    expect(findOccurrences("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("does not divide surrogate pairs", () => {
    expect(findOccurrences("a😀A😀", "😀")).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 6 },
    ]);
    expect(findOccurrences("😀", "\ude00")).toEqual([]);
  });

  it("returns no occurrences for an empty or blank query", () => {
    expect(findOccurrences("anything", "")).toEqual([]);
    expect(findOccurrences("anything", " \n\t ")).toEqual([]);
  });
});
