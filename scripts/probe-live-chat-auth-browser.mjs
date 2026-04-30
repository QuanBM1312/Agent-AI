#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(`Usage:
  LIVE_PROBE_BASE_URL=https://your-app.example.com \\
  LIVE_PROBE_EMAIL='user@example.com' \\
  LIVE_PROBE_PASSWORD='secret' \\
  npm run probe:live:chat-auth:browser

Environment variables:
  LIVE_PROBE_BASE_URL      Base app URL. Default: https://aioperation.dieuhoathanglong.com.vn
  LIVE_PROBE_EMAIL         Clerk sign-in email. Required.
  LIVE_PROBE_PASSWORD      Clerk sign-in password. Required.
  LIVE_PROBE_HEADLESS      Set to 0 for headed mode. Default: 1
  LIVE_PROBE_CHAT_INPUT    Optional chat smoke-test prompt. Default: Xin chào, hãy trả lời ngắn gọn rằng kênh chat đang hoạt động.
  LIVE_PROBE_SKIP_CHAT_SEND Set to 1 to skip the chat send smoke test.
  LIVE_PROBE_OUTPUT        JSON artifact path. Default: docs/artifacts/live-auth-probe/latest.json
  LIVE_PROBE_SCREENSHOT_DIR Screenshot directory. Default: docs/artifacts/live-auth-probe
`);
  process.exit(0);
}

const baseUrl = (process.env.LIVE_PROBE_BASE_URL ||
  "https://aioperation.dieuhoathanglong.com.vn").replace(/\/$/, "");
const email = process.env.LIVE_PROBE_EMAIL;
const password = process.env.LIVE_PROBE_PASSWORD;
const headless = process.env.LIVE_PROBE_HEADLESS !== "0";
const chatInput =
  process.env.LIVE_PROBE_CHAT_INPUT ||
  "Xin chào, hãy trả lời ngắn gọn rằng kênh chat đang hoạt động.";
const skipChatSend = process.env.LIVE_PROBE_SKIP_CHAT_SEND === "1";
const outputPath =
  process.env.LIVE_PROBE_OUTPUT ||
  path.join(projectRoot, "docs", "artifacts", "live-auth-probe", "latest.json");
const screenshotDir =
  process.env.LIVE_PROBE_SCREENSHOT_DIR ||
  path.join(projectRoot, "docs", "artifacts", "live-auth-probe");

for (const [name, value] of [
  ["LIVE_PROBE_EMAIL", email],
  ["LIVE_PROBE_PASSWORD", password],
]) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${commandArgs.join(" ")} failed with code ${code}\n${stderr || stdout}`,
        ),
      );
    });
  });
}

async function installPlaywright(tmpDir) {
  await fs.writeFile(
    path.join(tmpDir, "package.json"),
    JSON.stringify({ private: true, name: "live-auth-probe" }, null, 2),
  );
  await run("npm", ["install", "playwright", "--no-save"], { cwd: tmpDir });
}

