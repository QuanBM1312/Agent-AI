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
const sidebarTabs = [
  {
    label: "Nạp Tri thức",
    pathPattern: /\/knowledge(\/|$)/,
    readyText: /Cổng Nạp Tri thức/i,
    secondaryText: /Nguồn dữ liệu kết nối/i,
  },
  {
    label: "Lịch hẹn",
    pathPattern: /\/scheduling(\/|$)/,
    readyText: /Đã phân công/i,
  },
  {
    label: "Báo cáo",
    pathPattern: /\/reports(\/|$)/,
    readyText: /Quản lý Báo cáo/i,
  },
  {
    label: "Tồn kho",
    pathPattern: /\/storage(\/|$)/,
    readyText: /Quản lý Tồn kho/i,
  },
  {
    label: "Khách hàng",
    pathPattern: /\/customers(\/|$)/,
    readyText: /Quản lý Khách hàng/i,
  },
  {
    label: "Nhân sự",
    pathPattern: /\/users(\/|$)/,
    readyText: /Quản lý Nhân sự/i,
  },
];

async function ensureSidebarButton(label) {
  const button = page.getByRole("button", { name: new RegExp(label, "i") });
  await ensureVisible(button);
  return button;
}

async function verifySidebarFlow() {
  await ensureVisible(page.getByPlaceholder("Nhập tin nhắn..."));
  await ensureSidebarButton("Trợ lý AI");

  for (const tab of sidebarTabs) {
    await ensureSidebarButton(tab.label);
  }

  const result = {
    buttonsVisible: true,
  };

  await (await ensureSidebarButton("Nạp Tri thức")).click();
  await page.waitForURL(/\/knowledge(\/|$)/, { timeout: 30_000 });
  await ensureVisible(page.getByText(/Cổng Nạp Tri thức/i).first());
  await ensureVisible(page.getByText(/Nguồn dữ liệu kết nối/i).first());
  result.knowledgeVisible = true;

  await (await ensureSidebarButton("Trợ lý AI")).click();
  await page.waitForURL(/\/chat\/[^/]+$/, { timeout: 30_000 });
  await ensureVisible(page.getByPlaceholder("Nhập tin nhắn..."));
  result.chatReturnOk = true;

  for (const tab of sidebarTabs.slice(1)) {
    await (await ensureSidebarButton(tab.label)).click();
    await page.waitForURL(tab.pathPattern, { timeout: 30_000 });
    await ensureVisible(page.getByText(tab.readyText).first());

    if (tab.secondaryText) {
      await ensureVisible(page.getByText(tab.secondaryText).first());
    }
  }

  return result;
}
async function writeStepSummary(result) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  const lines = [
    "## Production E2E Summary",
    "",
    `- Base URL: \`${result.baseUrl}\``,
    `- Account: \`${result.account}\``,
    `- Final URL: \`${result.finalPageUrl || "n/a"}\``,
    `- Auth probe: \`${result.authProbe?.status ?? "n/a"}\``,
    `- Sessions probe: \`${result.sessionsProbe?.status ?? "n/a"}\``,
    `- Chat probe: \`${result.chatProbe?.status ?? "n/a"}\``,
    "",
    "### Assertions",
  ];

  for (const [name, value] of Object.entries(result.assertions || {})) {
    lines.push(`- ${name}: \`${value ? "pass" : "fail"}\``);
  }

  if (result.error) {
    lines.push("");
    lines.push("### Error");
    lines.push("");
    lines.push(`\`${String(result.error)}\``);
  }

  await fs.appendFile(summaryPath, `${lines.join("\n")}\n`);
}

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
  const landedOnChatAfterSignIn = /\/chat(\/|$)/.test(page.url());
  artifact.sidebarProbe = await verifySidebarFlow();
  artifact.sidebarScreenshot = await screenshot("sidebar-smoke.png");

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
    redirectedToChat: landedOnChatAfterSignIn,
    authOk: authProbe.status === 200 && authProbe.body?.success === true,
    sessionsOk: sessionsProbe.status === 200 && Array.isArray(sessionsProbe.body?.data),
    chatOk: chatProbe.status === 200,
    assistantMatched,
    sidebarButtonsVisible: artifact.sidebarProbe?.buttonsVisible === true,
    knowledgeVisible: artifact.sidebarProbe?.knowledgeVisible === true,
    chatReturnOk: artifact.sidebarProbe?.chatReturnOk === true,
  };

  if (!Object.values(artifact.assertions).every(Boolean)) {
    throw new Error(`Production E2E assertions failed: ${JSON.stringify(artifact.assertions)}`);
  }

  await fs.writeFile(
    path.join(artifactDir, "result.json"),
    JSON.stringify(artifact, null, 2),
  );
  await writeStepSummary(artifact);
} catch (error) {
  artifact.error = error instanceof Error ? error.message : String(error);
  await fs.writeFile(
    path.join(artifactDir, "result.json"),
    JSON.stringify(artifact, null, 2),
  );
  await writeStepSummary(artifact);
  throw error;
} finally {
  await browser.close();
}
