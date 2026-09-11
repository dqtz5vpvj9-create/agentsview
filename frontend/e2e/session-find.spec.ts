import { expect, test, type Page } from "@playwright/test";
import type { Message } from "../src/lib/api/types.js";

const SESSION_ID = "test-session-xlarge-5500";
const QUERY = "needle";
const TOTAL_MATCHES = 7;
const BLOCK_FILTERS = JSON.stringify(["user", "assistant"]);

function fixtureMessages(): Message[] {
  const messages: Message[] = Array.from({ length: 5500 }, (_, ordinal) => {
    const content = `Message ${ordinal}`;
    return {
      id: ordinal + 1,
      session_id: SESSION_ID,
      ordinal,
      role: ordinal % 2 === 0 ? "user" : "assistant",
      content,
      content_length: content.length,
      timestamp: "2026-01-01T00:00:00Z",
      has_thinking: false,
      thinking_text: "",
      has_tool_use: false,
      model: "",
      context_tokens: 0,
      output_tokens: 0,
      is_system: false,
    };
  });
  function replace(ordinal: number, content: string, extra: Partial<Message> = {}) {
    Object.assign(messages[ordinal]!, { content, content_length: content.length }, extra);
  }
  replace(5, "needle first occurrence, needle second occurrence.");
  replace(7, "[Thinking]\nneedle thinking\n[/Thinking]", { has_thinking: true });
  replace(9, "```typescript\nconst needle = 42;\nconst tail = true;\n```");
  replace(12, "", {
    role: "assistant",
    has_tool_use: true,
    tool_calls: [{
      tool_name: "Bash",
      category: "Bash",
      input_json: JSON.stringify({ command: "printf safe" }),
      result_content: `${"output line\n".repeat(80)}needle in output\n`,
      result_events: [{
        event_index: 0,
        status: "completed",
        source: "wait_output",
        content: "needle history\n",
        content_length: 15,
      }],
    }],
  });
  replace(5100, "needle newest occurrence");
  return messages;
}

async function installFixture(page: Page) {
  const messages = fixtureMessages();
  const requests: number[] = [];
  let releaseHistory!: () => void;
  const historyGate = new Promise<void>((resolve) => { releaseHistory = resolve; });
  await page.addInitScript(({ filters }) => {
    localStorage.setItem("agentsview-block-filters", filters);
    localStorage.setItem("agentsview-transcript-mode", "focused");
    localStorage.setItem("agentsview-message-layout", "skim");
  }, { filters: BLOCK_FILTERS });
  await page.route(`**/api/v1/sessions/${SESSION_ID}/messages*`, async (route) => {
    const url = new URL(route.request().url());
    const descending = url.searchParams.get("direction") === "desc";
    const from = Number(url.searchParams.get("from") ?? (descending ? messages.length - 1 : 0));
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    requests.push(from);
    if (descending && from < messages.length - 1) await historyGate;
    const selected = descending
      ? messages.slice(Math.max(0, from - limit + 1), from + 1).reverse()
      : messages.slice(from, from + limit);
    await route.fulfill({ json: { messages: selected, count: selected.length } });
  });
  return { requests, releaseHistory };
}

async function openSession(page: Page) {
  await page.goto(`/sessions/${SESSION_ID}`);
  const transcript = page.locator(".message-list-scroll");
  await expect(transcript).toHaveAttribute("data-messages-session-id", SESSION_ID);
  await expect(transcript).toHaveAttribute("data-loaded", "true");
  return transcript;
}

async function openFind(page: Page) {
  const modifier = await page.evaluate(() => /Mac/.test(navigator.platform) ? "Meta" : "Control");
  await page.keyboard.press(`${modifier}+f`);
  const input = page.locator(".kit-find-bar__input");
  await expect(input).toBeFocused();
  await input.fill(QUERY);
  return input;
}

