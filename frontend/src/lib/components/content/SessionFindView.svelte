<script lang="ts">
  import type { Snippet } from "svelte";
  import type { DisplayItem } from "../../utils/display-items.js";
  import SessionFindBar from "./SessionFindBar.svelte";

  interface Props {
    children: Snippet;
    items: DisplayItem[];
    totalSize: number;
    newestFirst: boolean;
    rowOffset: (index: number) => number;
  }
  let { children }: Props = $props();
</script>

<SessionFindBar />
{@render children()}
