import { expect, test } from "playwright/test";
import { ensureChatReady } from "./support/auth";

test("authenticated session can reach guarded chat APIs", async ({ page }) => {
  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  await ensureChatReady(page);

  const authProbe = await page.evaluate(async () => {
    const response = await fetch("/api/test-auth", {
      headers: { accept: "application/json" },
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  });

  expect(authProbe.status).toBe(200);
  expect(authProbe.body?.success).toBe(true);
  expect(authProbe.body?.user?.id).toBeTruthy();

  const sessionsProbe = await page.evaluate(async () => {
    const response = await fetch("/api/chat/sessions", {
      headers: { accept: "application/json" },
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  });

  expect(sessionsProbe.status).toBe(200);
  expect(Array.isArray(sessionsProbe.body?.data)).toBe(true);
});
