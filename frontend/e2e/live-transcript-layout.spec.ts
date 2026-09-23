import { expect, test, type Page } from "@playwright/test";
import { SessionsPage } from "./pages/sessions-page";
import { waitForStableValue } from "./helpers/virtual-list-helpers";

const SESSION = "test-session-xlarge-5500";

function message(ordinal: number, content = `Message ${ordinal}`) {
  return {
    id: ordinal + 1,
    session_id: SESSION,
    ordinal,
    role: ordinal % 2 === 0 ? "user" : "assistant",
    content,
    content_length: content.length,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, ordinal)).toISOString(),
    has_thinking: false,
    thinking_text: "",
    has_tool_use: false,
    model: "",
    token_usage: null,
    context_tokens: 0,
    output_tokens: 0,
    has_context_tokens: false,
    has_output_tokens: false,
    tool_calls: [],
    is_system: false,
  };
}

type ReadingPosition = { key: string; top: number };
type LayoutSamples = {
  frames: number;
  minRows: number;
  maxGap: number;
  maxUncovered: number;
  maxAnchorDrift: number;
  missingAnchorFrames: number;
  stop: () => void;
};
type LiveWindow = Window & {
  __liveUpdate?: () => number;
  __liveStreamCount?: () => number;
  __layoutSamples?: LayoutSamples;
};

