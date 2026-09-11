/** Occurrence-level search over message data, independent of mounted DOM. */
import type { Message } from "../api/types.js";
import { collectSearchBlocks } from "./block-text.js";
import { findOccurrences } from "./dom-text.js";

export interface Match {
  ordinal: number;
  blockKey: string;
  occurrence: number;
  start: number;
  end: number;
}

export interface SessionIndex {
  matches: Match[];
  byBlock: Map<string, number>;
  byOrdinal: Map<number, number>;
  total: number;
}

/**
 * Return chronological, non-overlapping matches using the shared text matcher.
 * Offsets are UTF-16 offsets in the block's rendered text. The input array and
 * its messages are never mutated; transcript visibility is deliberately absent.
 */
export function buildSessionIndex(
  messages: readonly Message[],
  query: string,
): SessionIndex {
  const index: SessionIndex = {
    matches: [],
    byBlock: new Map(),
    byOrdinal: new Map(),
    total: 0,
  };
  if (!query.trim()) return index;

  // The message store is normally ordered already. Keep that path linear.
  const ordered = messages.every((message, i) =>
    i === 0 || messages[i - 1]!.ordinal <= message.ordinal,
  ) ? messages : [...messages].sort((a, b) => a.ordinal - b.ordinal);

  for (const message of ordered) {
    for (const block of collectSearchBlocks(message)) {
      const occurrences = findOccurrences(block.text, query);
      if (!occurrences.length) continue;
      index.byBlock.set(block.key, occurrences.length);
      index.byOrdinal.set(
        block.ordinal,
        (index.byOrdinal.get(block.ordinal) ?? 0) + occurrences.length,
      );
      occurrences.forEach(({ start, end }, occurrence) => {
        index.matches.push({
          ordinal: block.ordinal,
          blockKey: block.key,
          occurrence,
          start,
          end,
        });
      });
    }
  }
  index.total = index.matches.length;
  return index;
}
