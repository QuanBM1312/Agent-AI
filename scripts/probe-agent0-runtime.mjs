#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://agent0-railway-no-wrapped-production.up.railway.app';
const DEFAULT_OUTPUT = 'docs/artifacts/agent0-runtime-probe/latest.json';

function printHelp() {
  console.log(`
Usage:
  AGENT0_BASE_URL=https://service.example.com npm run probe:agent0

Optional env:
  AGENT0_BASE_URL   Base URL to probe
  AGENT0_OUTPUT     Output artifact path
`.trim());
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const baseUrl = (process.env.AGENT0_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const outputPath = process.env.AGENT0_OUTPUT || DEFAULT_OUTPUT;
const APP_ORIGIN = 'https://aioperation.dieuhoathanglong.com.vn';

const checks = [
  { name: 'root', path: '/', expect: [200] },
  { name: 'login', path: '/login', expect: [200] },
  { name: 'socket.io', path: '/socket.io/?EIO=4&transport=polling', expect: [200] },
  { name: 'health', path: '/health', expect: [200, 401, 403] },
  { name: 'api_health', path: '/api/health', expect: [200, 401, 403] },
  { name: 'csrf_token', path: '/csrf_token', expect: [200] },
  { name: 'api_csrf_token', path: '/api/csrf_token', expect: [200] },
  { name: 'message', path: '/message', expect: [200, 400, 401, 403, 405] },
  { name: 'api_message_route', path: '/api/message', expect: [200, 400, 401, 403, 405] },
  { name: 'api_message', path: '/api_message', expect: [200, 400, 401, 403, 405] },
  { name: 'api_api_message', path: '/api/api_message', expect: [200, 400, 401, 403, 405] },
  { name: 'message_async', path: '/message_async', expect: [200, 400, 405] },
  { name: 'api_message_async', path: '/api/message_async', expect: [200, 400, 401, 403, 405] },
  { name: 'poll', path: '/poll', expect: [200, 400, 405] },
  { name: 'api_poll', path: '/api/poll', expect: [200, 400, 401, 403, 405] },
];

const behaviorChecks = [
  {
    name: 'api_csrf_token_with_app_origin',
    method: 'GET',
    path: '/api/csrf_token',
    headers: { Origin: APP_ORIGIN },
    expect: [200],
  },
  {
    name: 'api_message_post_empty',
    method: 'POST',
    path: '/api/message',
    headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
    body: '{}',
    expect: [200, 400, 401, 403, 405],
  },
  {
    name: 'api_api_message_post_empty',
    method: 'POST',
    path: '/api/api_message',
    headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
    body: '{}',
    expect: [200, 400, 401, 403, 405],
  },
  {
    name: 'api_message_async_post_empty',
    method: 'POST',
    path: '/api/message_async',
    headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
    body: '{}',
    expect: [200, 400, 401, 403, 405],
  },
  {
    name: 'api_poll_post_empty',
    method: 'POST',
    path: '/api/poll',
    headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
    body: '{}',
    expect: [200, 400, 401, 403, 405],
  },
];

function summarizeBody(body) {
  return body.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function extractRuntimeSignals(body) {
  const gitMatch = body.match(/globalThis\.gitinfo = \{ version: "([^"]+)", commit_time: "([^"]+)" \};/);
  const runtimeIdMatch = body.match(/id: "([^"]+)"/);
  const loggedInMatch = body.match(/loggedIn: "(true|false)" === "true"/);

  const signals = {};
  if (gitMatch) {
    signals.gitVersion = gitMatch[1];
    signals.gitCommitTime = gitMatch[2];
  }
  if (runtimeIdMatch) {
    signals.runtimeId = runtimeIdMatch[1];
  }
  if (loggedInMatch) {
    signals.authConfigured = loggedInMatch[1] === 'true';
  }

  return Object.keys(signals).length > 0 ? signals : undefined;
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'manual',
    headers: {
      'user-agent': 'agent-ai-agent0-probe/1.0',
      Origin: 'https://aioperation.dieuhoathanglong.com.vn',
    },
  });

  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body: await response.text(),
  };
}

