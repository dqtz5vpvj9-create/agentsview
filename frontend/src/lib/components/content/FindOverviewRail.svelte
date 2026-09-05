<script lang="ts">
  import { untrack } from "svelte";
  import type { DisplayItem } from "../../utils/display-items.js";
  import { collectSearchBlocks } from "../../search/block-text.js";
  import { nearestOverviewMatch, overviewLocations, overviewTicks, overviewY } from "../../search/overview.js";
  import { inSessionSearch } from "../../stores/inSessionSearch.svelte.js";
  import { m } from "../../i18n/index.js";

  interface Props {
    items: DisplayItem[];
    totalSize: number;
    newestFirst: boolean;
    rowOffset: (index: number) => number;
  }
  let { items, totalSize, newestFirst, rowOffset }: Props = $props();
  let canvas: HTMLCanvasElement | undefined = $state(undefined);
  let width = $state(0);
  let height = $state(0);
  let pixelRatio = $state(1);
  let themeVersion = $state(0);

  let locations = $derived.by(() => {
    const ordered = newestFirst ? [...items].reverse() : items;
    const matches = inSessionSearch.matches;
    const total = totalSize;
    return untrack(() => overviewLocations(ordered.map((item, index) => {
      const offset = rowOffset(index);
      const end = index + 1 < ordered.length ? rowOffset(index + 1) : total;
      const messages = item.kind === "message" ? [item.message]
        : newestFirst ? [...item.messages].reverse() : item.messages;
      return { offset, size: Math.max(1, end - offset), blocks: messages.flatMap(collectSearchBlocks) };
    }), matches));
  });

  $effect(() => {
    const node = canvas;
    if (!node) return;
    const measure = () => {
      width = node.clientWidth;
      height = node.clientHeight;
      pixelRatio = window.devicePixelRatio || 1;
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    window.addEventListener("resize", measure);
    const theme = new MutationObserver(() => { themeVersion++; });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-palette"] });
    return () => { resize.disconnect(); theme.disconnect(); window.removeEventListener("resize", measure); };
  });

  $effect(() => {
    const node = canvas;
    const points = locations;
    const total = totalSize;
    const current = inSessionSearch.resolvedCurrent;
    const w = width;
    const h = height;
    const ratio = pixelRatio;
    void themeVersion;
    if (!node || !w || !h) return;
    const frame = requestAnimationFrame(() => {
      node.width = Math.ceil(w * ratio);
      node.height = Math.ceil(h * ratio);
      const ctx = node.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const style = getComputedStyle(node);
      ctx.fillStyle = style.getPropertyValue("--accent-amber").trim() || style.color;
      for (const mark of overviewTicks(points, total, h)) ctx.fillRect(2, mark.y, Math.max(1, w - 4), mark.height);
      if (current) {
        const point = points.find(({ match }) => match.blockKey === current.blockKey && match.occurrence === current.occurrence);
        if (point) {
          ctx.fillStyle = style.color;
          ctx.fillRect(0, Math.max(0, Math.min(h - 4, overviewY(point.offset, total, h) - 2)), w, Math.min(4, h));
        }
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  function selectAt(event: MouseEvent) {
    if (!canvas || !totalSize) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.height) return;
    const offset = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * totalSize;
    const match = nearestOverviewMatch(locations, offset);
    if (match) inSessionSearch.goTo(match);
  }

  function navigate(event: KeyboardEvent) {
    if (!["ArrowUp", "ArrowDown", "Home", "End", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "ArrowUp") inSessionSearch.prev();
    else if (event.key === "ArrowDown") inSessionSearch.next();
    else if (event.key === "Home" || event.key === "End") {
      const match = event.key === "Home" ? locations[0]?.match : locations.at(-1)?.match;
      if (match) inSessionSearch.goTo(match);
    } else if (inSessionSearch.resolvedCurrent) inSessionSearch.goTo(inSessionSearch.resolvedCurrent);
  }
</script>

<!-- The canvas is a spatial control: pointer hit-testing and keyboard navigation select real occurrences. -->
<canvas class="find-overview-rail" bind:this={canvas}
  role="button" tabindex="0" aria-label={m.session_find_rail_label({ count: inSessionSearch.total })}
  onclick={selectAt} onkeydown={navigate}></canvas>

<style>
  .find-overview-rail {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    width: 12px;
    height: 100%;
    color: var(--accent-blue);
    cursor: pointer;
  }
</style>
