export type SidebarEmptyState =
  | "none"
  | "no-sessions"
  | "no-results";

/** Decide whether the sidebar needs an empty-state recovery surface. */
export function getSidebarEmptyState(
  itemCount: number,
  loading: boolean,
  hasActiveFilters: boolean,
): SidebarEmptyState {
  if (loading || itemCount > 0) return "none";
  return hasActiveFilters ? "no-results" : "no-sessions";
}
