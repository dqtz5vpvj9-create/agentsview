<script lang="ts">
  import type { Snippet } from "svelte";
  import type { DisplayItem } from "../../utils/display-items.js";
  import { inSessionSearch } from "../../stores/inSessionSearch.svelte.js";
  import SessionFindBar from "./SessionFindBar.svelte";
  import FindOverviewRail from "./FindOverviewRail.svelte";

  interface Props {
    children: Snippet;
    items: DisplayItem[];
    totalSize: number;
    newestFirst: boolean;
    rowOffset: (index: number) => number;
  }
  let { children, items, totalSize, newestFirst, rowOffset }: Props = $props();
</script>

<SessionFindBar />
<div class="session-find-transcript" class:has-find-results={inSessionSearch.isActive && inSessionSearch.total > 0}>
  {@render children()}
  {#if inSessionSearch.isActive && inSessionSearch.total > 0}
    <FindOverviewRail {items} {totalSize} {newestFirst} {rowOffset} />
  {/if}
</div>

<style>
  .session-find-transcript { flex: 1; min-height: 0; min-width: 0; position: relative; display: flex; flex-direction: column; }
  .session-find-transcript.has-find-results { padding-right: 16px; }
</style>
