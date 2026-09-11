/** Bind mounted transcript blocks to the occurrence-level session search. */
import { inSessionSearch } from "../stores/inSessionSearch.svelte.js";
import { searchBlock as attachSearchBlock } from "./search-block.svelte.js";

export function searchBlock(key: string | undefined) {
  return attachSearchBlock(key, () => ({
    query: inSessionSearch.isActive ? inSessionSearch.debouncedQuery : "",
    count: inSessionSearch.countForBlock(key),
    current: inSessionSearch.isCurrentBlock(key),
    occurrence: inSessionSearch.currentOccurrence(key),
  }));
}
