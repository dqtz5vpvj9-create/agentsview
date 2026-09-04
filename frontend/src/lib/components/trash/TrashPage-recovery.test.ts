// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mount, tick, unmount } from "svelte";
import { SessionsService } from "../../api/generated/index";
import { m } from "../../i18n/index.js";
import TrashPage from "./TrashPage.svelte";

const sessionStore = vi.hoisted(() => ({ clearRecentlyDeleted: vi.fn(), invalidateFilterCaches: vi.fn(), load: vi.fn() }));
vi.mock("../../stores/sessions.svelte.js", () => ({ sessions: sessionStore }));
vi.mock("../../api/generated/index", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/generated/index")>(),
  SessionsService: {
    getApiV1Trash: vi.fn(), postApiV1SessionsIdRestore: vi.fn(),
    deleteApiV1SessionsIdPermanent: vi.fn(), deleteApiV1Trash: vi.fn(),
  },
}));
const service = vi.mocked(SessionsService);
const rows = ["first", "second"].map((id) => ({
  id, project: "Project", agent: "codex", display_name: id,
  first_message: "Message", user_message_count: 1,
}));
let component: ReturnType<typeof mount> | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  service.getApiV1Trash.mockResolvedValue({ sessions: rows } as never);
});
afterEach(() => { if (component) unmount(component); document.body.replaceChildren(); });
async function flush() { for (let i = 0; i < 10; i++) await tick(); }
async function render() { component = mount(TrashPage, { target: document.body }); await flush(); }

describe("trash recovery and progress", () => {
  it("shows a read failure instead of an empty collection and retries", async () => {
    service.getApiV1Trash.mockRejectedValueOnce(new Error("Connection unavailable"));
    await render();
    expect(document.querySelector(".load-error")?.textContent).toContain("Connection unavailable");
    expect(document.body.textContent).not.toContain(m.trash_empty());
    document.querySelector<HTMLButtonElement>(".load-error button")!.click();
    await flush();
    expect(document.querySelector(".load-error")).toBeNull();
    expect(document.querySelectorAll(".trash-card")).toHaveLength(2);
  });

  it("shows row progress, prevents duplicate actions, and leaves other rows usable", async () => {
    let resolve!: (value: never) => void;
    service.postApiV1SessionsIdRestore.mockImplementationOnce(() => new Promise((done) => { resolve = done; }) as never);
    await render();
    const buttons = document.querySelectorAll<HTMLButtonElement>(".restore-btn");
    buttons[0]!.click();
    buttons[0]!.click();
    await flush();
    expect(service.postApiV1SessionsIdRestore).toHaveBeenCalledTimes(1);
    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[1]!.disabled).toBe(false);
    expect(document.querySelector(".row-progress")).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>(".empty-all-btn")!.disabled).toBe(true);
    resolve({} as never);
    await flush();
    expect(document.querySelectorAll(".trash-card")).toHaveLength(1);
    expect(sessionStore.clearRecentlyDeleted).toHaveBeenCalledWith("first");
    expect(sessionStore.load).toHaveBeenCalledOnce();
  });

  it("retains a failed row, shows its error, and permits retry", async () => {
    service.deleteApiV1SessionsIdPermanent.mockRejectedValueOnce(new Error("Delete failed"));
    service.deleteApiV1SessionsIdPermanent.mockResolvedValueOnce({} as never);
    await render();
    const button = document.querySelector<HTMLButtonElement>(".perm-delete-btn")!;
    button.click();
    await flush();
    expect(document.querySelectorAll(".trash-card")).toHaveLength(2);
    expect(document.querySelector(".row-error")?.textContent).toContain("Delete failed");
    expect(button.disabled).toBe(false);
    button.click();
    await flush();
    expect(document.querySelectorAll(".trash-card")).toHaveLength(1);
    expect(document.querySelector(".row-error")).toBeNull();
  });

  it("does not claim successful emptying on failure and allows another attempt", async () => {
    service.deleteApiV1Trash.mockRejectedValueOnce(new Error("Empty failed"));
    service.deleteApiV1Trash.mockResolvedValueOnce({} as never);
    await render();
    const button = document.querySelector<HTMLButtonElement>(".empty-all-btn")!;
    button.click();
    await flush();
    expect(document.querySelector(".empty-error")?.textContent).toContain("Empty failed");
    expect(document.querySelectorAll(".trash-card")).toHaveLength(2);
    expect(button.disabled).toBe(false);
    button.click();
    await flush();
    expect(document.querySelector(".empty-error")).toBeNull();
    expect(document.querySelectorAll(".trash-card")).toHaveLength(0);
    expect(document.body.textContent).toContain(m.trash_empty());
  });
});
