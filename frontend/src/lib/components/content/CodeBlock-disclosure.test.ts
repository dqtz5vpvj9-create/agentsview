// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { mount, tick, unmount } from "svelte";
import CodeBlock from "./CodeBlock.svelte";
import { copyToClipboard } from "../../utils/clipboard.js";

vi.mock("../../utils/clipboard.js", () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));
let component: ReturnType<typeof mount> | undefined;
afterEach(() => { if (component) unmount(component); document.body.replaceChildren(); });

describe("code disclosure interaction", () => {
  it("toggles the rendered code without truncating the copied content", async () => {
    const content = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    component = mount(CodeBlock, { target: document.body, props: { content } });
    await tick();
    const pre = document.querySelector("pre")!;
    const toggle = document.querySelector<HTMLButtonElement>(".code-disclosure button")!;
    expect(pre.classList.contains("collapsed")).toBe(false);
    toggle.click();
    await tick();
    expect(pre.classList.contains("collapsed")).toBe(true);
    expect(pre.textContent).toContain("line 99");
    document.querySelector<HTMLButtonElement>(".code-copy")!.click();
    await tick();
    expect(copyToClipboard).toHaveBeenCalledWith(content);
    toggle.click();
    await tick();
    expect(pre.classList.contains("collapsed")).toBe(false);
  });
});
