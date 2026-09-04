/** Reactive dependencies used by the local search store tests. */
import type { SearchMessageSource, SearchView } from "../inSessionSearch.svelte.js";

export function reactiveSource(initial: SearchMessageSource): SearchMessageSource {
  const source = $state(initial);
  return source;
}

export function reactiveView(initial: SearchView): SearchView {
  const view = $state(initial);
  return view;
}
