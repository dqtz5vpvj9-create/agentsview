/** Bind mounted transcript blocks to the occurrence-level session search. */
import { inSessionSearch } from "../stores/inSessionSearch.svelte.js";
import { searchBlock as attachSearchBlock } from "./search-block.svelte.js";

export function searchBlock(key: string | undefined) {
  return attachSearchBlock(key, () => {
    const current = inSessionSearch.isCurrentBlock(key);
    // Re-selecting the only match is a new reveal too. It releases a manual
    // native-disclosure override without repainting every other mounted block.
    if (current) void inSessionSearch.currentSeq;
    return {
      query: inSessionSearch.isActive ? inSessionSearch.debouncedQuery : "",
      count: inSessionSearch.countForBlock(key),
      current,
      occurrence: inSessionSearch.currentOccurrence(key),
    };
  });
}
