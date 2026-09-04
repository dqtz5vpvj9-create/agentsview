import { sessions } from "../stores/sessions.svelte.js";
import { starred } from "../stores/starred.svelte.js";

/** Return the inclusive range between two session ids in display order. */
export function sessionRange(
  orderedIds: string[],
  anchorId: string | null,
  targetId: string,
): string[] {
  const targetIndex = orderedIds.indexOf(targetId);
  if (targetIndex < 0) return [];
  if (!anchorId) return [targetId];

  const anchorIndex = orderedIds.indexOf(anchorId);
  if (anchorIndex < 0) return [targetId];

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return orderedIds.slice(start, end + 1);
}

function selectableSessionIds(): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const session of sessions.sessions) {
    if (starred.filterOnly && !starred.isStarred(session.id)) continue;
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    ids.push(session.id);
  }
  return ids;
}

/**
 * Add file-manager-style Shift-click selection to sidebar session rows.
 * The listener runs in capture phase so a range click never follows the
 * row link before multi-select can handle it.
 */
export function installSessionRangeSelection(): () => void {
  let anchorId: string | null = null;

  function handleClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const sidebar = target.closest("#session-sidebar");
    const row = target.closest<HTMLElement>("[data-session-id]");
    if (!sidebar || !row) return;

    const nestedControl = target.closest("button, input, select, textarea");
    if (
      nestedControl &&
      !nestedControl.classList.contains("select-checkbox")
    ) {
      return;
    }

    const targetId = row.dataset.sessionId;
    if (!targetId) return;

    if (!sessions.selectMode) {
      anchorId = null;
      return;
    }

    if (!event.shiftKey) {
      anchorId = targetId;
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const orderedIds = selectableSessionIds();
    const effectiveAnchor =
      anchorId && sessions.selectedIds.has(anchorId)
        ? anchorId
        : null;
    const rangeIds = sessionRange(
      orderedIds,
      effectiveAnchor,
      targetId,
    );
    sessions.selectAll([
      ...new Set([...sessions.selectedIds, ...rangeIds]),
    ]);
    anchorId ??= targetId;
  }

  document.addEventListener("click", handleClick, true);
  return () => document.removeEventListener("click", handleClick, true);
}
