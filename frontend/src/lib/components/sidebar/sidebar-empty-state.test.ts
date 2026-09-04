import { describe, expect, it } from "vite-plus/test";
import { getSidebarEmptyState } from "./sidebar-empty-state.js";

describe("getSidebarEmptyState", () => {
  it("stays hidden while loading or when rows exist", () => {
    expect(getSidebarEmptyState(0, true, true)).toBe("none");
    expect(getSidebarEmptyState(1, false, true)).toBe("none");
  });

  it("distinguishes an empty archive from filtered-out results", () => {
    expect(getSidebarEmptyState(0, false, false)).toBe("no-sessions");
    expect(getSidebarEmptyState(0, false, true)).toBe("no-results");
  });
});
