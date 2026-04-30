#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveAgent0ApiKey } from './lib/agent0-api-key-env.mjs';

const DEFAULT_BASE_URL = 'https://agent0-railway-no-wrapped-production.up.railway.app';
const DEFAULT_OUTPUT = 'docs/artifacts/agent0-api-key-probe/latest.json';
const DEFAULT_BASIC_MESSAGE = 'Health check from Agent-AI probe';
const DEFAULT_RETRIEVAL_QUESTION =
  'Tóm tắt quy trình bảo trì định kỳ đang có trong tài liệu nội bộ.';
const DEFAULT_INTERNAL_DATA_QUESTION =
  'Dự án gần nhất của khách hàng A đang có bao nhiêu hạng mục và ai phụ trách?';

function buildRuntimeLikeRetrievalMessage(question) {
  return `Bạn là agent trợ lý có thể dùng công cụ và retrieval của Agent0 để trả lời người dùng.
- Trả lời bằng ngôn ngữ của người dùng.
- Nếu files_context có dữ liệu, ưu tiên dữ liệu đó.
- Nếu history_chat có dữ liệu, dùng làm ngữ cảnh.
- Không bịa dữ liệu nội bộ khi chưa được xác minh.

User question:
${question}

Chat history:


Files context:


User input:
`;
}

