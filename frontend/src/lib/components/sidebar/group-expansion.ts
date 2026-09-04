import type { GroupMode } from "./session-list-utils.js";

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
const MODE_KEY = "agentsview-group-mode";
const LEGACY_KEY = "agentsview-group-by-agent";
const EXPANDED_PREFIX = "agentsview-expanded-groups-";

function availableStorage(): PreferenceStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Remember each grouping independently; unavailable storage never blocks navigation. */
export class GroupExpansionPreferences {
  private groups = new Map<GroupMode, Set<string>>();
  private currentMode: GroupMode = "none";

  constructor(private storage: PreferenceStorage | null = availableStorage()) {
    try {
      const value = storage?.getItem(MODE_KEY);
      if (value === "none" || value === "agent" || value === "project") {
        this.currentMode = value;
      } else if (storage?.getItem(LEGACY_KEY) === "true") {
        this.currentMode = "agent";
      }
    } catch {
      // Default mode remains usable without browser storage.
    }
  }

  mode(): GroupMode {
    return this.currentMode;
  }

  setMode(mode: GroupMode): void {
    this.currentMode = mode;
    try { this.storage?.setItem(MODE_KEY, mode); } catch { /* Keep the in-memory choice. */ }
  }

  expanded(mode: GroupMode): Set<string> {
    if (mode === "none") return new Set();
    if (!this.groups.has(mode)) {
      let values: string[] = [];
      try {
        const parsed: unknown = JSON.parse(this.storage?.getItem(EXPANDED_PREFIX + mode) ?? "[]");
        if (Array.isArray(parsed)) values = parsed.filter((value): value is string => typeof value === "string");
      } catch {
        // A malformed preference should not prevent the sidebar from opening.
      }
      this.groups.set(mode, new Set(values));
    }
    return new Set(this.groups.get(mode));
  }

  save(mode: GroupMode, expanded: ReadonlySet<string>): void {
    if (mode === "none") return;
    this.groups.set(mode, new Set(expanded));
    try {
      this.storage?.setItem(EXPANDED_PREFIX + mode, JSON.stringify([...expanded]));
    } catch {
      // The current sidebar still remembers choices while storage is unavailable.
    }
  }
}
