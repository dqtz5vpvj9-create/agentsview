import { afterEach, describe, expect, it } from "vite-plus/test";
import { STORAGE_KEY_GROUP } from "../components/sidebar/session-list-utils.js";
import {
  installSidebarScrollMemory,
  readSidebarScrollTop,
  writeSidebarScrollTop,
  type SidebarScrollStorage,
} from "./sidebar-scroll-memory.js";

function memoryStorage(): SidebarScrollStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("sidebar scroll memory", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("normalizes stored positions", () => {
    const storage = memoryStorage();
    writeSidebarScrollTop("none", 42.6, storage);
    expect(readSidebarScrollTop("none", storage)).toBe(43);

    writeSidebarScrollTop("none", -8, storage);
    expect(readSidebarScrollTop("none", storage)).toBe(0);
  });

  it("restores and updates the position for the active grouping mode", async () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY_GROUP, "agent");
    writeSidebarScrollTop("agent", 320, storage);

    const sidebar = document.createElement("aside");
    sidebar.id = "session-sidebar";
    const scroller = document.createElement("div");
    scroller.className = "session-list-scroll";
    Object.defineProperty(scroller, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(scroller, "clientHeight", {
      value: 200,
      configurable: true,
    });
    sidebar.appendChild(scroller);
    document.body.appendChild(sidebar);

    let nextFrame = 1;
    const frames = new Map<number, FrameRequestCallback>();
    const cleanup = installSidebarScrollMemory({
      root: document,
      storage,
      requestFrame: (callback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        queueMicrotask(() => {
          const queued = frames.get(id);
          if (!queued) return;
          frames.delete(id);
          queued(0);
        });
        return id;
      },
      cancelFrame: (id) => {
        frames.delete(id);
      },
    });

    try {
      expect(scroller.scrollTop).toBe(320);

      scroller.scrollTop = 455;
      scroller.dispatchEvent(new Event("scroll"));
      await Promise.resolve();

      expect(readSidebarScrollTop("agent", storage)).toBe(455);
      expect(readSidebarScrollTop("none", storage)).toBe(0);
    } finally {
      cleanup();
    }
  });
});
