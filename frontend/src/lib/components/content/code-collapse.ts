/** Number of lines retained by the optional compact code view. */
export const CODE_PREVIEW_LINES = 24;

/** Compute disclosure state without allocating a second copy of a large block. */
export function codeBlockView(content: string, collapsedContent: string | null, query: string) {
  let lines = 1;
  for (let index = content.indexOf("\n"); index !== -1; index = content.indexOf("\n", index + 1)) {
    if (++lines > CODE_PREVIEW_LINES) break;
  }
  const canCollapse = lines > CODE_PREVIEW_LINES;
  return {
    canCollapse,
    // New content is expanded; a search must never be hidden by a disclosure.
    collapsed: canCollapse && collapsedContent === content && !query.trim(),
  };
}
