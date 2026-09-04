import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PinsService } from "../api/generated/index";
import { createPinsStore } from "./pins.svelte.js";

vi.mock("../api/generated/index", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/generated/index")>(),
  PinsService: { getApiV1Pins: vi.fn() },
}));
const service = vi.mocked(PinsService);
beforeEach(() => vi.resetAllMocks());

describe("pinned-page load recovery", () => {
  it("distinguishes a failed first load from an empty collection", async () => {
    service.getApiV1Pins.mockRejectedValueOnce(new Error("Connection unavailable"));
    const store = createPinsStore();
    await store.loadAll();
    expect(store.loadError?.detail).toBe("Connection unavailable");
    expect(store.loading).toBe(false);
  });
  it("retains loaded pins on refresh failure and clears the error after retry", async () => {
    const store = createPinsStore();
    service.getApiV1Pins.mockResolvedValueOnce({ pins: [{ id: 1 }] } as never);
    await store.loadAll("project");
    service.getApiV1Pins.mockRejectedValueOnce(new Error("Offline"));
    await store.loadAll("project");
    expect(store.pins[0]?.id).toBe(1);
    expect(store.loadError).not.toBeNull();
    service.getApiV1Pins.mockResolvedValueOnce({ pins: [{ id: 2 }] } as never);
    await store.loadAll("project");
    expect(store.pins[0]?.id).toBe(2);
    expect(store.loadError).toBeNull();
  });
  it("does not show pins from a different project after a scope change fails", async () => {
    const store = createPinsStore();
    service.getApiV1Pins.mockResolvedValueOnce({ pins: [{ id: 1 }] } as never);
    await store.loadAll("first");
    service.getApiV1Pins.mockRejectedValueOnce(new Error("Offline"));
    await store.loadAll("second");
    expect(store.pins).toEqual([]);
    expect(store.loadError).not.toBeNull();
  });
  it("does not turn a cancelled request into a displayed error", async () => {
    let reject!: (reason: Error) => void;
    service.getApiV1Pins.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }) as never);
    const store = createPinsStore();
    const request = store.loadAll();
    store.cancelAllPinsRead();
    reject(new Error("late failure"));
    await request;
    expect(store.loadError).toBeNull();
    expect(store.loading).toBe(false);
  });
  it("shows a recoverable state for errors without a message", async () => {
    service.getApiV1Pins.mockRejectedValueOnce(null);
    const store = createPinsStore();
    await store.loadAll();
    expect(store.loadError).toEqual({ detail: null });
  });
});
