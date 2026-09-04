// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mount, tick, unmount } from "svelte";
import type { PinnedMessage } from "../../api/types.js";
import { m } from "../../i18n/index.js";
import PinnedPage from "./PinnedPage.svelte";

const state = vi.hoisted(() => ({
  pins: { pins: [] as PinnedMessage[], loading: false, loadError: null as {detail: string | null} | null, loadAll: vi.fn(), cancelAllPinsRead: vi.fn(), unpin: vi.fn() },
  sessions: { sessions: [], filters: { project: "project" } },
}));
vi.mock("../../stores/pins.svelte.js", () => ({ pins: state.pins }));
vi.mock("../../stores/sessions.svelte.js", () => ({ sessions: state.sessions }));
vi.mock("../../utils/markdown.js", () => ({ renderMarkdown: (text: string) => text }));
vi.mock("../../utils/highlight-fences.js", () => ({ highlightCodeFences: () => ({ destroy() {} }) }));
vi.mock("../../stores/router.svelte.js", () => ({ router: { navigateToSession: vi.fn() } }));
vi.mock("../../stores/ui.svelte.js", () => ({ ui: { scrollToOrdinal: vi.fn() } }));
let component: ReturnType<typeof mount> | undefined;
beforeEach(() => { vi.clearAllMocks(); state.pins.pins = []; state.pins.loading = false; state.pins.loadError = null; });
afterEach(() => { if (component) unmount(component); document.body.replaceChildren(); });
function pin(id: number, content: string): PinnedMessage {
  return { id, session_id: `session-${id}`, message_id: id, ordinal: id, created_at: "2026-01-01T00:00:00Z", content, session_project: "project", session_agent: "codex" };
}

describe("pinned-page feedback", () => {
  it("offers retry instead of claiming a failed load is an empty collection", async () => {
    state.pins.loadError = { detail: "Connection unavailable" };
    component = mount(PinnedPage, { target: document.body });
    await tick();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Connection unavailable");
    expect(document.body.textContent).not.toContain(m.pinned_none_for_project());
    document.querySelector<HTMLButtonElement>('.pin-load-error button')!.click();
    expect(state.pins.loadAll).toHaveBeenLastCalledWith("project");
  });
  it("keeps existing cards visible during a refresh", async () => {
    state.pins.pins = [pin(1, "Existing message")];
    state.pins.loading = true;
    component = mount(PinnedPage, { target: document.body });
    await tick();
    expect(document.querySelectorAll('.pin-card')).toHaveLength(1);
    expect(document.querySelector('.loading-state')).not.toBeNull();
  });
  it("filters rendered cards and restores them when the input is cleared", async () => {
    state.pins.pins = [pin(1, "量子编译"), pin(2, "Other content")];
    component = mount(PinnedPage, { target: document.body });
    await tick();
    const input = document.querySelector<HTMLInputElement>('.pin-search input')!;
    input.value = "量子";
    input.dispatchEvent(new InputEvent("input", {bubbles: true}));
    await tick();
    expect(document.querySelectorAll('.pin-card')).toHaveLength(1);
    input.value = "";
    input.dispatchEvent(new InputEvent("input", {bubbles: true}));
    await tick();
    expect(document.querySelectorAll('.pin-card')).toHaveLength(2);
  });
});
