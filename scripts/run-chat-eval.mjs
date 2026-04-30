#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const DEFAULT_EVAL_SET_PATH = path.join(projectRoot, "docs", "chat-evaluation-set.json");
const DEFAULT_OUTPUT_PATH = path.join(
  projectRoot,
  "docs",
  "artifacts",
  "chat-eval",
  "latest.json",
);
const DEFAULT_FILE_FIXTURE = path.join(
  projectRoot,
  "docs",
  "artifacts",
  "chat-eval",
  "sample-file-backed.txt",
);

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(`Usage:
  CHAT_EVAL_BASE_URL=https://example.com \\
  CHAT_EVAL_COOKIE='__session=...' \\
  npm run eval:chat

Environment variables:
  CHAT_EVAL_BASE_URL    Base app URL. Default: http://localhost:3000
  CHAT_EVAL_COOKIE      Raw Cookie header for an authenticated user session.
  CHAT_EVAL_EMAIL       Optional Clerk sign-in email used when CHAT_EVAL_COOKIE is absent.
  CHAT_EVAL_PASSWORD    Optional Clerk sign-in password used when CHAT_EVAL_COOKIE is absent.
  CHAT_EVAL_SET         Path to evaluation-set JSON. Default: docs/chat-evaluation-set.json
  CHAT_EVAL_OUTPUT      Output artifact path. Default: docs/artifacts/chat-eval/latest.json
  CHAT_EVAL_FILE_PATH   File fixture for file-backed case. Default: docs/artifacts/chat-eval/sample-file-backed.txt
  CHAT_EVAL_SESSION_ID  Reuse an existing chat session instead of creating a fresh one
`);
  process.exit(0);
}

function assertEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
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
    JSON.stringify({ private: true, name: "chat-eval-auth" }, null, 2),
  );
  await run("npm", ["install", "playwright", "--no-save"], { cwd: tmpDir });
}

