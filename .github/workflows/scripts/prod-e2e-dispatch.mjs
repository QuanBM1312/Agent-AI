import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.env.E2E_BASE_URL || "").replace(/\/$/, "");
const email = process.env.E2E_EMAIL || "";
const password = process.env.E2E_PASSWORD || "";
const artifactDir = "/tmp/prod-e2e-dispatch";

for (const [name, value] of [
  ["E2E_BASE_URL", baseUrl],
  ["E2E_EMAIL", email],
  ["E2E_PASSWORD", password],
]) {
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
}

await fs.mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
});

const context = await browser.newContext({
  locale: "vi-VN",
});
const page = await context.newPage();

async function screenshot(name) {
  const filePath = path.join(artifactDir, name);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function ensureVisible(locator, timeout = 30_000) {
  await locator.waitFor({ state: "visible", timeout });
}

async function clickClerkContinue(page) {
  for (const name of ["Continue", "Tiếp tục", "Đăng nhập", "Sign in"]) {
    const button = page.getByRole("button", { name, exact: true }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return;
    }
  }

  const fallback = page.locator('button[type="submit"]').first();
  await ensureVisible(fallback);
  await fallback.click();
}

async function probe(endpoint) {
  const response = await context.request.get(`${baseUrl}${endpoint}`, {
    headers: { accept: "application/json" },
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep text fallback
  }
  return {
    endpoint,
    status: response.status(),
    ok: response.ok(),
    body,
  };
}

async function postChat(sessionId, prompt) {
  const response = await context.request.post(`${baseUrl}/api/chat/n8n`, {
    multipart: {
      sessionId,
      type: "chat",
      chatInput: prompt,
      clientMessageId: randomUUID(),
    },
    headers: {
      accept: "application/json",
    },
    timeout: 120_000,
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep text fallback
  }
  return {
    status: response.status(),
    ok: response.ok(),
    headers: {
      requestId: response.headers()["x-chat-request-id"] ?? null,
      routeHint: response.headers()["x-chat-route-hint"] ?? null,
    },
    body,
  };
}

const artifact = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  account: email,
};

try {
  await page.goto(`${baseUrl}/sign-in`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  artifact.signInStartScreenshot = await screenshot("signin-start.png");

  await ensureVisible(page.locator('input[name="identifier"]'));
  await page.locator('input[name="identifier"]').fill(email);
  await clickClerkContinue(page);
  artifact.signInAfterEmailScreenshot = await screenshot("signin-after-email.png");

  await ensureVisible(page.locator('input[name="password"]'));
  await page.locator('input[name="password"]').fill(password);
  await clickClerkContinue(page);

  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
  await page.waitForURL(/\/chat(\/|$)/, { timeout: 60_000 }).catch(() => {});
  artifact.signInAfterPasswordScreenshot = await screenshot("signin-after-password.png");
  artifact.finalPageUrl = page.url();
  artifact.pageTitle = await page.title();

  const authProbe = await probe("/api/test-auth");
  const sessionsProbe = await probe("/api/chat/sessions");
  artifact.authProbe = authProbe;
  artifact.sessionsProbe = sessionsProbe;

  const promptToken = `GH_E2E_${Date.now()}`;
  const sessionId = randomUUID();
  const chatProbe = await postChat(
    sessionId,
    `Đây là smoke test production. Chỉ trả lời đúng chuỗi sau: ${promptToken}`,
  );
  const messagesProbe = await probe(`/api/chat/messages?session_id=${sessionId}`);

  artifact.chatProbe = chatProbe;
  artifact.messagesProbe = messagesProbe;

  const assistantMatched =
    Array.isArray(messagesProbe.body?.data) &&
    messagesProbe.body.data.some(
      (message) =>
        message?.role === "assistant" &&
        typeof message?.content === "string" &&
        message.content.includes(promptToken),
    );

  artifact.assertions = {
    redirectedToChat: /\/chat(\/|$)/.test(page.url()),
    authOk: authProbe.status === 200 && authProbe.body?.success === true,
    sessionsOk: sessionsProbe.status === 200 && Array.isArray(sessionsProbe.body?.data),
    chatOk: chatProbe.status === 200,
    assistantMatched,
  };

  if (!Object.values(artifact.assertions).every(Boolean)) {
    throw new Error(`Production E2E assertions failed: ${JSON.stringify(artifact.assertions)}`);
  }

  await fs.writeFile(
    path.join(artifactDir, "result.json"),
    JSON.stringify(artifact, null, 2),
  );
} catch (error) {
  artifact.error = error instanceof Error ? error.message : String(error);
  await fs.writeFile(
    path.join(artifactDir, "result.json"),
    JSON.stringify(artifact, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
