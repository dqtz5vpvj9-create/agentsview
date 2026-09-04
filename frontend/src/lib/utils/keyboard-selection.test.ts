import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { sessions } from "../stores/sessions.svelte.js";
import { ui } from "../stores/ui.svelte.js";
import { inSessionSearch } from "../stores/inSessionSearch.svelte.js";
import { registerShortcuts } from "./keyboard.js";

describe("session selection shortcuts", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    ui.activeModal = null;
    inSessionSearch.close();
    sessions.activeSessionId = null;
    sessions.selectMode = false;
    sessions.selectedIds = new Set();
  });

  it("exits multi-select before deselecting the active session", () => {
    sessions.activeSessionId = "session-1";
    sessions.selectMode = true;
    sessions.selectedIds = new Set(["session-1"]);
    cleanup = registerShortcuts({
      navigateMessage: vi.fn(),
      navigateUserPrompt: vi.fn(),
    });

    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
    }));

    expect(sessions.selectMode).toBe(false);
    expect(sessions.selectedIds.size).toBe(0);
    expect(sessions.activeSessionId).toBe("session-1");
  });
});
