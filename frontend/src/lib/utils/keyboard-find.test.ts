// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { registerShortcuts } from "./keyboard.js";
import { inSessionSearch } from "../stores/inSessionSearch.svelte.js";
import { messages } from "../stores/messages.svelte.js";
import { sessions } from "../stores/sessions.svelte.js";
import { router } from "../stores/router.svelte.js";
import { ui } from "../stores/ui.svelte.js";

let cleanup: () => void;
beforeEach(() => {
  messages.sessionId = "find-keyboard";
  sessions.activeSessionId = "find-keyboard";
  router.route = "sessions";
  ui.activeModal = null;
  inSessionSearch.isOpen = true;
  cleanup = registerShortcuts({ navigateMessage: vi.fn(), navigateUserPrompt: vi.fn() });
});
afterEach(() => {
  cleanup();
  inSessionSearch.close();
  inSessionSearch.clearQuery();
  messages.clear();
  sessions.activeSessionId = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function fire(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  document.dispatchEvent(event);
  return event;
}

function focusInput(inFindBar: boolean) {
  const wrapper = document.createElement("div");
  if (inFindBar) wrapper.className = "kit-find-bar";
  const input = document.createElement("input");
  input.setAttribute("aria-label", "搜索关键词");
  wrapper.append(input);
  document.body.append(wrapper);
  input.focus();
  return input;
}

describe("session find keyboard navigation", () => {
  it("allows Cmd+F in a localized find input and repeats the focus request", () => {
    focusInput(true);
    const request = inSessionSearch.focusRequest;
    expect(fire("f", { metaKey: true }).defaultPrevented).toBe(true);
    expect(inSessionSearch.focusRequest).toBe(request + 1);
  });

  it("supports F3 and Shift+F3 in the localized find input", () => {
    focusInput(true);
    const next = vi.spyOn(inSessionSearch, "next");
    const prev = vi.spyOn(inSessionSearch, "prev");
    expect(fire("F3").defaultPrevented).toBe(true);
    expect(fire("F3", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
    expect(prev).toHaveBeenCalledTimes(1);
  });

  it("recognizes uppercase G from Cmd+Shift+G", () => {
    focusInput(true);
    const prev = vi.spyOn(inSessionSearch, "prev");
    expect(fire("G", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(prev).toHaveBeenCalledTimes(1);
  });

  it("leaves browser shortcuts alone in unrelated inputs", () => {
    focusInput(false);
    const next = vi.spyOn(inSessionSearch, "next");
    expect(fire("F3").defaultPrevented).toBe(false);
    expect(fire("f", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(next).not.toHaveBeenCalled();
  });

  it("does not navigate when find is closed or another modal is open", () => {
    const next = vi.spyOn(inSessionSearch, "next");
    inSessionSearch.isOpen = false;
    expect(fire("F3").defaultPrevented).toBe(false);
    inSessionSearch.isOpen = true;
    ui.activeModal = "shortcuts";
    expect(fire("F3").defaultPrevented).toBe(false);
    expect(next).not.toHaveBeenCalled();
    ui.activeModal = null;
  });
});
