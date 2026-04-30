#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_OUTPUT_PATH = path.join(
  projectRoot,
  'docs',
  'artifacts',
  'chat-eval',
  'session-chain-latest.json',
);
const DEFAULT_MESSAGES = [
  'Kiểm tra tình trạng dữ liệu nội bộ hiện có và trả lời ngắn gọn.',
  'Từ cùng ngữ cảnh trước đó, nêu thêm 2 điểm chi tiết quan trọng.',
  'Tiếp tục từ cùng ngữ cảnh, tóm tắt rủi ro hoặc giới hạn xác minh nếu có.',
];

const args = new Set(process.argv.slice(2));

if (args.has('--help')) {
  console.log(`Usage:
  CHAT_EVAL_BASE_URL=https://example.com \\
  CHAT_EVAL_COOKIE='__session=...' \\
  npm run eval:chat:chain

Environment variables:
  CHAT_EVAL_BASE_URL      Base app URL. Default: http://localhost:3000
  CHAT_EVAL_COOKIE        Raw Cookie header for an authenticated user session.
  CHAT_EVAL_EMAIL         Optional Clerk sign-in email used when CHAT_EVAL_COOKIE is absent.
  CHAT_EVAL_PASSWORD      Optional Clerk sign-in password used when CHAT_EVAL_COOKIE is absent.
  CHAT_CHAIN_OUTPUT       Output artifact path. Default: docs/artifacts/chat-eval/session-chain-latest.json
  CHAT_CHAIN_MESSAGES     JSON array of prompts. Default: built-in 3-turn warm-context chain.
  CHAT_CHAIN_SESSION_ID   Reuse an existing chat session instead of creating a fresh one.
`);
  process.exit(0);
}

function normalizeBaseUrl(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} ${commandArgs.join(' ')} failed with code ${code}\n${stderr || stdout}`));
    });
  });
}

async function installPlaywright(tmpDir) {
  await fs.writeFile(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ private: true, name: 'chat-chain-auth' }, null, 2),
  );
  await run('npm', ['install', 'playwright', '--no-save'], { cwd: tmpDir });
}

async function acquireSessionCookie({ baseUrl, email, password }) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-chain-auth-'));

  try {
    await installPlaywright(tmpDir);

    const runnerPath = path.join(tmpDir, 'runner.mjs');
    await fs.writeFile(
      runnerPath,
      `
import { chromium } from 'playwright';

const baseUrl = ${JSON.stringify(baseUrl)};
const email = process.env.CHAT_EVAL_EMAIL;
const password = process.env.CHAT_EVAL_PASSWORD;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(\`\${baseUrl}/sign-in\`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('input[name="identifier"]').waitFor({ timeout: 30000 });
  await page.locator('input[name="identifier"]').fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('input[name="password"]').waitFor({ timeout: 30000 });
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const cookies = await context.cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === '__session');
  if (!sessionCookie) {
    throw new Error('Missing __session cookie after live sign-in');
  }

  console.log(cookies.map((cookie) => \`\${cookie.name}=\${cookie.value}\`).join('; '));
  await browser.close();
} catch (error) {
  await browser.close();
  throw error;
}
`,
    );

    const { stdout } = await run('node', [runnerPath], {
      cwd: tmpDir,
      env: {
        ...process.env,
        CHAT_EVAL_EMAIL: email,
        CHAT_EVAL_PASSWORD: password,
      },
    });

    const cookie = stdout.trim();
    if (!cookie.includes('__session=')) {
      throw new Error('Failed to acquire authenticated chain-eval cookie');
    }

    return cookie;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function buildHeaders(cookie) {
  return {
    cookie,
    accept: 'application/json',
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
    method: 'POST',
    headers: {
      ...buildHeaders(cookie),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      summary: `Warm context chain eval ${new Date().toISOString()}`,
    }),
  });

  const body = await parseJsonResponse(response);
  if (!response.ok || !body?.id) {
    throw new Error(`Failed to create chat session (${response.status}): ${JSON.stringify(body)}`);
  }

  return body.id;
}

function summarizeBody(body) {
  if (body == null) {
    return null;
  }

  if (typeof body === 'string') {
    return body.slice(0, 400);
  }

  if (typeof body === 'object') {
    if (typeof body.output === 'string') return body.output.slice(0, 400);
    if (typeof body.message === 'string') return body.message.slice(0, 400);
  }

  return JSON.stringify(body).slice(0, 400);
}

async function sendTurn({ baseUrl, cookie, sessionId, prompt, turnIndex, agent0ContextId }) {
  const formData = new FormData();
  formData.set('sessionId', sessionId);
  formData.set('type', 'chat');
  formData.set('chatInput', prompt);
  const clientMessageId = `chain-${turnIndex}-${Date.now()}`;
  formData.set('clientMessageId', clientMessageId);
  if (agent0ContextId) {
    formData.set('agent0_context_id', agent0ContextId);
  }

  const startedAtMs = Date.now();
  const response = await fetch(`${baseUrl}/api/chat/n8n`, {
    method: 'POST',
    headers: buildHeaders(cookie),
    body: formData,
  });
  const completedAtMs = Date.now();
  const body = await parseJsonResponse(response);
  const meta = body && typeof body === 'object' ? body._meta || null : null;

  return {
    turn: turnIndex + 1,
    prompt,
    clientMessageId,
    providedAgent0ContextId: agent0ContextId || null,
    status: response.status,
    ok: response.ok,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - startedAtMs,
    requestId:
      typeof meta?.requestId === 'string'
        ? meta.requestId
        : response.headers.get('x-chat-request-id'),
    routeHint:
      typeof meta?.routeHint === 'string'
        ? meta.routeHint
        : response.headers.get('x-chat-route-hint'),
    serverDurationMs:
      typeof meta?.durationMs === 'number'
        ? meta.durationMs
        : response.headers.get('x-chat-duration-ms'),
    responseAgent0ContextId:
      (typeof meta?.agent0ContextId === 'string' && meta.agent0ContextId) ||
      readAgent0ContextId(body) ||
      null,
    summary: summarizeBody(body),
  };
}