async function runBehaviorCheck(check) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${check.path}`, {
      method: check.method,
      redirect: 'manual',
      headers: {
        'user-agent': 'agent-ai-agent0-probe/1.0',
        ...(check.headers || {}),
      },
      body: check.body,
    });

    const body = await response.text();
    return {
      ...check,
      ok: check.expect.includes(response.status),
      status: response.status,
      durationMs: Date.now() - startedAt,
      contentType: response.headers.get('content-type'),
      summary: summarizeBody(body),
    };
  } catch (error) {
    return {
      ...check,
      ok: false,
      status: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      summary: '',
    };
  }
}

function extractFrontendSignals(assetBodies) {
  const indexJs = assetBodies['/index.js']?.body || '';
  const apiJs = assetBodies['/js/api.js']?.body || '';
  const websocketJs = assetBodies['/js/websocket.js']?.body || '';
  const syncStoreJs = assetBodies['/components/sync/sync-store.js']?.body || '';

  return {
    assets: Object.fromEntries(
      Object.entries(assetBodies).map(([assetPath, asset]) => [
        assetPath,
        {
          status: asset.status,
          contentType: asset.contentType,
        },
      ]),
    ),
    usesLegacyMessageAsyncPath: indexJs.includes('/message_async'),
    mentionsLegacyPollPath: indexJs.includes('/poll'),
    usesApiCsrfTokenPath: apiJs.includes('/api/csrf_token'),
    websocketUsesCsrfToken: websocketJs.includes('csrf_token'),
    websocketUsesSocketIo: websocketJs.includes('socket.io'),
    syncStoreUsesStateRequest: syncStoreJs.includes('state_request'),
    syncStoreUsesStatePush: syncStoreJs.includes('state_push'),
  };
}

async function runCheck(check) {
  const startedAt = Date.now();
  let response;
  let body = '';

  try {
    response = await fetch(`${baseUrl}${check.path}`, {
      redirect: 'manual',
      headers: {
        'user-agent': 'agent-ai-agent0-probe/1.0',
      },
    });
    body = await response.text();
  } catch (error) {
    return {
      ...check,
      ok: false,
      status: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      summary: '',
    };
  }

  const result = {
    ...check,
    ok: check.expect.includes(response.status),
    status: response.status,
    durationMs: Date.now() - startedAt,
    contentType: response.headers.get('content-type'),
    location: response.headers.get('location'),
    summary: summarizeBody(body),
  };

  if (check.name === 'root' || check.name === 'login') {
    const signals = extractRuntimeSignals(body);
    if (signals) {
      result.signals = signals;
    }
  }

  return result;
}

function classify(results) {
  const byName = Object.fromEntries(results.map((item) => [item.name, item]));
  const rootOk = byName.root?.ok;
  const loginOk = byName.login?.ok;
  const socketOk = byName['socket.io']?.ok;
  const healthOk = byName.health?.ok;
  const apiHealthOk = byName.api_health?.ok;
  const csrfOk = byName.csrf_token?.ok;
  const apiCsrfOk = byName.api_csrf_token?.ok;
  const messageOk = byName.message?.ok || byName.api_message?.ok;
  const apiMessageOk =
    byName.api_message_route?.ok || byName.api_api_message?.ok || byName.api_message?.ok;
  const messageAsyncOk = byName.message_async?.ok;
  const apiMessageAsyncOk = byName.api_message_async?.ok;
  const pollOk = byName.poll?.ok;
  const apiPollOk = byName.api_poll?.ok;

  if (
    rootOk &&
    loginOk &&
    socketOk &&
    !healthOk &&
    apiHealthOk &&
    !csrfOk &&
    apiCsrfOk &&
    !messageOk &&
    apiMessageOk &&
    !messageAsyncOk &&
    apiMessageAsyncOk &&
    !pollOk &&
    apiPollOk
  ) {
    return 'api_prefixed_runtime_contract_mismatch';
  }

  if (
    rootOk &&
    loginOk &&
    socketOk &&
    (healthOk || apiHealthOk) &&
    (csrfOk || apiCsrfOk) &&
    (messageOk || apiMessageOk) &&
    (messageAsyncOk || apiMessageAsyncOk) &&
    (pollOk || apiPollOk)
  ) {
    return 'healthy_runtime_surface';
  }

  if (
    rootOk &&
    loginOk &&
    socketOk &&
    (!healthOk || !csrfOk || !messageOk || !messageAsyncOk || !pollOk) &&
    (!apiHealthOk || !apiCsrfOk || !apiMessageOk || !apiMessageAsyncOk || !apiPollOk)
  ) {
    return 'partial_runtime_missing_http_endpoints';
  }

  if (rootOk && (!socketOk || !loginOk)) {
    return 'ui_shell_without_full_runtime';
  }

  return 'unhealthy_or_unreachable';
}

const results = [];
for (const check of checks) {
  results.push(await runCheck(check));
}

const behaviorResults = [];
for (const check of behaviorChecks) {
  behaviorResults.push(await runBehaviorCheck(check));
}

const frontendAssetPaths = ['/index.js', '/js/api.js', '/js/websocket.js', '/components/sync/sync-store.js'];
const frontendAssetBodies = {};

for (const assetPath of frontendAssetPaths) {
  try {
    frontendAssetBodies[assetPath] = await fetchText(`${baseUrl}${assetPath}`);
  } catch (error) {
    frontendAssetBodies[assetPath] = {
      status: null,
      contentType: null,
      body: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const artifact = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  classification: classify(results),
  results,
  behaviorResults,
  frontendContract: extractFrontendSignals(frontendAssetBodies),
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

console.log(`Saved probe artifact to ${outputPath}`);
console.log(JSON.stringify({
  classification: artifact.classification,
  statuses: Object.fromEntries(results.map((item) => [item.name, item.status])),
}, null, 2));

process.exit(results.every((item) => item.ok) ? 0 : 1);
