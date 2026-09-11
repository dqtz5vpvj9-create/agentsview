<script module lang="ts">
  import type { SearchBlockState } from "../search-block.svelte.js";

  export interface FixtureProps extends SearchBlockState {
    blockKey: string;
    html: string;
  }

  export function reactiveProps(initial: FixtureProps): FixtureProps {
    const state = $state(initial);
    return state;
  }
</script>

<script lang="ts">
  import { searchBlock } from "../search-block.svelte.js";
  let props: FixtureProps = $props();
</script>

<div {@attach searchBlock(props.blockKey, () => props)}>{@html props.html}</div>
