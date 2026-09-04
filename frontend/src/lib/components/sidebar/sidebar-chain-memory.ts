const CHAIN_MEMORY_KEY = "agentsview-sidebar-expanded-session-chains";
const MAX_SAVED_CHAINS = 300;

export interface SidebarChainStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Restore expanded parent, subagent, and team chain keys. */
export function readExpandedSessionChains(
  storage: SidebarChainStorage,
): Set<string> {
  try {
    const parsed = JSON.parse(storage.getItem(CHAIN_MEMORY_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .filter((key): key is string =>
          typeof key === "string" && key.length > 0 && key.length <= 1000
        )
        .slice(0, MAX_SAVED_CHAINS),
    );
  } catch {
    return new Set();
  }
}

/** Persist the currently expanded session-chain keys. */
export function writeExpandedSessionChains(
  keys: Iterable<string>,
  storage: SidebarChainStorage,
): void {
  const saved = [...new Set(keys)]
    .filter((key) => key.length > 0 && key.length <= 1000)
    .slice(0, MAX_SAVED_CHAINS);
  try {
    storage.setItem(CHAIN_MEMORY_KEY, JSON.stringify(saved));
  } catch {
    // Storage is optional; the current component state remains usable.
  }
}
