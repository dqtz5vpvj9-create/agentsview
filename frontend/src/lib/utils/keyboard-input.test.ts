// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { registerShortcuts } from "./keyboard.js";
import { isComposingKey } from "./keyboard-event.js";

const state = vi.hoisted(() => ({
  ui: { activeModal: null as string | null },
  find: { isOpen: true, open: vi.fn(), close: vi.fn(), next: vi.fn(), prev: vi.fn() },
}));
vi.mock("../i18n/index.js", () => ({ m: { session_find_search_query: () => "搜索查询" } }));
vi.mock("../stores/ui.svelte.js", () => ({ ui: state.ui }));
vi.mock("../stores/inSessionSearch.svelte.js", () => ({ inSessionSearch: state.find }));
vi.mock("../stores/sessions.svelte.js", () => ({ sessions: { activeSessionId: "session" } }));
vi.mock("../stores/router.svelte.js", () => ({ router: { route: "sessions" } }));
vi.mock("../stores/starred.svelte.js", () => ({ starred: {} }));
vi.mock("../stores/sync.svelte.js", () => ({ sync: { isDesktop: false } }));
vi.mock("../stores/messages.svelte.js", () => ({ messages: {} }));
vi.mock("../api/client.js", () => ({ getExportUrl: vi.fn() }));
vi.mock("../api/generated/index", () => ({ SessionsService: {} }));
vi.mock("../api/runtime.js", () => ({ configureGeneratedClient: vi.fn() }));
vi.mock("./resume.js", () => ({ supportsResume: vi.fn(), buildResumeCommand: vi.fn(), formatResumeResponseCommand: vi.fn() }));
vi.mock("./clipboard.js", () => ({ copyToClipboard: vi.fn() }));
vi.mock("./sidebar-toggle.js", () => ({ toggleSidebarWithFocus: vi.fn() }));

let cleanup: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  state.ui.activeModal = null;
  cleanup = registerShortcuts({ navigateMessage: vi.fn(), navigateUserPrompt: vi.fn() });
});
afterEach(() => { cleanup(); document.body.innerHTML = ""; });

function key(value: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(event);
  return event;
}

describe("input-friendly shortcuts", () => {
  it("leaves IME confirmation and cancellation keys alone", () => {
    key("Escape", { isComposing: true });
    key("k", { ctrlKey: true, isComposing: true });
    expect(state.find.close).not.toHaveBeenCalled();
    expect(state.ui.activeModal).toBeNull();
    expect(isComposingKey({ isComposing: false, keyCode: 229 })).toBe(true);
  });
  it("does not handle a key already consumed by a nested control", () => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    document.dispatchEvent(event);
    expect(state.find.close).not.toHaveBeenCalled();
  });
  it("finds the localized search input and handles shifted uppercase G", () => {
    const input = document.createElement("input");
    input.setAttribute("aria-label", "搜索查询");
    document.body.append(input);
    input.focus();
    expect(key("G", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(state.find.prev).toHaveBeenCalledOnce();
    key("g", { ctrlKey: true });
    expect(state.find.next).toHaveBeenCalledOnce();
  });
  it("keeps native shortcuts in unrelated inputs and AltGr combinations", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    expect(key("f", { ctrlKey: true }).defaultPrevented).toBe(false);
    key("k", { ctrlKey: true, altKey: true });
    expect(state.ui.activeModal).toBeNull();
  });
});
