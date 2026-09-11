import { describe, expect, it } from "vite-plus/test";

// Raw imports work in the same Vite/jsdom environment as the component tests.
// Exclude tests so this guard does not match its own legacy symbol assertions.
const sources = import.meta.glob<string>(
  ["../../**/*.{svelte,ts}", "!../../**/*.test.*"],
  { eager: true, query: "?raw", import: "default" },
);

describe("session find migration", () => {
  it("scans the production transcript sources", () => {
    expect(sources["../../lib/components/content/MessageContent.svelte"]).toBeTypeOf(
      "string",
    );
  });

  it("removes the DOM-rewriting search module", () => {
    expect(Object.keys(sources)).not.toContain("../../lib/utils/highlight.ts");
  });

  it("leaves no production imports of the removed module", () => {
    const obsolete = Object.entries(sources)
      .filter(([, source]) =>
        /(?:from\s*|import\s*\()\s*["'][^"']*\/highlight\.js["']/.test(source),
      )
      .map(([path]) => path);
    expect(obsolete).toEqual([]);
  });

  it("has no prop-driven mark painting in transcript components", () => {
    const obsolete = Object.entries(sources)
      .filter(([path, source]) =>
        path.startsWith("../../lib/components/content/") &&
        /\b(?:applyHighlight|applyMarks|clearMarks|highlightQuery|isCurrentHighlight)\b/.test(
          source,
        ),
      )
      .map(([path]) => path);
    expect(obsolete).toEqual([]);
  });
});
