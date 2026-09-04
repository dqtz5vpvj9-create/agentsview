import { describe, expect, it } from "vite-plus/test";
import { GroupExpansionPreferences } from "./group-expansion.js";

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe("sidebar grouping continuity", () => {
  it("retains independent expanded groups across modes and reloads", () => {
    const storage = memoryStorage();
    const preferences = new GroupExpansionPreferences(storage);
    preferences.save("agent", new Set(["codex"]));
    preferences.save("project", new Set(["量子编译"]));
    preferences.setMode("project");
    const reopened = new GroupExpansionPreferences(storage);
    expect(reopened.mode()).toBe("project");
    expect([...reopened.expanded("agent")]).toEqual(["codex"]);
    expect([...reopened.expanded("project")]).toEqual(["量子编译"]);
  });
  it("remembers an explicitly collapsed group", () => {
    const storage = memoryStorage();
    const preferences = new GroupExpansionPreferences(storage);
    preferences.save("agent", new Set(["codex"]));
    preferences.save("agent", new Set());
    expect(new GroupExpansionPreferences(storage).expanded("agent").size).toBe(0);
  });
  it("does not resurrect a legacy grouping after the user turns it off", () => {
    const storage = memoryStorage();
    storage.setItem("agentsview-group-by-agent", "true");
    const preferences = new GroupExpansionPreferences(storage);
    expect(preferences.mode()).toBe("agent");
    preferences.setMode("none");
    expect(new GroupExpansionPreferences(storage).mode()).toBe("none");
  });
  it("keeps in-memory preferences when persistence is blocked", () => {
    const preferences = new GroupExpansionPreferences({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
    preferences.setMode("agent");
    preferences.save("agent", new Set(["codex"]));
    expect(preferences.mode()).toBe("agent");
    expect(preferences.expanded("agent").has("codex")).toBe(true);
  });
  it("ignores malformed data and returns independent set snapshots", () => {
    const storage = memoryStorage();
    storage.setItem("agentsview-expanded-groups-agent", "not json");
    const preferences = new GroupExpansionPreferences(storage);
    expect(preferences.expanded("agent").size).toBe(0);
    preferences.save("project", new Set(["project"]));
    preferences.expanded("project").clear();
    expect(preferences.expanded("project").has("project")).toBe(true);
  });
});
