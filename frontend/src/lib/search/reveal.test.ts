// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { findSearchBlock, revealMatch, type RevealOptions } from "./reveal.js";

function setup(mounted = true) {
  const root = document.createElement("div");
  document.body.append(root);
  const block = document.createElement("pre");
  block.dataset.searchBlock = "7:tool-output:0";
  if (mounted) root.append(block);
  Object.defineProperties(root, {
    clientHeight: { value: 300 }, clientWidth: { value: 400 }, scrollHeight: { value: 3000 },
  });
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
    top: 100, bottom: 400, left: 50, right: 450, width: 400, height: 300,
    x: 50, y: 100, toJSON: () => ({}),
  });
  const options: RevealOptions = {
    ordinal: 7, blockKey: block.dataset.searchBlock,
    getContainer: () => root, isCurrent: () => true,
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    mountMessage: vi.fn(async () => { root.append(block); return true; }),
    scrollToOffset: vi.fn((offset: number) => { root.scrollTop = offset; }),
    afterUpdate: vi.fn().mockResolvedValue(undefined),
    nextFrame: vi.fn().mockResolvedValue(undefined),
    readTargetRect: () => ({ top: 150, bottom: 170, left: 80, right: 180 }),
  };
  return { root, block, options };
}

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("revealMatch", () => {
  it("keeps already visible occurrences still, without returning to the row start", async () => {
    const { root, options } = setup();
    root.scrollTop = 123;
    expect(await revealMatch(options)).toBe(true);
    expect(root.scrollTop).toBe(123);
    expect(options.ensureLoaded).toHaveBeenCalledWith(7);
    expect(options.mountMessage).not.toHaveBeenCalled();
    expect(options.nextFrame).toHaveBeenCalledTimes(2);
  });

  it("awaits mounting before looking for the searchable block", async () => {
    const { options } = setup(false);
    expect(await revealMatch(options)).toBe(true);
    expect(options.mountMessage).toHaveBeenCalledTimes(1);
  });

  it("abandons a superseded request after history loading", async () => {
    const { options } = setup(false);
    let current = true;
    options.isCurrent = () => current;
    options.ensureLoaded = vi.fn(async () => { current = false; });
    expect(await revealMatch(options)).toBe(false);
    expect(options.mountMessage).not.toHaveBeenCalled();
    expect(options.nextFrame).not.toHaveBeenCalled();
  });

  it("abandons a failed staged mount without pretending it reached the result", async () => {
    const { options } = setup(false);
    options.mountMessage = vi.fn().mockResolvedValue(false);
    expect(await revealMatch(options)).toBe(false);
    expect(options.nextFrame).not.toHaveBeenCalled();
  });

  it("retries absent blocks for at most four frames", async () => {
    const { options } = setup(false);
    options.mountMessage = vi.fn().mockResolvedValue(true);
    expect(await revealMatch(options)).toBe(false);
    expect(options.nextFrame).toHaveBeenCalledTimes(4);
  });

  it("rechecks outer geometry after one frame", async () => {
    const { root, options } = setup();
    let frame = 0;
    options.nextFrame = vi.fn(async () => { frame++; });
    options.readTargetRect = () => ({
      top: (frame > 1 ? 1200 : 800) - root.scrollTop,
      bottom: (frame > 1 ? 1220 : 820) - root.scrollTop,
      left: 80, right: 180,
    });
    expect(await revealMatch(options)).toBe(true);
    expect(root.scrollTop).toBe(960);
    expect(options.scrollToOffset).toHaveBeenNthCalledWith(1, 560);
    expect(options.scrollToOffset).toHaveBeenNthCalledWith(2, 960);
    // The second position requires one more correction after expansion.
    expect(frame).toBe(2);
  });

  it("does not act on another session's replaced container", async () => {
    const { options } = setup();
    let frame = 0;
    const replacement = document.createElement("div");
    options.nextFrame = vi.fn(async () => {
      if (++frame === 2) options.getContainer = () => replacement;
    });
    expect(await revealMatch(options)).toBe(false);
    expect(replacement.scrollTop).toBe(0);
  });

  it("scopes exact key lookup to the owning transcript", () => {
    const { root, block } = setup();
    const other = document.createElement("div");
    const duplicate = block.cloneNode(true);
    other.append(duplicate);
    document.body.prepend(other);
    expect(findSearchBlock(root, "7:tool-output:0")).toBe(block);
    block.dataset.searchBlock = '7:text:0"[x]';
    expect(findSearchBlock(root, '7:text:0"[x]')).toBe(block);
  });
});
