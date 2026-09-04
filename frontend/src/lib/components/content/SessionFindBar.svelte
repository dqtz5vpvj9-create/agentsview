<script lang="ts">
  import { FindBar } from "@kenn-io/kit-ui";
  import { inSessionSearch } from "../../stores/inSessionSearch.svelte.js";
  import { m } from "../../i18n/index.js";

  let root: HTMLDivElement | undefined = $state(undefined);
  $effect(() => {
    const request = inSessionSearch.focusRequest;
    if (!inSessionSearch.isOpen || !root) return;
    void request;
    const input = root.querySelector<HTMLInputElement>(".kit-find-bar__input");
    input?.focus();
    input?.select();
  });
</script>

{#if inSessionSearch.isOpen}
  <div class="session-find" bind:this={root}>
    <FindBar
      bind:query={inSessionSearch.query}
      matchCount={inSessionSearch.total}
      currentIndex={inSessionSearch.currentIndex}
      onnext={() => inSessionSearch.next()}
      onprev={() => inSessionSearch.prev()}
      onclose={() => inSessionSearch.close()}
      placeholder={m.session_find_placeholder()}
      matchCountLabel={m.session_find_match_count({
        current: "{current}",
        total: "{total}",
      })}
      noMatchesLabel={m.session_find_no_results()}
      ariaLabel={m.session_find_find_in_session()}
      inputAriaLabel={m.session_find_search_query()}
      previousLabel={m.session_find_previous_match()}
      nextLabel={m.session_find_next_match()}
      closeLabel={m.session_find_close()}
    />
    {#if inSessionSearch.loadingHistory}
      <div class="history-status" role="status">{m.session_find_loading_history()}</div>
    {/if}
    <span class="kit-sr-only search-announcement" aria-live="polite" aria-atomic="true">
      {m.session_find_announce_match({ current: inSessionSearch.currentIndex + 1, total: inSessionSearch.total })}
    </span>
  </div>
{/if}

<style>
  .session-find { flex: 0 0 auto; min-width: 0; }
  .history-status { padding: 2px 12px 6px; font-size: 11px; color: var(--text-muted); }
</style>
