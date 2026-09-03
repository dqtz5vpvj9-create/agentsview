/** A half-open character range in the original UTF-16 string. */
export interface TextOccurrence {
  start: number;
  end: number;
}

const SHOW_ELEMENT = 0x1;
const SHOW_TEXT = 0x4;

function appendNodeText(node: Node, parts: string[]): void {
  if (node.nodeType === 3) {
    parts.push(node.nodeValue ?? "");
    return;
  }
  if (
    node.nodeType === 1 &&
    (node as Element).tagName.toLowerCase() === "br"
  ) {
    parts.push("\n");
  }
}

/**
 * Return the searchable text represented by a rendered DOM subtree.
 *
 * Text nodes are concatenated in document order and line break elements are
 * represented by a newline. Element boundaries add no implicit separator.
 */
export function domText(root: Node): string {
  const document =
    root.nodeType === 9
      ? (root as Document)
      : root.ownerDocument;
  if (!document) return root.textContent ?? "";

  const parts: string[] = [];
  appendNodeText(root, parts);

  const walker = document.createTreeWalker(
    root,
    SHOW_ELEMENT | SHOW_TEXT,
  );
  let node = walker.nextNode();
  while (node) {
    appendNodeText(node, parts);
    node = walker.nextNode();
  }
  return parts.join("");
}

interface FoldedText {
  value: string;
  lengthChanged: boolean;
}

function fold(value: string): FoldedText {
  const parts: string[] = [];
  let lengthChanged = false;
  for (const codePoint of value) {
    const folded = codePoint.toLowerCase();
    parts.push(folded);
    if (folded.length !== codePoint.length) {
      lengthChanged = true;
    }
  }
  return { value: parts.join(""), lengthChanged };
}

function isCodePointBoundary(value: string, index: number): boolean {
  if (index <= 0 || index >= value.length) return true;
  const previous = value.charCodeAt(index - 1);
  const current = value.charCodeAt(index);
  return !(
    previous >= 0xd800 &&
    previous <= 0xdbff &&
    current >= 0xdc00 &&
    current <= 0xdfff
  );
}

function findFoldedOffsets(
  text: string,
  query: string,
): TextOccurrence[] {
  const occurrences: TextOccurrence[] = [];
  let cursor = 0;
  while (cursor <= text.length - query.length) {
    const start = text.indexOf(query, cursor);
    if (start < 0) break;
    const end = start + query.length;
    if (
      isCodePointBoundary(text, start) &&
      isCodePointBoundary(text, end)
    ) {
      occurrences.push({ start, end });
      cursor = end;
    } else {
      cursor = start + 1;
    }
  }
  return occurrences;
}

interface FoldedIndexMap {
  value: string;
  starts: number[];
  ends: number[];
}

function foldWithIndexMap(value: string): FoldedIndexMap {
  const parts: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let originalOffset = 0;

  for (const codePoint of value) {
    const folded = codePoint.toLowerCase();
    const originalEnd = originalOffset + codePoint.length;
    parts.push(folded);
    for (let i = 0; i < folded.length; i += 1) {
      starts.push(originalOffset);
      ends.push(originalEnd);
    }
    originalOffset = originalEnd;
  }

  return { value: parts.join(""), starts, ends };
}

/**
 * Find non-overlapping, case-insensitive occurrences from left to right.
 *
 * Matching lowercases each Unicode code point. Returned offsets always refer
 * to the original UTF-16 string and never divide a surrogate pair.
 */
export function findOccurrences(
  text: string,
  query: string,
): TextOccurrence[] {
  if (query.trim() === "") return [];

  const foldedQuery = fold(query).value;
  if (foldedQuery.length === 0) return [];

  const foldedText = fold(text);
  if (!foldedText.lengthChanged) {
    return findFoldedOffsets(foldedText.value, foldedQuery);
  }

  const mapped = foldWithIndexMap(text);
  const foldedOccurrences = findFoldedOffsets(
    mapped.value,
    foldedQuery,
  );
  const occurrences: TextOccurrence[] = [];
  let previousEnd = -1;

  for (const occurrence of foldedOccurrences) {
    const start = mapped.starts[occurrence.start];
    const end = mapped.ends[occurrence.end - 1];
    if (start === undefined || end === undefined || start < previousEnd) {
      continue;
    }
    occurrences.push({ start, end });
    previousEnd = end;
  }
  return occurrences;
}