async function fixture(page: Page, newestFirst: boolean) {
  let transcript = Array.from({ length: 80 }, (_, i) => message(i));
  await page.addInitScript(
    ({ session }) => {
      // The app imports the eventsource package, which reads a fetch stream.
      // Deliver actual SSE bytes through that transport and its real parser.
      const originalFetch = window.fetch.bind(window);
      const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
      window.fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!new URL(url, location.href).pathname.endsWith(`/sessions/${session}/watch`)) {
          return originalFetch(input, init);
        }
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        let activeController: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            activeController = controller;
            streams.add(controller);
            const close = () => {
              if (streams.delete(controller)) controller.close();
            };
            signal?.addEventListener("abort", close, { once: true });
            if (signal?.aborted) close();
          },
          cancel() {
            streams.delete(activeController);
          },
        });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      };
      (window as LiveWindow).__liveStreamCount = () => streams.size;
      (window as LiveWindow).__liveUpdate = () => {
        const event = new TextEncoder().encode("event: session_updated\ndata: {}\n\n");
        let delivered = 0;
        for (const stream of streams) {
          try {
            stream.enqueue(event);
            delivered++;
          } catch {
            streams.delete(stream);
          }
        }
        return delivered;
      };
    },
    { session: SESSION },
  );

  await page.route(`**/api/v1/sessions/${SESSION}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), message_count: transcript.length } });
  });
  await page.route(`**/api/v1/sessions/${SESSION}/messages*`, async (route) => {
    const url = new URL(route.request().url());
    const desc = url.searchParams.get("direction") === "desc";
    const from = Number(url.searchParams.get("from") ?? (desc ? transcript.length - 1 : 0));
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    const selected = transcript.filter((item) =>
      desc ? item.ordinal <= from : item.ordinal >= from,
    );
    if (desc) selected.reverse();
    await route.fulfill({ json: { messages: selected.slice(0, limit), count: transcript.length } });
  });
  const sp = new SessionsPage(page);
  await sp.goto();
  await sp.selectFirstSession();
  if (newestFirst) await sp.toggleSortOrder();
  await expect(sp.scroller).toHaveAttribute("data-loaded", "true");
  await expect(sp.scroller).toHaveAttribute("data-session-id", SESSION);
  await expect
    .poll(() => page.evaluate(() => (window as LiveWindow).__liveStreamCount?.() ?? 0))
    .toBeGreaterThan(0);

  async function refresh(next: typeof transcript) {
    transcript = next;
    const response = page.waitForResponse((r) => r.url().includes(`/sessions/${SESSION}/messages`));
    const listeners = await page.evaluate(() => (window as LiveWindow).__liveUpdate?.() ?? 0);
    expect(listeners).toBeGreaterThan(0);
    await (await response).finished();
  }
  return { sp, refresh, data: () => transcript };
}

async function sampleGeometry(page: Page, anchor?: ReadingPosition) {
  await page.evaluate((reading) => {
    const state: LayoutSamples = {
      frames: 0, minRows: Infinity, maxGap: 0, maxUncovered: 0,
      maxAnchorDrift: 0, missingAnchorFrames: 0, stop: () => {},
    };
    let running = true;
    let frame = 0;
    const sample = () => {
      if (!running) return;
      const el = document.querySelector<HTMLElement>(".message-list-scroll");
      const rows = el ? [...el.querySelectorAll<HTMLElement>(".virtual-row")] : [];
      state.minRows = Math.min(state.minRows, rows.length);
      for (let i = 1; i < rows.length; i++) {
        const before = rows[i - 1]!.getBoundingClientRect();
        const after = rows[i]!.getBoundingClientRect();
        state.maxGap = Math.max(state.maxGap, Math.abs(after.top - before.bottom));
      }
      if (el && rows.length) {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const scale = box.height / el.offsetHeight;
        const inset = (value: string) => (Number.parseFloat(value) || 0) * scale;
        const top = box.top + inset(style.borderTopWidth) + inset(style.paddingTop);
        const bottom = box.bottom - inset(style.borderBottomWidth) - inset(style.paddingBottom);
        // These fixtures exceed one viewport. A missing block or a common
        // translation error must fail even when all adjacent gaps are zero.
        state.maxUncovered = Math.max(
          state.maxUncovered,
          rows[0]!.getBoundingClientRect().top - top,
          bottom - rows.at(-1)!.getBoundingClientRect().bottom,
        );
        if (reading) {
          const row = rows.find((item) => item.dataset.messageKey === reading.key);
          if (!row) state.missingAnchorFrames++;
          else state.maxAnchorDrift = Math.max(
            state.maxAnchorDrift,
            Math.abs(row.getBoundingClientRect().top - box.top - reading.top),
          );
        }
      } else if (reading) {
        state.missingAnchorFrames++;
      }
      state.frames++;
      frame = requestAnimationFrame(sample);
    };
    state.stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };
    (window as LiveWindow).__layoutSamples = state;
    frame = requestAnimationFrame(sample);
  }, anchor);
}

async function finishGeometry(page: Page) {
  // Include post-response layout/observer deliveries; polling a final position
  // must not hide a transient displacement that occurred in an earlier frame.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }));
  const samples = await page.evaluate(() => {
    const sample = (window as LiveWindow).__layoutSamples!;
    sample.stop();
    const { stop: _stop, ...result } = sample;
    return result;
  });
  expect(samples.frames).toBeGreaterThan(0);
  expect(samples.minRows).toBeGreaterThan(0);
  expect(samples.maxGap).toBeLessThanOrEqual(1);
  expect(samples.maxUncovered).toBeLessThanOrEqual(1);
  expect(samples.missingAnchorFrames).toBe(0);
  expect(samples.maxAnchorDrift).toBeLessThanOrEqual(1);
}

for (const newestFirst of [false, true]) {
  for (const zoom of [80, 100, 125]) {
    const order = `${newestFirst ? "newest-first" : "oldest-first"} at ${zoom}%`;
    test(`${order}: a stationary reader keeps the same message during live refresh`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(
        (value) => localStorage.setItem("agentsview-zoom-level", String(value)),
        zoom,
      );
      const { sp, refresh, data } = await fixture(page, newestFirst);
      await sp.scroller.evaluate((el) => {
        el.scrollTop = el.scrollHeight / 2;
      });
      await waitForStableValue(() => sp.scroller.evaluate((el) => el.scrollTop), 500);
      const anchor = await sp.scroller.evaluate((el) => {
        const top = el.getBoundingClientRect().top;
        const rows = [...el.querySelectorAll<HTMLElement>(".virtual-row")];
        const row = rows.find((item) => item.getBoundingClientRect().bottom > top)!;
        return {
          key: row.dataset.messageKey!,
          top: row.getBoundingClientRect().top - top,
          aboveKey: rows[0]!.dataset.messageKey!,
        };
      });
      const anchorOrdinal = Number(anchor.key.split("-m-").at(-1));
      const aboveOrdinal = Number(anchor.aboveKey.split("-m-").at(-1));
      expect(aboveOrdinal).not.toBe(anchorOrdinal);
      const anchorRow = sp.scroller.locator(`[data-message-key="${anchor.key}"]`);
      await sampleGeometry(page, anchor);
      for (let revision = 1; revision <= 6; revision++) {
        const marker = `Live revision ${revision}`;
        const next = data().map((item) => {
          if (item.ordinal === anchorOrdinal) return message(item.ordinal, marker);
          if (item.ordinal === aboveOrdinal) {
            return message(
              item.ordinal,
              revision % 2 ? "A changing paragraph.\n\n".repeat(12) : "Short content.",
            );
          }
          return item;
        });
        if (revision > 3) next.push(message(next.length));
        await refresh(next);
        await expect(anchorRow).toContainText(marker);
        await expect
          .poll(() =>
            anchorRow.evaluate((row, expected) => {
              const scroller = row.closest(".message-list-scroll")!;
              return Math.abs(
                row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - expected,
              );
            }, anchor.top),
          )
          .toBeLessThanOrEqual(1);
      }
      await finishGeometry(page);
      expect(errors).toEqual([]);
    });

    test(`${order}: follow latest survives streaming growth and stops on manual intent`, async ({
      page,
    }) => {
      await page.addInitScript(
        (value) => localStorage.setItem("agentsview-zoom-level", String(value)),
        zoom,
      );
      const { sp, refresh, data } = await fixture(page, newestFirst);
      const follow = page.getByLabel("Follow latest messages");
      await follow.click();
      await expect(follow).toHaveAttribute("aria-pressed", "true");
      await sampleGeometry(page);
      for (let revision = 1; revision <= 4; revision++) {
        const marker = `Streaming revision ${revision}`;
        const next = [...data()];
        const ordinal = next.length - 1;
        next[ordinal] = message(
          ordinal,
          `${marker}\n\n${"More response text.\n\n".repeat(revision * 8)}`,
        );
        await refresh(next);
        await expect(sp.scroller).toContainText(marker);
        await expect
          .poll(() =>
            sp.scroller.evaluate(
              (el, reversed) =>
                reversed ? el.scrollTop : el.scrollHeight - el.clientHeight - el.scrollTop,
              newestFirst,
            ),
          )
          .toBeLessThanOrEqual(8);
      }
      await finishGeometry(page);
      await sp.scroller.hover();
      await page.mouse.wheel(0, newestFirst ? 600 : -600);
      await expect(follow).toHaveAttribute("aria-pressed", "false");
    });

    test(`${order}: disabling follow at the latest edge survives further streaming`, async ({ page }) => {
      await page.addInitScript(
        (value) => localStorage.setItem("agentsview-zoom-level", String(value)), zoom,
      );
      const { sp, refresh, data } = await fixture(page, newestFirst);
      const follow = page.getByLabel("Follow latest messages");
      await follow.click();
      await expect(follow).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => sp.scroller.evaluate((el, reversed) =>
        reversed ? el.scrollTop : el.scrollHeight - el.clientHeight - el.scrollTop,
      newestFirst)).toBeLessThanOrEqual(8);
      await waitForStableValue(() => sp.scroller.evaluate((el) => el.scrollTop), 500);
      // Toggle off WITHOUT a wheel event or moving away from the latest edge.
      await follow.click();
      await expect(follow).toHaveAttribute("aria-pressed", "false");
      const anchor = await sp.scroller.evaluate((el) => {
        const top = el.getBoundingClientRect().top;
        const row = [...el.querySelectorAll<HTMLElement>(".virtual-row")]
          .find((item) => item.getBoundingClientRect().bottom > top)!;
        return { key: row.dataset.messageKey!, top: row.getBoundingClientRect().top - top };
      });
      const top = await sp.scroller.evaluate((el) => el.scrollTop);
      await sampleGeometry(page, anchor);
      for (let revision = 1; revision <= 3; revision++) {
        const marker = `Paused follow revision ${revision}`;
        const next = [...data()];
        next[next.length - 1] = message(next.length - 1,
          `${marker}\n\n${"Additional response text.\n\n".repeat(revision * 12)}`);
        await refresh(next);
        await expect(sp.scroller).toContainText(marker);
        await expect(follow).toHaveAttribute("aria-pressed", "false");
        expect(Math.abs(await sp.scroller.evaluate((el) => el.scrollTop) - top)).toBeLessThanOrEqual(1);
      }
      await finishGeometry(page);
    });
  }
}
