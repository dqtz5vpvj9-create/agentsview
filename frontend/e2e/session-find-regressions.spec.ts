import { expect, test, type Page } from "@playwright/test";
import type { Message } from "../src/lib/api/types.js";

const SESSION_ID = "test-session-xlarge-5500";
function message(ordinal: number, content: string, extra: Partial<Message> = {}): Message {
  return { id: 990000 + ordinal, session_id: SESSION_ID, ordinal, role: "assistant", content,
    content_length: content.length, timestamp: "2026-01-01T00:00:00Z", has_thinking: false,
    thinking_text: "", has_tool_use: false, model: "", context_tokens: 0, output_tokens: 0,
    is_system: false, ...extra };
}

async function installMessages(page: Page, all: Message[], failTail = false) {
  const control = { failTail };
  await page.addInitScript(() => {
    localStorage.setItem("agentsview-block-filters", JSON.stringify(["user", "assistant", "tool"]));
    localStorage.setItem("agentsview-transcript-mode", "normal");
  });
  // Reuse the existing backend session; only its message window is controlled.
  await page.route(`**/api/v1/sessions/${SESSION_ID}`, async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    await route.fulfill({ response, json: { ...session, message_count: all.length } });
  });
  await page.route(`**/api/v1/sessions/${SESSION_ID}/messages*`, async (route) => {
    const url = new URL(route.request().url());
    const descending = url.searchParams.get("direction") === "desc";
    const from = Number(url.searchParams.get("from") ?? (descending ? all.length - 1 : 0));
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    if (!descending && from >= 1000 && control.failTail) {
      await route.fulfill({ status: 503, json: { error: "injected history failure" } });
      return;
    }
    const messages = descending ? all.slice(Math.max(0, from - limit + 1), from + 1).reverse()
      : all.slice(from, from + limit);
    await route.fulfill({ json: { messages, count: messages.length } });
  });
  await page.goto(`/sessions/${SESSION_ID}`);
  await expect(page.locator(".message-list-scroll")).toHaveAttribute("data-loaded", "true");
  return control;
}

async function find(page: Page) {
  const modifier = await page.evaluate(() => /Mac/.test(navigator.platform) ? "Meta" : "Control");
  await page.keyboard.press(`${modifier}+f`);
  const input = page.locator(".kit-find-bar__input");
  await expect(input).toBeFocused();
  await input.fill("needle");
  return input;
}

test.describe("session find audit regressions", () => {
  for (const structured of [true, false]) {
    test(`finds thinking inside ${structured ? "structured" : "legacy"} tool groups`, async ({ page }) => {
      const content = "[Thinking]\nneedle needle\n[/Thinking]" + (structured ? "" : "\n[Bash]\necho done");
      await installMessages(page, [message(0, content, { has_tool_use: true, has_thinking: true,
        tool_calls: structured ? [{ tool_name: "Bash", category: "Bash", result_content: "ordinary" }] : undefined })]);
      await find(page);
      await expect(page.locator(".search-announcement")).toHaveText("Match 1 of 2");
      const current = page.locator('[data-search-current="true"]');
      await expect(current).toHaveAttribute("data-search-block", "0:thinking:0");
      await expect(current).toBeVisible();
      await page.keyboard.press("F3");
      await expect(page.locator(".search-announcement")).toHaveText("Match 2 of 2");
      await expect(current).toHaveAttribute("data-search-block", "0:thinking:0");
      await expect(current).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".thinking-header")).toHaveCount(0);
    });
  }

  for (const earlyHit of [true, false]) {
    test(`recovers a failed forward page with earlyHit=${earlyHit}`, async ({ page }) => {
      const all = Array.from({ length: 1500 }, (_, ordinal) =>
        message(ordinal, ordinal === 1200 || earlyHit && ordinal === 5 ? "needle" : `Ordinary message ${ordinal}`));
      const control = await installMessages(page, all, true);
      await find(page);
      const retry = page.getByRole("button", { name: "Retry loading history" });
      await expect(retry).toBeVisible();
      await expect(page.locator(".search-announcement")).toContainText("Results are incomplete.");
      control.failTail = false;
      await retry.click();
      const total = earlyHit ? 2 : 1;
      await expect(page.locator(".search-announcement")).toHaveText(new RegExp(`^Match \\d+ of ${total}$`));
      await expect(retry).toHaveCount(0);
      if (earlyHit) await page.keyboard.press("F3");
      await expect(page.locator('[data-search-current="true"]')).toHaveAttribute("data-search-block", "1200:text:0");
      await expect(page.locator('[data-search-current="true"]')).toBeInViewport();
    });
  }

  test("reveals a closed native disclosure and can reselect the only match", async ({ page }) => {
    await installMessages(page, [message(0,
      "<details><summary>Computation details</summary><p>needle</p></details>")]);
    await find(page);
    const details = page.locator(".message-list-scroll details");
    const target = details.locator("p");
    await expect(details).toHaveAttribute("open", "");
    await expect.poll(() => target.evaluate((element) => element.checkVisibility({ checkVisibilityCSS: true }))).toBe(true);
    await expect(target).toBeInViewport();
    await details.locator("summary").click();
    await expect(details).not.toHaveAttribute("open", "");
    await page.keyboard.press("F3");
    await expect(details).toHaveAttribute("open", "");
    await expect.poll(() => target.evaluate((element) => element.checkVisibility({ checkVisibilityCSS: true }))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(details).not.toHaveAttribute("open", "");
  });
});
