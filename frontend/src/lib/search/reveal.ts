/** Cancelable, bounded reveal of an occurrence inside a virtual transcript. */
import { currentRangeForBlock } from "./search-block.svelte.js";
import { revealInContainer, scrollNestedContainers, type SearchRect } from "./scroll-geometry.js";

export interface RevealOptions {
  ordinal: number;
  blockKey: string;
  getContainer(): HTMLElement | undefined;
  isCurrent(): boolean;
  ensureLoaded(ordinal: number): Promise<void>;
  mountMessage(): Promise<boolean>;
  scrollToOffset(offset: number): void;
  afterUpdate(): Promise<void>;
  nextFrame(): Promise<void>;
  readTargetRect?(block: HTMLElement): SearchRect;
}

/** Exact data equality avoids CSS escaping and cross-session document queries. */
export function findSearchBlock(root: HTMLElement, key: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-search-block]"))
    .find((element) => element.dataset.searchBlock === key);
}

function targetRect(block: HTMLElement): SearchRect {
  const range = currentRangeForBlock(block);
  if (range && typeof range.getBoundingClientRect === "function") {
    const rect = range.getBoundingClientRect();
    if (rect.width || rect.height) return rect;
  }
  return block.getBoundingClientRect();
}

export async function revealMatch(options: RevealOptions): Promise<boolean> {
  if (!options.isCurrent()) return false;
  await options.ensureLoaded(options.ordinal);
  if (!options.isCurrent()) return false;
  await options.afterUpdate();
  if (!options.isCurrent()) return false;
  let root = options.getContainer();
  if (!root) return false;

  // Do not jump back to the row start when the next occurrence is already
  // mounted. This matters for navigation inside a single tall code/output row.
  if (!findSearchBlock(root, options.blockKey)) {
    if (!await options.mountMessage() || !options.isCurrent()) return false;
  }
  await options.afterUpdate();
  await options.nextFrame();
  if (!options.isCurrent()) return false;

  let block: HTMLElement | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    root = options.getContainer();
    if (!root || !options.isCurrent()) return false;
    block = findSearchBlock(root, options.blockKey);
    if (block) break;
    if (attempt < 3) {
      await options.afterUpdate();
      await options.nextFrame();
    }
  }
  if (!root || !block) return false;

  const readRect = options.readTargetRect ?? targetRect;
  scrollNestedContainers(block, root, () => readRect(block!));
  revealInContainer(root, () => readRect(block!), true, false, options.scrollToOffset);

  // One recheck covers virtual-row height changes after expanding a block.
  await options.nextFrame();
  if (!options.isCurrent() || options.getContainer() !== root) return false;
  block = findSearchBlock(root, options.blockKey);
  if (!block) return false;
  scrollNestedContainers(block, root, () => readRect(block!));
  revealInContainer(root, () => readRect(block!), true, false, options.scrollToOffset);
  return true;
}