async function main() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-auth-probe-"));

  try {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.mkdir(screenshotDir, { recursive: true });

    await installPlaywright(tmpDir);

    const runnerPath = path.join(tmpDir, "runner.mjs");
    await fs.writeFile(
      runnerPath,
      `
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = ${JSON.stringify(baseUrl)};
const email = process.env.LIVE_PROBE_EMAIL;
const password = process.env.LIVE_PROBE_PASSWORD;
const headless = process.env.LIVE_PROBE_HEADLESS !== "0";
const chatInput = ${JSON.stringify(chatInput)};
const skipChatSend = process.env.LIVE_PROBE_SKIP_CHAT_SEND === "1";
const screenshotDir = ${JSON.stringify(screenshotDir)};

const browser = await chromium.launch({ headless });
const context = await browser.newContext();
const page = await context.newPage();

async function safeScreenshot(name) {
  const filePath = path.join(screenshotDir, name);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function probe(endpoint) {
  const response = await context.request.get(\`\${baseUrl}\${endpoint}\`, {
    headers: {
      accept: "application/json",
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {
    endpoint,
    status: response.status(),
    ok: response.ok(),
    headers: {
      "x-clerk-auth-status": response.headers()["x-clerk-auth-status"] ?? null,
      "x-clerk-auth-reason": response.headers()["x-clerk-auth-reason"] ?? null,
      "x-vercel-id": response.headers()["x-vercel-id"] ?? null,
      "content-type": response.headers()["content-type"] ?? null,
    },
    body,
  };
}

async function postChat(sessionId) {
  const clientMessageId = crypto.randomUUID();
  const response = await context.request.post(\`\${baseUrl}/api/chat/n8n\`, {
    multipart: {
      sessionId,
      type: "chat",
      chatInput,
      clientMessageId,
    },
    headers: {
      accept: "application/json",
    },
    timeout: 120000,
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return {
    endpoint: "/api/chat/n8n",
    status: response.status(),
    ok: response.ok(),
    headers: {
      "x-chat-request-id": response.headers()["x-chat-request-id"] ?? null,
      "x-chat-route-hint": response.headers()["x-chat-route-hint"] ?? null,
      "x-chat-duration-ms": response.headers()["x-chat-duration-ms"] ?? null,
      "content-type": response.headers()["content-type"] ?? null,
    },
    request: {
      sessionId,
      clientMessageId,
      chatInput,
    },
    body,
  };
}

try {
  await page.goto(\`\${baseUrl}/sign-in\`, { waitUntil: "networkidle", timeout: 60000 });
  const firstShot = await safeScreenshot("signin-start.png");

  await page.locator('input[name="identifier"]').waitFor({ timeout: 30000 });
  await page.locator('input[name="identifier"]').fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const secondShot = await safeScreenshot("signin-after-email.png");

  await page.locator('input[name="password"]').waitFor({ timeout: 30000 });
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const thirdShot = await safeScreenshot("signin-after-password.png");

  const apiResults = [];
  for (const endpoint of ["/api/version", "/api/test-auth", "/api/chat/sessions"]) {
    apiResults.push(await probe(endpoint));
  }

  const sessionId = crypto.randomUUID();
  let chatResult = null;
  let messagesResult = null;

  if (!skipChatSend) {
    chatResult = await postChat(sessionId);
    messagesResult = await probe(\`/api/chat/messages?session_id=\${sessionId}\`);
  }

  const cookies = await context.cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "__session");

  const artifact = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    screenshots: {
      start: firstShot,
      afterEmail: secondShot,
      afterPassword: thirdShot,
    },
    page: {
      url: page.url(),
      title: await page.title(),
    },
    sessionCookiePresent: Boolean(sessionCookie),
    smokeTestSessionId: sessionId,
    results: apiResults,
    chatResult,
    messagesResult,
  };

  console.log(JSON.stringify(artifact));
  await browser.close();
} catch (error) {
  const artifact = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    error: error instanceof Error ? error.message : String(error),
    page: {
      url: page.url(),
      title: await page.title().catch(() => null),
    },
  };
  console.log(JSON.stringify(artifact));
  await browser.close();
  process.exit(1);
}
`,
    );

    const { stdout } = await run("node", [runnerPath], {
      cwd: tmpDir,
      env: {
        ...process.env,
        LIVE_PROBE_EMAIL: email,
        LIVE_PROBE_PASSWORD: password,
        LIVE_PROBE_HEADLESS: headless ? "1" : "0",
        LIVE_PROBE_SKIP_CHAT_SEND: skipChatSend ? "1" : "0",
      },
    });

    const artifact = JSON.parse(stdout.trim());
    await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`Saved live auth browser probe to ${path.relative(projectRoot, outputPath)}`);

    const failed =
      artifact.error ||
      (Array.isArray(artifact.results) && artifact.results.some((result) => !result.ok));

    process.exit(failed ? 1 : 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
