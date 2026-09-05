import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
const root = fileURLToPath(new URL("../..", import.meta.url));
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : /\.(?:svelte|ts)$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}
describe("session find migration", () => {
  it("removes the DOM-rewriting search module", () => {
    expect(existsSync(join(root, "lib/utils/highlight.ts"))).toBe(false);
  });
  it("leaves no production imports of the removed module", () => {
    const obsolete = sources(root).filter((path) => /(?:from\s*|import\s*\()\s*["'][^"']*\/highlight\.js["']/.test(readFileSync(path, "utf8")));
    expect(obsolete).toEqual([]);
  });
  it("has no prop-driven mark painting in transcript components", () => {
    const obsolete = sources(join(root, "lib/components/content"))
      .filter((path) => /\b(?:applyHighlight|applyMarks|clearMarks|highlightQuery|isCurrentHighlight)\b/.test(readFileSync(path, "utf8")));
    expect(obsolete).toEqual([]);
  });
});
