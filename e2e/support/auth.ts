import fs from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "playwright/test";

export async function ensureAuthStateDirectory(authStatePath: string) {
  await fs.mkdir(path.dirname(authStatePath), { recursive: true });
}

export async function authenticateWithClerk(page: Page, options: {
  baseURL: string;
  email: string;
  password: string;
}) {
  const { baseURL, email, password } = options;

  await page.goto(`${baseURL}/sign-in`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });

  const identifierInput = page.locator('input[name="identifier"]');
  await identifierInput.waitFor({ state: "visible", timeout: 30_000 });
  await identifierInput.fill(email);
  await clickClerkContinue(page);

  const passwordInput = page.locator('input[name="password"]');
  await passwordInput.waitFor({ state: "visible", timeout: 30_000 });
  await passwordInput.fill(password);
  await clickClerkContinue(page);

  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await page.goto(`${baseURL}/chat`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await ensureChatReady(page);
}

export async function ensureChatReady(page: Page) {
  await page.waitForURL(/\/chat(\/|$)/, { timeout: 60_000 }).catch(() => {});
  await expect(page.getByPlaceholder("Nhập tin nhắn...")).toBeVisible({
    timeout: 60_000,
  });
}

async function clickClerkContinue(page: Page) {
  for (const name of ["Continue", "Tiếp tục", "Đăng nhập", "Sign in"]) {
    const button = page.getByRole("button", { name, exact: true }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return;
    }
  }

  const fallback = page.locator('button[type="submit"]').first();
  await fallback.waitFor({ state: "visible", timeout: 30_000 });
  await fallback.click();
}

export function getChatSessionIdFromUrl(page: Page) {
  const url = new URL(page.url());
  const segments = url.pathname.split("/").filter(Boolean);
  const chatIndex = segments.indexOf("chat");

  if (chatIndex === -1 || chatIndex === segments.length - 1) {
    throw new Error(`Unable to derive chat session id from URL: ${page.url()}`);
  }

  return segments[chatIndex + 1];
}
