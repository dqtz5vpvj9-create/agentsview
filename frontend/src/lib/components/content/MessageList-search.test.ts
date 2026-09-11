// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mount, tick, unmount } from "svelte";
import type { Message } from "../../api/types.js";
import { inSessionSearch } from "../../stores/inSessionSearch.svelte.js";
import { messages } from "../../stores/messages.svelte.js";
import { sessions } from "../../stores/sessions.svelte.js";
import { ui } from "../../stores/ui.svelte.js";

const virtualizerMock = vi.hoisted(() => ({
  options: { count: 0 }, scrollOffset: 0, scrollRect: { height: 500 },
  getVirtualItems: vi.fn(() => [] as { index: number; key: string; start: number; end: number }[]),
  getTotalSize: vi.fn(() => 1000), measureElement: vi.fn(),
  scrollToIndex: vi.fn(), scrollToOffset: vi.fn(),
  getOffsetForIndex: vi.fn((index: number) => [index * 120, "start"]),
}));
vi.mock("../../virtual/createVirtualizer.svelte.js", () => ({
  createVirtualizer: (read: () => { count: number }) => ({
    get instance() {
      virtualizerMock.options.count = read().count;
      virtualizerMock.getVirtualItems.mockReturnValue(Array.from({ length: read().count }, (_, index) => ({
        index, key: `search-row-${index}`, start: index * 120, end: (index + 1) * 120,
      })));
      return virtualizerMock;
    },
  }),
}));
import MessageList from "./MessageList.svelte";

let component: ReturnType<typeof mount> | undefined;
let nextId = 180000;
function message(ordinal: number, content: string, overrides: Partial<Message> = {}): Message {
  return {
    id: nextId++, session_id: "search-list", ordinal, role: "assistant", content,
    content_length: content.length, timestamp: "2026-01-01T00:00:00Z",
    has_thinking: false, thinking_text: "", has_tool_use: false,
    model: "", context_tokens: 0, output_tokens: 0, is_system: false, ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  inSessionSearch.close();
  inSessionSearch.clearQuery();
  messages.clear();
  messages.sessionId = "search-list";
  sessions.activeSessionId = "search-list";
  messages.hasOlder = false;
  messages.loading = false;
  messages.messages = [
    message(0, "visible user", { role: "user" }),
    message(1, "[Thinking]\nneedle\n[/Thinking]", { has_thinking: true }),
    message(2, "", { has_tool_use: true, tool_calls: [{ tool_name: "Read", result_content: "needle" }] }),
  ];
  messages.messageCount = 3;
  ui.visibleBlocks = new Set(["user"]);
  ui.setTranscriptMode("focused");
  ui.messageLayout = "skim";
  ui.sortNewestFirst = false;
  ui.followLatest = false;
  ui.selectedOrdinal = null;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
    window.setTimeout(() => callback(performance.now()), 1));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => window.clearTimeout(id));
});

afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  inSessionSearch.close();
  inSessionSearch.clearQuery();
  messages.clear();
  sessions.activeSessionId = null;
  ui.showAllBlocks();
  ui.setTranscriptMode("normal");
  ui.messageLayout = "default";
  ui.sortNewestFirst = false;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("MessageList search visibility", () => {
  it("temporarily bypasses filters, focused mode and skim without changing preferences", async () => {
    component = mount(MessageList, { target: document.body });
    await tick();
    const before = document.querySelectorAll(".virtual-row").length;
    const filters = [...ui.visibleBlocks];
    expect(document.querySelector(".layout-skim")).not.toBeNull();
    inSessionSearch.open();
    inSessionSearch.query = "needle";
    await tick();
    await vi.advanceTimersByTimeAsync(200);
    await tick();
    expect(inSessionSearch.total).toBe(2);
    expect(document.querySelectorAll(".virtual-row")).toHaveLength(3);
    expect(document.querySelector(".layout-skim")).toBeNull();
    expect([...ui.visibleBlocks]).toEqual(filters);
    expect(ui.transcriptMode).toBe("focused");
    expect(ui.messageLayout).toBe("skim");
    inSessionSearch.close();
    await tick();
    expect(document.querySelectorAll(".virtual-row")).toHaveLength(before);
    expect(document.querySelector(".layout-skim")).not.toBeNull();
  });

  it("cancels stale virtual scrolling after closing search", async () => {
    component = mount(MessageList, { target: document.body });
    await tick();
    inSessionSearch.open();
    inSessionSearch.query = "needle";
    await tick();
    await vi.advanceTimersByTimeAsync(150);
    await tick();
    inSessionSearch.close();
    await tick();
    virtualizerMock.scrollToOffset.mockClear();
    virtualizerMock.scrollToIndex.mockClear();
    await vi.advanceTimersByTimeAsync(100);
    expect(virtualizerMock.scrollToOffset).not.toHaveBeenCalled();
    expect(virtualizerMock.scrollToIndex).not.toHaveBeenCalled();
  });
});