async function expectCompleteIndex(page: Page) {
  await expect(page.locator(".search-announcement")).toHaveText(
    new RegExp(`^Match \\d+ of ${TOTAL_MATCHES}$`),
  );
}

/** Inspect actual browser ranges and clipping, not a mocked virtualizer. */
async function currentGeometry(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".message-list-scroll");
    const block = root?.querySelector<HTMLElement>('[data-search-current="true"]');
    if (!root || !block) return null;
    const css = CSS as typeof CSS & {
      highlights?: Map<string, Iterable<AbstractRange>>;
    };
    const ranges = Array.from(css.highlights?.get("av-find-current") ?? []);
    const selected = ranges[0];
    const rect = block.getBoundingClientRect();
    let target = rect;
    let text: string | null = null;
    let offset = -1;
    if (selected) {
      if (ranges.length !== 1 || !block.contains(selected.startContainer)) return null;
      const range = document.createRange();
      range.setStart(selected.startContainer, selected.startOffset);
      range.setEnd(selected.endContainer, selected.endOffset);
      target = range.getBoundingClientRect();
      text = range.toString();
      const prefix = document.createRange();
      prefix.selectNodeContents(block);
      prefix.setEnd(selected.startContainer, selected.startOffset);
      offset = prefix.toString().length;
    }
    let top = 0;
    let bottom = innerHeight;
    let left = 0;
    let right = innerWidth;
    for (let node: HTMLElement | null = block; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const clip = node.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
      if (node === root) break;
    }
    return {
      key: block.dataset.searchBlock,
      native: !!selected,
      text,
      offset,
      visible: target.height > 0 && target.bottom > top && target.top < bottom &&
        target.right > left && target.left < right,
    };
  });
}