function printHelp() {
  console.log(`
Usage:
  AGENT0_API_KEY=... npm run probe:agent0:api-key
  AGENT0_MCP_SERVER_TOKEN=... npm run probe:agent0:api-key

Optional env:
  AGENT0_BASE_URL        Base URL to probe
  AGENT0_API_KEY         Preferred explicit alias for the external API key
  AGENT0_MCP_SERVER_TOKEN Alias for the live agent0 mcp_server_token
  AGENT0_API_ROUTE       Override route, e.g. /api/api_message
  AGENT0_API_KEY_TRANSPORT header | body | both
  AGENT0_API_PROBE_MODE  basic | retrieval | internal_data | all
  AGENT0_API_MESSAGE     Basic probe message payload
  AGENT0_API_RETRIEVAL_MESSAGE Retrieval-style probe payload
  AGENT0_API_INTERNAL_DATA_MESSAGE Internal-data probe payload
  AGENT0_API_CONTEXT_ID  Optional context_id
  AGENT0_API_TIMEOUT_MS  Per-attempt timeout in ms. Default: 45000
  AGENT0_API_OUTPUT      Output artifact path
`.trim());
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const baseUrl = (process.env.AGENT0_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const { value: apiKey, envName: apiKeyEnvName } = resolveAgent0ApiKey(process.env);
const outputPath = process.env.AGENT0_API_OUTPUT || DEFAULT_OUTPUT;
const explicitRoute = process.env.AGENT0_API_ROUTE || '';
const requestedTransport = process.env.AGENT0_API_KEY_TRANSPORT || 'both';
const requestedProbeMode = process.env.AGENT0_API_PROBE_MODE || 'all';
const basicMessage = process.env.AGENT0_API_MESSAGE || DEFAULT_BASIC_MESSAGE;
const retrievalMessage =
  process.env.AGENT0_API_RETRIEVAL_MESSAGE ||
  buildRuntimeLikeRetrievalMessage(DEFAULT_RETRIEVAL_QUESTION);
const internalDataMessage =
  process.env.AGENT0_API_INTERNAL_DATA_MESSAGE || DEFAULT_INTERNAL_DATA_QUESTION;
const contextId = process.env.AGENT0_API_CONTEXT_ID || '';
const timeoutMs = Number(process.env.AGENT0_API_TIMEOUT_MS || 45000);

if (!apiKey) {
  console.error('AGENT0_API_KEY or AGENT0_MCP_SERVER_TOKEN is required');
  process.exit(2);
}

const routeCandidates = explicitRoute
  ? [explicitRoute]
  : ['/api/api_message', '/api_message'];
const authTransports =
  requestedTransport === 'both'
    ? ['header', 'body']
    : ['header', 'body'].includes(requestedTransport)
      ? [requestedTransport]
      : null;

if (!authTransports) {
  console.error('AGENT0_API_KEY_TRANSPORT must be header, body, or both');
  process.exit(2);
}

const PROBE_PROFILE_NAMES = ['basic', 'retrieval', 'internal_data'];
const probeProfiles =
  requestedProbeMode === 'all' || requestedProbeMode === 'both'
    ? PROBE_PROFILE_NAMES
    : PROBE_PROFILE_NAMES.includes(requestedProbeMode)
      ? [requestedProbeMode]
      : null;

if (!probeProfiles) {
  console.error('AGENT0_API_PROBE_MODE must be basic, retrieval, internal_data, or all');
  process.exit(2);
}

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error('AGENT0_API_TIMEOUT_MS must be a positive integer');
  process.exit(2);
}

function summarizeBody(body) {
  return body.replace(/\s+/g, ' ').trim().slice(0, 320);
}

function getProfileMessage(profileName) {
  if (profileName === 'retrieval') {
    return retrievalMessage;
  }
  if (profileName === 'internal_data') {
    return internalDataMessage;
  }
  return basicMessage;
}

async function callRoute(routePath, authTransport, profileName) {
  const startedAt = Date.now();
  const payload = {
    message: getProfileMessage(profileName),
  };

  if (contextId) {
    payload.context_id = contextId;
  }

  const headers = {
    'user-agent': 'agent-ai-agent0-api-key-probe/1.0',
    'content-type': 'application/json',
  };

  if (authTransport === 'header') {
    headers['x-api-key'] = apiKey;
  } else if (authTransport === 'body') {
    payload.api_key = apiKey;
  }

  const response = await fetch(`${baseUrl}${routePath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const bodyText = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = null;
  }

  return {
    routePath,
    authTransport,
    probeProfile: profileName,
    status: response.status,
    ok: response.ok,
    durationMs: Date.now() - startedAt,
    contentType: response.headers.get('content-type'),
    summary: summarizeBody(bodyText),
    parsed,
  };
}

const attempts = [];
const profileResults = {};

for (const profileName of probeProfiles) {
  let profileSuccess = null;

  for (const routePath of routeCandidates) {
    const routeAttempts = [];
    for (const authTransport of authTransports) {
      try {
        const result = await callRoute(routePath, authTransport, profileName);
        attempts.push(result);
        routeAttempts.push(result);
        if (result.ok) {
          profileSuccess = result;
          break;
        }
      } catch (error) {
        const result = {
          routePath,
          authTransport,
          probeProfile: profileName,
          status: null,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          summary: '',
          parsed: null,
        };
        attempts.push(result);
        routeAttempts.push(result);
        if (explicitRoute) {
          break;
        }
      }
    }

    if (profileSuccess) {
      break;
    }

    if (explicitRoute) {
      break;
    }

    if (routeAttempts.some((item) => item.status !== 404)) {
      break;
    }
  }

  profileResults[profileName] = {
    success: profileSuccess,
    ok: Boolean(profileSuccess),
  };
}

const allProfilesSuccessful = probeProfiles.every(
  (profileName) => profileResults[profileName]?.ok,
);
const success = probeProfiles.length === 1
  ? profileResults[probeProfiles[0]]?.success || null
  : profileResults.basic?.success || profileResults.retrieval?.success || null;

const artifact = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  explicitRoute: explicitRoute || null,
  apiKeyEnvName,
  attempts,
  success,
  allProfilesSuccessful,
  probeProfiles,
  profileResults,
  routeCandidates,
  authTransports,
  timeoutMs,
  inputShape: {
    basicMessage,
    retrievalMessage,
    internalDataMessage,
    hasContextId: Boolean(contextId),
  },
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

console.log(`Saved probe artifact to ${outputPath}`);
console.log(
  JSON.stringify(
    {
      success: Boolean(success),
      allProfilesSuccessful,
      attemptedRoutes: attempts.map((item) => ({
        probeProfile: item.probeProfile,
        routePath: item.routePath,
        authTransport: item.authTransport,
        status: item.status,
        ok: item.ok,
      })),
    },
    null,
    2,
  ),
);

process.exit(allProfilesSuccessful ? 0 : 1);