async function acquireSessionCookie({ baseUrl, email, password }) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chat-eval-auth-"));

  try {
    await installPlaywright(tmpDir);

    const runnerPath = path.join(tmpDir, "runner.mjs");
    await fs.writeFile(
      runnerPath,
      `
import { chromium } from "playwright";

const baseUrl = ${JSON.stringify(baseUrl)};
const email = process.env.CHAT_EVAL_EMAIL;
const password = process.env.CHAT_EVAL_PASSWORD;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

try {
  await page.goto(\`\${baseUrl}/sign-in\`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[name="identifier"]').waitFor({ timeout: 30000 });
  await page.locator('input[name="identifier"]').fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('input[name="password"]').waitFor({ timeout: 30000 });
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const cookies = await context.cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "__session");

  if (!sessionCookie) {
    throw new Error("Missing __session cookie after live sign-in");
  }

  console.log(cookies.map((cookie) => \`\${cookie.name}=\${cookie.value}\`).join("; "));
  await browser.close();
} catch (error) {
  await browser.close();
  throw error;
}
`,
    );

    const { stdout } = await run("node", [runnerPath], {
      cwd: tmpDir,
      env: {
        ...process.env,
        CHAT_EVAL_EMAIL: email,
        CHAT_EVAL_PASSWORD: password,
      },
    });

    const cookie = stdout.trim();

    if (!cookie.includes("__session=")) {
      throw new Error("Failed to acquire authenticated chat evaluation cookie");
    }

    return cookie;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function buildHeaders(cookie) {
  return {
    cookie,
    accept: "application/json",
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function createSession({ baseUrl, cookie }) {
  const response = await fetch(`${baseUrl}/api/chat/sessions`, {
    method: "POST",
    headers: {
      ...buildHeaders(cookie),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      summary: `Chat evaluation ${new Date().toISOString()}`,
    }),
  });

  const body = await parseJsonResponse(response);

  if (!response.ok || !body?.id) {
    throw new Error(
      `Failed to create chat session (${response.status}): ${JSON.stringify(body)}`,
    );
  }

  return body.id;
}

function summarizeBody(body) {
  if (body == null) {
    return null;
  }

  if (typeof body === "string") {
    return body.slice(0, 400);
  }

  if (typeof body === "object") {
    if (typeof body.output === "string") {
      return body.output.slice(0, 400);
    }

    if (typeof body.message === "string") {
      return body.message.slice(0, 400);
    }
  }

  return JSON.stringify(body).slice(0, 400);
}

async function runCase({ baseUrl, cookie, sessionId, fileFixture, testCase, caseIndex }) {
  const formData = new FormData();
  formData.set("sessionId", sessionId);
  formData.set("type", "chat");
  formData.set("chatInput", testCase.input);
  formData.set("clientMessageId", `eval-${testCase.id}-${Date.now()}-${caseIndex}`);

  if (testCase.category === "file_attachment") {
    const fileBuffer = await fs.readFile(fileFixture);
    const file = new File([fileBuffer], path.basename(fileFixture), {
      type: "text/plain",
    });
    formData.set("file", file);
  }

  const startedAtMs = Date.now();
  const response = await fetch(`${baseUrl}/api/chat/n8n`, {
    method: "POST",
    headers: buildHeaders(cookie),
    body: formData,
  });
  const completedAtMs = Date.now();
  const durationMs = completedAtMs - startedAtMs;
  const body = await parseJsonResponse(response);

  const routeHint =
    response.headers.get("x-chat-route-hint") ||
    (typeof body === "object" && body?._meta?.routeHint) ||
    null;
  const requestId =
    response.headers.get("x-chat-request-id") ||
    (typeof body === "object" && body?._meta?.requestId) ||
    null;
  const serverDurationMs =
    response.headers.get("x-chat-duration-ms") ||
    (typeof body === "object" && body?._meta?.durationMs) ||
    null;

  return {
    id: testCase.id,
    category: testCase.category,
    input: testCase.input,
    expectedBehavior: testCase.expectedBehavior,
    status: response.status,
    ok: response.ok,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs,
    serverDurationMs,
    routeHint,
    requestId,
    bodySummary: summarizeBody(body),
    responseBody: body,
  };
}

async function runCaseWithAuthRetry({
  baseUrl,
  cookie,
  sessionId,
  fileFixture,
  testCase,
  caseIndex,
  refreshCookie,
}) {
  let currentCookie = cookie;
  let result = await runCase({
    baseUrl,
    cookie: currentCookie,
    sessionId,
    fileFixture,
    testCase,
    caseIndex,
  });

  if (result.status !== 401 || !refreshCookie) {
    return { result, cookie: currentCookie };
  }

  currentCookie = await refreshCookie();
  result = await runCase({
    baseUrl,
    cookie: currentCookie,
    sessionId,
    fileFixture,
    testCase,
    caseIndex,
  });

  return { result, cookie: currentCookie };
}

function buildSummary(results) {
  const total = results.length;
  const successCount = results.filter((result) => result.ok).length;
  const failureCount = total - successCount;
  const averageDurationMs =
    total > 0
      ? Math.round(
          results.reduce((sum, result) => sum + result.durationMs, 0) / total,
        )
      : 0;

  return {
    total,
    successCount,
    failureCount,
    averageDurationMs,
    routeHints: results.reduce((acc, result) => {
      const key = result.routeHint || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };
}

async function writeArtifact(outputPath, artifact) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(artifact, null, 2));
}

async function main() {
  const baseUrl = normalizeBaseUrl(
    process.env.CHAT_EVAL_BASE_URL || "http://localhost:3000",
  );
  const canRefreshCookie = Boolean(
    !process.env.CHAT_EVAL_COOKIE &&
      process.env.CHAT_EVAL_EMAIL &&
      process.env.CHAT_EVAL_PASSWORD,
  );
  const refreshCookie = async () =>
    await acquireSessionCookie({
      baseUrl,
      email: assertEnv("CHAT_EVAL_EMAIL", process.env.CHAT_EVAL_EMAIL),
      password: assertEnv("CHAT_EVAL_PASSWORD", process.env.CHAT_EVAL_PASSWORD),
    });
  let cookie =
    process.env.CHAT_EVAL_COOKIE ||
    (canRefreshCookie
      ? await refreshCookie()
      : assertEnv("CHAT_EVAL_COOKIE", process.env.CHAT_EVAL_COOKIE));
  const evaluationSetPath = process.env.CHAT_EVAL_SET || DEFAULT_EVAL_SET_PATH;
  const outputPath = process.env.CHAT_EVAL_OUTPUT || DEFAULT_OUTPUT_PATH;
  const fileFixture = process.env.CHAT_EVAL_FILE_PATH || DEFAULT_FILE_FIXTURE;

  const evaluationSet = JSON.parse(await fs.readFile(evaluationSetPath, "utf8"));
  const artifactBase = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    evaluationSetPath: path.relative(projectRoot, evaluationSetPath),
    fileFixture: path.relative(projectRoot, fileFixture),
  };

  let sessionId = process.env.CHAT_EVAL_SESSION_ID;

  if (!sessionId) {
    try {
      sessionId = await createSession({ baseUrl, cookie });
    } catch (error) {
      const artifact = {
        ...artifactBase,
        sessionId: null,
        summary: buildSummary([]),
        setupError: error instanceof Error ? error.message : String(error),
        setupStage: "create_session",
        results: [],
      };

      await writeArtifact(outputPath, artifact);
      console.log(`Saved failure artifact to ${path.relative(projectRoot, outputPath)}`);
      throw error;
    }
  }

  const results = [];

  try {
    for (const [index, testCase] of evaluationSet.cases.entries()) {
      console.log(`Running ${testCase.id}...`);
      const execution = await runCaseWithAuthRetry({
        baseUrl,
        cookie,
        sessionId,
        fileFixture,
        testCase,
        caseIndex: index,
        refreshCookie: canRefreshCookie ? refreshCookie : null,
      });
      cookie = execution.cookie;
      const result = execution.result;
      results.push(result);
      console.log(
        `  -> ${result.status} in ${result.durationMs}ms (${result.routeHint || "no-route"})`,
      );
    }
  } catch (error) {
    const artifact = {
      ...artifactBase,
      baseUrl,
      sessionId,
      summary: buildSummary(results),
      runError: error instanceof Error ? error.message : String(error),
      setupStage: "run_cases",
      results,
    };

    await writeArtifact(outputPath, artifact);
    console.log(`Saved partial failure artifact to ${path.relative(projectRoot, outputPath)}`);
    throw error;
  }

  const artifact = {
    ...artifactBase,
    baseUrl,
    sessionId,
    summary: buildSummary(results),
    results,
  };

  await writeArtifact(outputPath, artifact);

  console.log(`Saved artifact to ${path.relative(projectRoot, outputPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
