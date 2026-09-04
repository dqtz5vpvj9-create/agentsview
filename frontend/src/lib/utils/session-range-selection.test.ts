import { afterEach, describe, expect, it } from "vite-plus/test";
import { sessions } from "../stores/sessions.svelte.js";
import { starred } from "../stores/starred.svelte.js";
import {
  installSessionRangeSelection,
  sessionRange,
} from "./session-range-selection.js";

describe("session range selection", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.getElementById("session-sidebar")?.remove();
    sessions.sessions = [];
    sessions.selectedIds = new Set();
    sessions.selectMode = false;
    starred.filterOnly = false;
  });

  it("returns an inclusive range in either direction", () => {
    const ids = ["a", "b", "c", "d"];
    expect(sessionRange(ids, "a", "c")).toEqual(["a", "b", "c"]);
    expect(sessionRange(ids, "d", "b")).toEqual(["b", "c", "d"]);
    expect(sessionRange(ids, null, "c")).toEqual(["c"]);
  });

  it("adds a Shift-clicked range without navigating the row link", () => {
    sessions.sessions = ["a", "b", "c"].map((id) => ({ id })) as unknown as typeof sessions.sessions;
    sessions.selectMode = true;
    sessions.selectedIds = new Set(["a"]);

    const sidebar = document.createElement("aside");
    sidebar.id = "session-sidebar";
    const links = ["a", "b", "c"].map((id) => {
      const row = document.createElement("div");
      row.dataset.sessionId = id;
      const link = document.createElement("a");
      link.href = `/sessions/${id}`;
      link.textContent = id;
      row.appendChild(link);
      sidebar.appendChild(row);
      return link;
    });
    document.body.appendChild(sidebar);
    cleanup = installSessionRangeSelection();

    links[0]!.dispatchEvent(new MouseEvent("click", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }));
    const rangeClick = new MouseEvent("click", {
      button: 0,
      bubbles: true,
      cancelable: true,
      shiftKey: true,
    });
    const allowed = links[2]!.dispatchEvent(rangeClick);

    expect(allowed).toBe(false);
    expect([...sessions.selectedIds]).toEqual(["a", "b", "c"]);
  });
});
