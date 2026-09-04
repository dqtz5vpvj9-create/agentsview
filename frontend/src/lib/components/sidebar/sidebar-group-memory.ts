import type { GroupMode } from "./session-list-utils.js";

const GROUP_MEMORY_PREFIX = "agentsview-sidebar-expanded-groups";
const MAX_SAVED_GROUPS = 200;

export interface SidebarGroupStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storageKey(mode: Exclude<GroupMode, "none">): string {
  return `${GROUP_MEMORY_PREFIX}:${mode}`;
}

/** Restore the expanded labels for one grouped sidebar view. */
export function readExpandedSidebarGroups(
  mode: GroupMode,
  storage: SidebarGroupStorage,
): Set<string> {
  if (mode === "none") return new Set();
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(mode)) ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .filter((label): label is string =>
          typeof label === "string" && label.length > 0 && label.length <= 500
        )
        .slice(0, MAX_SAVED_GROUPS),
    );
  } catch {
    return new Set();
  }
}

/** Save expanded labels independently for agent and project grouping. */
export function writeExpandedSidebarGroups(
  mode: GroupMode,
  labels: Iterable<string>,
  storage: SidebarGroupStorage,
): void {
  if (mode === "none") return;
  const unique = [...new Set(labels)]
    .filter((label) => label.length > 0 && label.length <= 500)
    .slice(0, MAX_SAVED_GROUPS);
  try {
    storage.setItem(storageKey(mode), JSON.stringify(unique));
  } catch {
    // Storage is optional; the current component state remains usable.
  }
}