function readAgent0ContextId(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  for (const key of ['agent0ContextId', 'agent0_context_id', 'context_id', 'contextId']) {
    const field = value[key];
    if (typeof field === 'string' && field.trim()) {
      return field;
    }
  }

  const rawAgent0Response =
    value.raw_agent0_response && typeof value.raw_agent0_response === 'object'
      ? value.raw_agent0_response
      : null;

  if (!rawAgent0Response) {
    return null;
  }

  for (const key of ['context_id', 'contextId']) {
    const field = rawAgent0Response[key];
    if (typeof field === 'string' && field.trim()) {
      return field;
    }
  }

  return null;
}

async function fetchMessages({ baseUrl, cookie, sessionId }) {
  const response = await fetch(
    `${baseUrl}/api/chat/messages?session_id=${encodeURIComponent(sessionId)}`,
    {
      headers: buildHeaders(cookie),
    },
  );
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(`Failed to fetch chat messages (${response.status}): ${JSON.stringify(body)}`);
  }

  const rows = Array.isArray(body?.data) ? body.data : [];
  const assistantAgent0ContextIds = rows
    .filter((message) => message && message.role === 'assistant')
    .map((message) => readAgent0ContextId(message.retrieved_context))
    .filter((value) => typeof value === 'string' && value.trim());

  return {
    totalCount: typeof body?.pagination?.total === 'number' ? body.pagination.total : rows.length,
    assistantCount: rows.filter((message) => message && message.role === 'assistant').length,
    assistantAgent0ContextIds,
    latestAssistantAgent0ContextId: assistantAgent0ContextIds.at(-1) || null,
    messages: rows.map((message) => ({
      id: message.id,
      role: message.role,
      requestMeta: message.requestMeta || null,
      agent0ContextId: readAgent0ContextId(message.retrieved_context),
    })),
  };
}

async function fetchAuthProbe({ baseUrl, cookie }) {
  const response = await fetch(`${baseUrl}/api/test-auth`, {
    headers: buildHeaders(cookie),
  });
  const body = await parseJsonResponse(response);

  return {
    status: response.status,
    ok: response.ok,
    body,
  };
}

const baseUrl = normalizeBaseUrl(process.env.CHAT_EVAL_BASE_URL || DEFAULT_BASE_URL);
const outputPath = process.env.CHAT_CHAIN_OUTPUT || DEFAULT_OUTPUT_PATH;
const providedCookie = process.env.CHAT_EVAL_COOKIE || '';
const email = process.env.CHAT_EVAL_EMAIL || '';
const password = process.env.CHAT_EVAL_PASSWORD || '';
const providedSessionId = process.env.CHAT_CHAIN_SESSION_ID || '';

let messages = DEFAULT_MESSAGES;
if (process.env.CHAT_CHAIN_MESSAGES) {
  try {
    const parsed = JSON.parse(process.env.CHAT_CHAIN_MESSAGES);
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
      throw new Error('CHAT_CHAIN_MESSAGES must be a JSON array of strings');
    }
    messages = parsed;
  } catch (error) {
    throw new Error(
      `Failed to parse CHAT_CHAIN_MESSAGES: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

let cookie = providedCookie;
if (!cookie) {
  if (!email || !password) {
    throw new Error('Provide CHAT_EVAL_COOKIE or both CHAT_EVAL_EMAIL and CHAT_EVAL_PASSWORD');
  }
  cookie = await acquireSessionCookie({ baseUrl, email, password });
}

const sessionId = providedSessionId || (await createSession({ baseUrl, cookie }));
const results = [];
let latestAgent0ContextId = null;

for (const [index, prompt] of messages.entries()) {
  const result = await sendTurn({
    baseUrl,
    cookie,
    sessionId,
    prompt,
    turnIndex: index,
    agent0ContextId: latestAgent0ContextId,
  });
  results.push(result);
  if (result.responseAgent0ContextId) {
    latestAgent0ContextId = result.responseAgent0ContextId;
  }
}

const fetchedMessages = await fetchMessages({ baseUrl, cookie, sessionId });
const authProbe = await fetchAuthProbe({ baseUrl, cookie });

const successfulDurations = results.filter((result) => result.ok).map((result) => result.durationMs);
const artifact = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  sessionId,
  reusedSessionId: Boolean(providedSessionId),
  turnCount: results.length,
  messages,
  results,
  fetchedMessages,
  authProbe,
  summary: {
    successCount: results.filter((result) => result.ok).length,
    failureCount: results.filter((result) => !result.ok).length,
    routeHints: [...new Set(results.map((result) => result.routeHint).filter(Boolean))],
    firstTurnDurationMs: results[0]?.durationMs ?? null,
    fastestFollowupDurationMs:
      successfulDurations.length > 1 ? Math.min(...successfulDurations.slice(1)) : null,
    latestResponseAgent0ContextId: latestAgent0ContextId,
    latestAssistantAgent0ContextId: fetchedMessages.latestAssistantAgent0ContextId,
    latestAssistantHasAgent0ContextId: Boolean(fetchedMessages.latestAssistantAgent0ContextId),
  },
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