test.describe("In-session find", () => {
  test.setTimeout(60_000);

  test("loads older history and reveals every occurrence through filters and nested scrolling", async ({ page, browserName }) => {
    const fixture = await installFixture(page);
    try {
      const transcript = await openSession(page);
      await expect(transcript).toHaveClass(/layout-skim/);
      await openFind(page);
      await expect(page.locator(".search-announcement")).toHaveText("Loading older messages…");
      fixture.releaseHistory();
      await expectCompleteIndex(page);
      await expect(transcript).not.toHaveClass(/layout-skim/);
      expect(fixture.requests.some((from) => from < 1000)).toBe(true);

      await page.getByRole("button", { name: "Show search results" }).click();
      await expect(page.getByRole("region", { name: "Search results" })).toBeVisible();
      const blocks = new Set<string>();
      const occurrences = new Set<string>();
      const counter = page.locator(".kit-find-bar__counter");
      for (let index = 0; index < TOTAL_MATCHES; index++) {
        const before = await counter.innerText();
        await page.keyboard.press("F3");
        await expect(counter).not.toHaveText(before);
        await expect.poll(async () => (await currentGeometry(page))?.visible).toBe(true);
        const current = (await currentGeometry(page))!;
        expect(current.key).toBeTruthy();
        blocks.add(current.key!);
        if (browserName === "chromium") expect(current.native).toBe(true);
        if (current.native) {
          expect(current.text).toBe(QUERY);
          occurrences.add(`${current.key}:${current.offset}`);
        }
      }
      expect([...blocks].sort()).toEqual([
        "12:tool-history:0.0", "12:tool-output:0", "5100:text:0",
        "5:text:0", "7:thinking:0", "9:code:0",
      ].sort());
      if (browserName === "chromium") expect(occurrences.size).toBe(TOTAL_MATCHES);
      await expect(transcript.locator("mark")).toHaveCount(0);

      const rail = page.getByRole("button", { name: "7 matches in this session" });
      await rail.focus();
      await rail.press("Home");
      await expect(transcript.locator('[data-search-current="true"]')).toHaveAttribute(
        "data-search-block", "5:text:0",
      );
      await expect.poll(async () => (await currentGeometry(page))?.visible).toBe(true);
      await rail.press("End");
      await expect(transcript.locator('[data-search-current="true"]')).toHaveAttribute(
        "data-search-block", "5100:text:0",
      );
      await expect.poll(async () => (await currentGeometry(page))?.visible).toBe(true);

      // The visible virtualized result button must navigate the transcript too.
      await page.locator(".find-result-button").first().click();
      await expect.poll(async () => (await currentGeometry(page))?.visible).toBe(true);
      await page.keyboard.press("Escape");
      await expect(page.locator(".session-find")).toHaveCount(0);
      await expect(page.locator("#session-find-results")).toHaveCount(0);
      await expect(transcript).toHaveClass(/layout-skim/);
      await expect(transcript.locator("[data-search-current]")).toHaveCount(0);
      expect(await page.evaluate(() => ({
        filters: localStorage.getItem("agentsview-block-filters"),
        mode: localStorage.getItem("agentsview-transcript-mode"),
        layout: localStorage.getItem("agentsview-message-layout"),
      }))).toEqual({ filters: BLOCK_FILTERS, mode: "focused", layout: "skim" });
    } finally {
      fixture.releaseHistory();
    }
  });

  test("keeps counts and block navigation without the Highlight API", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "Highlight", { configurable: true, value: undefined });
    });
    const fixture = await installFixture(page);
    fixture.releaseHistory();
    const transcript = await openSession(page);
    const input = await openFind(page);
    await expectCompleteIndex(page);
    await input.fill("needle history");
    await expect(page.locator(".search-announcement")).toHaveText(/^Match \d+ of 1$/);
    await page.keyboard.press("F3");
    const current = transcript.locator('[data-search-current="true"]');
    await expect(current).toHaveAttribute("data-search-block", "12:tool-history:0.0");
    await expect.poll(async () => (await currentGeometry(page))?.visible).toBe(true);
    await expect(current).toHaveText("needle history\n");
    await expect(transcript.locator("mark")).toHaveCount(0);
  });

  test("rapid edits and closing do not resurrect stale ranges", async ({ page }) => {
    const fixture = await installFixture(page);
    fixture.releaseHistory();
    const transcript = await openSession(page);
    const input = await openFind(page);
    await expectCompleteIndex(page);
    await input.fill("needle history");
    await input.fill("no-such-search-occurrence");
    await expect(transcript.locator("[data-search-current]")).toHaveCount(0);
    await expect(page.locator(".search-announcement")).not.toContainText("Match ");
    await input.fill(QUERY);
    await input.press("Escape");
    await expect(page.locator(".session-find")).toHaveCount(0);
    // Two rendering frames cover the mutation-observer repaint after teardown.
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await expect(transcript.locator("[data-search-current]")).toHaveCount(0);
    expect(await page.evaluate(() => {
      const css = CSS as typeof CSS & { highlights?: Map<string, unknown> };
      return [css.highlights?.has("av-find"), css.highlights?.has("av-find-current")];
    })).not.toContain(true);
  });

  test("switching sessions cancels a pending historical reveal", async ({ page }) => {
    const fixture = await installFixture(page);
    try {
      await openSession(page);
      await openFind(page);
      await expect(page.locator(".search-announcement")).toHaveText("Loading older messages…");
      const nextSession = page.locator(`.session-item:not([data-session-id="${SESSION_ID}"])`).first();
      const nextId = await nextSession.getAttribute("data-session-id");
      expect(nextId).toBeTruthy();
      await nextSession.click();
      const transcript = page.locator(".message-list-scroll");
      await expect(transcript).toHaveAttribute("data-messages-session-id", nextId!);
      fixture.releaseHistory();
      await expect(transcript).toHaveAttribute("data-loaded", "true");
      await expect(transcript.locator("[data-search-current]")).toHaveCount(0);
      await expect(transcript).toHaveAttribute("data-messages-session-id", nextId!);
    } finally {
      fixture.releaseHistory();
    }
  });
});
