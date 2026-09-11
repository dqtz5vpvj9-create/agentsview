// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Message } from "../api/types.js";
const api = vi.hoisted(() => ({ getApiV1SessionsId: vi.fn(), getApiV1SessionsIdMessages: vi.fn() }));
vi.mock("../api/generated/index", () => ({ SessionsService: api }));
vi.mock("../api/runtime.js", () => ({
  configureGeneratedClient() {},
  isAbortError: (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  withAbort: <T>(promise: Promise<T>, signal: AbortSignal) => new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  }),
}));
vi.mock("./read-progress.svelte.js", () => ({ buildReadProgressToken: () => null, readProgress: { get: () => null } }));
import { MessagesStore } from "./messages.svelte.js";
const stores: MessagesStore[] = [];
let id = 970000;
function message(ordinal: number): Message {
  return { id: id++, ordinal, session_id: "history", role: "assistant", content: ordinal === 1200 ? "needle" : "ordinary",
    content_length: ordinal === 1200 ? 6 : 8, has_thinking: false, thinking_text: "", has_tool_use: false,
    is_system: false, model: "", context_tokens: 0, output_tokens: 0, timestamp: "2026-01-01T00:00:00Z" };
}
function setup(count = 1500) {
  const all = Array.from({ length: count }, (_, ordinal) => message(ordinal));
  const control = { failFrom: 1000 as number | null, gate: null as Promise<void> | null, replacement: null as Message[] | null };
  api.getApiV1SessionsId.mockImplementation(async ({ id }: { id: string }) => ({ id, message_count: count }));
  api.getApiV1SessionsIdMessages.mockImplementation(async ({ direction = "asc", from, limit = 1000 }: { direction?: string; from?: number; limit?: number }) => {
    from ??= direction === "desc" ? count - 1 : 0;
    if (control.gate) await control.gate;
    if (from === control.failFrom) throw new Error("injected page failure");
    const page = control.replacement ?? (direction === "desc"
      ? all.slice(Math.max(0, from - limit + 1), from + 1).reverse() : all.slice(from, from + limit));
    return { messages: page, count: page.length };
  });
  const store = new MessagesStore(); stores.push(store);
  return { all, control, store };
}
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { stores.splice(0).forEach((store) => store.clear()); vi.restoreAllMocks(); });

describe("complete search history", () => {
  it("resumes a failed forward page without replacing loaded rows", async () => {
    const { store, control } = setup(); await store.loadSession("history");
    const first = store.messages[0];
    expect(store.messages).toHaveLength(1000); expect(store.historyComplete).toBe(false); expect(store.hasOlder).toBe(false);
    control.failFrom = null; await store.ensureHistoryLoaded();
    expect(store.messages).toHaveLength(1500); expect(store.historyComplete).toBe(true);
    expect(store.messages[0]).toBe(first); expect(store.messages[1200]!.content).toBe("needle");
    expect(api.getApiV1SessionsIdMessages.mock.calls.map(([request]) => request.from)).toEqual([0, 1000, 1000]);
  });
  it("keeps incomplete status after another failed retry", async () => {
    const { store } = setup(); await store.loadSession("history"); await store.ensureHistoryLoaded();
    expect(store.messages).toHaveLength(1000); expect(store.historyComplete).toBe(false); expect(store.loadingOlder).toBe(false);
  });
  it("recovers when even the first page failed", async () => {
    const { store, control } = setup(); control.failFrom = 0; await store.loadSession("history");
    expect(store.messages).toHaveLength(0); control.failFrom = null; await store.ensureHistoryLoaded();
    expect(store.messages).toHaveLength(1500); expect(store.historyComplete).toBe(true);
  });
  it("keeps backward pagination working for a large session", async () => {
    const { store, control } = setup(5500); control.failFrom = null; await store.loadSession("history");
    expect(store.messages).toHaveLength(1000); await store.ensureHistoryLoaded();
    expect(store.messages).toHaveLength(5500); expect(store.historyComplete).toBe(true);
    expect(new Set(store.messages.map((item) => item.ordinal)).size).toBe(5500);
  });
  it("coalesces concurrent forward recovery", async () => {
    const { store, control } = setup(); await store.loadSession("history"); control.failFrom = null;
    let release!: () => void; control.gate = new Promise<void>((resolve) => { release = resolve; });
    const first = store.ensureHistoryLoaded(); const second = store.ensureHistoryLoaded();
    release(); await Promise.all([first, second]);
    expect(store.messages).toHaveLength(1500); expect(api.getApiV1SessionsIdMessages).toHaveBeenCalledTimes(3);
  });
  it("rejects a late response after the active session changes", async () => {
    const { store, control } = setup(); await store.loadSession("history"); control.failFrom = null;
    let release!: () => void; control.gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = store.ensureHistoryLoaded(); store.clear(); store.sessionId = "other";
    const next = message(0); store.messages = [next]; release(); await pending;
    expect(store.sessionId).toBe("other"); expect(store.messages).toEqual([next]); expect(store.loadingOlder).toBe(false);
  });
  it("preserves rows already appended by SSE without duplicates", async () => {
    const { store, control } = setup(); await store.loadSession("history"); control.failFrom = null;
    let release!: () => void; control.gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = store.ensureHistoryLoaded(); const next = message(1200); next.content = "newer SSE content";
    store.messages.push(next); const retained = store.messages.at(-1); release(); await pending;
    expect(store.messages).toHaveLength(1500); expect(store.messages[1200]).toBe(retained);
  });
  it("does not loop or report completeness for a non-progressing page", async () => {
    const { store, control, all } = setup(); await store.loadSession("history");
    control.failFrom = null; control.replacement = all.slice(0, 1000); await store.ensureHistoryLoaded();
    expect(store.historyComplete).toBe(false); expect(store.messages).toHaveLength(1000);
    expect(api.getApiV1SessionsIdMessages).toHaveBeenCalledTimes(3);
  });
});
