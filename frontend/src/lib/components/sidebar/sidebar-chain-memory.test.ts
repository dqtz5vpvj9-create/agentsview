import { describe, expect, it } from "vite-plus/test";
import {
  readExpandedSessionChains,
  writeExpandedSessionChains,
  type SidebarChainStorage,
} from "./sidebar-chain-memory.js";

function memoryStorage(): SidebarChainStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("sidebar session chain memory", () => {
  it("round-trips parent and subgroup expansion keys", () => {
    const storage = memoryStorage();
    writeExpandedSessionChains([
      "session-1",
      "subagent:session-1",
      "team:session-1",
    ], storage);

    expect([...readExpandedSessionChains(storage)]).toEqual([
      "session-1",
      "subagent:session-1",
      "team:session-1",
    ]);
  });

  it("deduplicates entries and ignores malformed storage", () => {
    const storage = memoryStorage();
    writeExpandedSessionChains(["session-1", "session-1"], storage);
    expect([...readExpandedSessionChains(storage)]).toEqual(["session-1"]);

    storage.setItem(
      "agentsview-sidebar-expanded-session-chains",
      "not-json",
    );
    expect(readExpandedSessionChains(storage).size).toBe(0);
  });
});
