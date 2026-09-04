import { describe, expect, it } from "vite-plus/test";
import {
  readExpandedSidebarGroups,
  writeExpandedSidebarGroups,
  type SidebarGroupStorage,
} from "./sidebar-group-memory.js";

function memoryStorage(): SidebarGroupStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("sidebar group memory", () => {
  it("keeps agent and project expansion state independent", () => {
    const storage = memoryStorage();
    writeExpandedSidebarGroups("agent", ["Claude", "Codex"], storage);
    writeExpandedSidebarGroups("project", ["agentsview"], storage);

    expect([...readExpandedSidebarGroups("agent", storage)]).toEqual([
      "Claude",
      "Codex",
    ]);
    expect([...readExpandedSidebarGroups("project", storage)]).toEqual([
      "agentsview",
    ]);
    expect(readExpandedSidebarGroups("none", storage).size).toBe(0);
  });

  it("ignores malformed saved data and removes duplicates", () => {
    const storage = memoryStorage();
    writeExpandedSidebarGroups("agent", ["Claude", "Claude"], storage);
    expect([...readExpandedSidebarGroups("agent", storage)]).toEqual([
      "Claude",
    ]);

    storage.setItem("agentsview-sidebar-expanded-groups:project", "not-json");
    expect(readExpandedSidebarGroups("project", storage).size).toBe(0);
  });
});
