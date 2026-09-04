import type { Session } from "../../api/types.js";
import type { PaletteSearchResult } from "../../stores/search.svelte.js";

/** Even a single character can be a useful archive query, especially in CJK. */
export function hasArchiveQuery(query: string): boolean {
  return query.trim().length > 0;
}

/** Retain the palette's fast short-query metadata matches alongside archive hits. */
export function mergePaletteResults(
  results: PaletteSearchResult[],
  sessions: Session[],
  query: string,
): PaletteSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q || [...q].length >= 3) return results;
  const seen = new Set(results.map((result) => result.session_id));
  const local = sessions.filter((session) => !seen.has(session.id) && [
    session.project, session.display_name, session.first_message,
  ].some((field) => field?.toLowerCase().includes(q))).slice(0, 10);
  return [...results, ...local.map((session): PaletteSearchResult => ({
    session_id: session.id,
    project: session.project,
    agent: session.agent,
    name: session.display_name || session.first_message || session.project,
    ordinal: -1,
    timestamp: session.ended_at ?? session.started_at ?? "",
    snippet: "",
    rank: 0,
    snippetFormat: "plain-text",
  }))];
}
