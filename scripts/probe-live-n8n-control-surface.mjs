#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://primary-production-79be44.up.railway.app';
const DEFAULT_OUTPUT = 'docs/artifacts/live-n8n-control-surface/latest.json';

const baseUrl = (process.env.LIVE_N8N_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const outputPath = process.env.LIVE_N8N_OUTPUT || DEFAULT_OUTPUT;
const loginId = process.env.LIVE_N8N_EMAIL || process.env.N8N_EMAIL || '';
const password = process.env.LIVE_N8N_PASSWORD || process.env.N8N_PASSWORD || '';

function printHelp() {
  console.log(`Usage:
  npm run probe:live:n8n-control

Optional env:
  LIVE_N8N_BASE_URL   override the live n8n base URL
  LIVE_N8N_OUTPUT     override the artifact output path
  LIVE_N8N_EMAIL      optional email/login id for a session-based login attempt
  LIVE_N8N_PASSWORD   optional password for a session-based login attempt
  N8N_EMAIL           alias for LIVE_N8N_EMAIL
  N8N_PASSWORD        alias for LIVE_N8N_PASSWORD

What it does:
  1. probes public n8n surfaces: /, /healthz, /rest/settings, /api/v1/workflows
  2. if login env is provided, tries one session-based POST /rest/login
  3. if login succeeds, probes /rest/workflows with that session
  4. writes a JSON artifact summarizing the live control surface
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

function summarizeBody(body) {
  const compact = String(body || '').replace(/\s+/g, ' ').trim();
  return compact.slice(0, 280);
}

async function probe(sessionFetch, probePath, options = {}) {
  try {
    const response = await sessionFetch(`${baseUrl}${probePath}`, {
      redirect: 'manual',
      ...options,
      headers: {
        accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
        ...(options.headers || {}),
      },
    });

    const text = await response.text();

    return {
      path: probePath,
      method: options.method || 'GET',
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type') || null,
      location: response.headers.get('location') || null,
      summary: summarizeBody(text),
      body: text,
    };
  } catch (error) {
    return {
      path: probePath,
      method: options.method || 'GET',
      status: null,
      ok: false,
      contentType: null,
      location: null,
      summary: error instanceof Error ? error.message : String(error),
      body: '',
    };
  }
}

function classify({ root, healthz, settings, workflows, loginAttempt, sessionWorkflows }) {
  if (healthz?.status === 200 && workflows?.status === 401 && /X-N8N-API-KEY/i.test(workflows?.body || '')) {
    if (loginAttempt && loginAttempt.status === 200 && sessionWorkflows?.status === 200) {
      return 'session_login_sufficient_for_mutation';
    }

    if (loginAttempt && loginAttempt.status && loginAttempt.status >= 400) {
      return 'api_key_required_or_dedicated_n8n_user_needed';
    }

    return 'api_key_required_for_mutation';
  }

  if (root?.status === 200 && healthz?.status === 200 && settings?.status === 200) {
    return 'public_ui_up_auth_shape_needs_followup';
  }

  return 'inconclusive';
}

const cookieJar = new Map();

function captureSetCookies(response) {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  const rawSetCookies = typeof getSetCookie === 'function' ? getSetCookie() : [];

  for (const entry of rawSetCookies) {
    const pair = String(entry).split(';')[0];
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const key = pair.slice(0, index);
    const value = pair.slice(index + 1);
    cookieJar.set(key, value);
  }
}

function buildCookieHeader() {
  if (cookieJar.size === 0) return '';
  return Array.from(cookieJar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

async function sessionFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const cookie = buildCookieHeader();
  if (cookie) headers.set('cookie', cookie);

  const response = await fetch(url, {
    ...options,
    headers,
  });

  captureSetCookies(response);
  return response;
}

const root = await probe(sessionFetch, '/');
const healthz = await probe(sessionFetch, '/healthz');
const settings = await probe(sessionFetch, '/rest/settings');
const workflows = await probe(sessionFetch, '/api/v1/workflows');

let loginAttempt = null;
let sessionWorkflows = null;

if (loginId && password) {
  loginAttempt = await probe(sessionFetch, '/rest/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      emailOrLdapLoginId: loginId,
      password,
    }),
  });

  if (loginAttempt.status === 200) {
    sessionWorkflows = await probe(sessionFetch, '/rest/workflows');
  }
}

const artifact = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  classification: classify({ root, healthz, settings, workflows, loginAttempt, sessionWorkflows }),
  publicSurface: {
    root: {
      status: root.status,
      contentType: root.contentType,
      summary: root.summary,
    },
    healthz: {
      status: healthz.status,
      summary: healthz.summary,
    },
    settings: {
      status: settings.status,
      summary: settings.summary,
    },
    apiWorkflows: {
      status: workflows.status,
      summary: workflows.summary,
    },
  },
  loginAttempt: loginAttempt
    ? {
        attempted: true,
        loginId,
        status: loginAttempt.status,
        summary: loginAttempt.summary,
      }
    : {
        attempted: false,
        loginId: null,
        status: null,
        summary: 'No LIVE_N8N_EMAIL/N8N_EMAIL + LIVE_N8N_PASSWORD/N8N_PASSWORD provided.',
      },
  sessionWorkflows: sessionWorkflows
    ? {
        status: sessionWorkflows.status,
        summary: sessionWorkflows.summary,
      }
    : null,
  conclusions: [
    healthz.status === 200
      ? 'The live n8n instance is reachable and healthy at /healthz.'
      : 'The live n8n instance did not prove healthy at /healthz.',
    settings.status === 200
      ? 'The instance exposes /rest/settings publicly, including the user-management auth shape.'
      : 'The instance does not expose /rest/settings publicly.',
    workflows.status === 401 && /X-N8N-API-KEY/i.test(workflows.body || '')
      ? 'Management via /api/v1/workflows currently requires X-N8N-API-KEY.'
      : 'The management API did not clearly advertise an API-key requirement.',
    loginAttempt?.status === 401
      ? 'The tested session login credentials are not valid for the live n8n instance.'
      : null,
    loginAttempt?.status === 200 && sessionWorkflows?.status === 200
      ? 'A session-based login is sufficient for workflow access on this instance.'
      : null,
  ].filter(Boolean),
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

console.log(JSON.stringify(artifact, null, 2));
