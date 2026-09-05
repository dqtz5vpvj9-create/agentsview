<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
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
  let canvas: HTMLCanvasElement | undefined = $state();
  let height = $state(0);
  let paintFrame: number | null = null;

  const locations = $derived.by(() => {
    const source = newestFirst ? [...items].reverse() : items;
    const size = totalSize;
    // Scroll-offset reactivity must not schedule a canvas repaint. The model
    // changes only with items, order, query, measured total height or cursor.
    const readOffset = rowOffset;
    const offsets = untrack(() => source.map((_, index) => readOffset(index)));
    const rows = source.map((item, index) => {
      const messages = item.kind === "message" ? [item.message]
        : newestFirst ? [...item.messages].reverse() : item.messages;
      return {
        offset: offsets[index] ?? 0,
        size: Math.max(1, (offsets[index + 1] ?? size) - (offsets[index] ?? 0)),
        blocks: messages.flatMap(collectSearchBlocks),
      };
    });
    return overviewLocations(rows, inSessionSearch.matches);
  });

  function paint() {
    if (!canvas || height <= 0) return;
    const width = canvas.clientWidth;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const style = getComputedStyle(canvas);
    context.fillStyle = style.getPropertyValue("--accent-amber").trim() || style.color;
    for (const tick of overviewTicks(locations, totalSize, height)) context.fillRect(2, tick.y, Math.max(1, width - 4), tick.height);
    const current = inSessionSearch.resolvedCurrent;
    const active = current && locations.find(({ match }) => match.blockKey === current.blockKey && match.occurrence === current.occurrence);
    if (active) {
      context.fillStyle = style.getPropertyValue("--accent-blue").trim() || style.color;
      const tickHeight = Math.min(6, height);
      context.fillRect(0, Math.min(height - tickHeight, Math.max(0, overviewY(active.offset, totalSize, height) - tickHeight / 2)), width, tickHeight);
    }
  }
  function schedulePaint() {
    if (paintFrame !== null) return;
    paintFrame = requestAnimationFrame(() => { paintFrame = null; paint(); });
  }
  $effect(() => {
    void locations; void totalSize; void height; void inSessionSearch.resolvedCurrent;
    schedulePaint();
  });
  onMount(() => {
    if (!canvas) return;
    const resize = () => { height = canvas?.clientHeight ?? 0; schedulePaint(); };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const theme = new MutationObserver(schedulePaint);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    window.addEventListener("resize", resize);
    resize();
    return () => { observer.disconnect(); theme.disconnect(); window.removeEventListener("resize", resize); };
  });
  onDestroy(() => { if (paintFrame !== null) cancelAnimationFrame(paintFrame); });
  function choose(event: MouseEvent) {
    if (!canvas || height <= 0) return;
    const y = Math.max(0, Math.min(height, event.clientY - canvas.getBoundingClientRect().top));
    const match = nearestOverviewMatch(locations, y / height * totalSize);
    if (match) inSessionSearch.goTo(match);
  }
  function keydown(event: KeyboardEvent) {
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === "ArrowUp") inSessionSearch.previous();
      else if (event.key === "Home" || event.key === "End") {
        const match = event.key === "Home" ? locations[0]?.match : locations.at(-1)?.match;
        if (match) inSessionSearch.goTo(match);
      } else inSessionSearch.next();
    }
  }
</script>

<canvas
  class="find-overview-rail"
  bind:this={canvas}
  role="button"
  tabindex="0"
  aria-label={m.session_find_rail_label({ count: inSessionSearch.total })}
  onclick={choose}
  onkeydown={keydown}
></canvas>

<style>
  .find-overview-rail {
    width: 14px;
    height: 100%;
    position: absolute;
    inset: 0 0 0 auto;
    cursor: pointer;
    z-index: 1;
    background: color-mix(in srgb, var(--bg-surface) 70%, transparent);
  }
  .find-overview-rail:focus-visible { outline: 2px solid var(--accent-blue); outline-offset: -2px; }
</style>
