import { describe, expect, it } from "vite-plus/test";
import { CODE_PREVIEW_LINES, codeBlockView } from "./code-collapse.js";

const longCode = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
describe("optional code disclosure", () => {
  it("starts fully expanded, including very long blocks", () => {
    expect(codeBlockView(longCode, null, "")).toEqual({ canCollapse: true, collapsed: false });
  });
  it("only collapses after the user chooses it", () => {
    expect(codeBlockView(longCode, longCode, "").collapsed).toBe(true);
  });
  it("keeps search matches visible even in a manually collapsed block", () => {
    expect(codeBlockView(longCode, longCode, "line 99").collapsed).toBe(false);
  });
  it("expands when a reused component receives different content", () => {
    expect(codeBlockView(longCode + "\nnew", longCode, "").collapsed).toBe(false);
  });
  it("does not add a disclosure for short code", () => {
    const shortCode = Array(CODE_PREVIEW_LINES).fill("line").join("\n");
    expect(codeBlockView(shortCode, shortCode, "")).toEqual({ canCollapse: false, collapsed: false });
  });
});
