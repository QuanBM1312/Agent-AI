#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCookieHeader } from './lib/n8n-execution-utils.mjs';
import { fetchWorkflow, summarizeWorkflow } from './lib/live-n8n-workflow-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const AGENT0_WARM_CONTEXT_FINGERPRINT = '2026-04-22-agent0-warm-context-v1';

const DEFAULT_APP_BASE_URL = 'https://aioperation.dieuhoathanglong.com.vn';
const DEFAULT_N8N_BASE_URL = 'https://primary-production-79be44.up.railway.app';
const DEFAULT_COOKIE_FILE = '/tmp/n8n_live.cookie';
const DEFAULT_MAIN_WORKFLOW_ID = '7Lq2tknqGOVcdAvm';
const DEFAULT_SUB_WORKFLOW_ID = 'awr_01MNmP2mUsOIoEkjq';
const DEFAULT_MAIN_ACTIVE_VERSION = '60749226-ce44-4e3a-8627-45f59f300b25';
const DEFAULT_SUB_ACTIVE_VERSION = 'bb9017fe-e664-4397-8791-d2c108f4d56e';
const DEFAULT_OUTPUT = path.join(
  projectRoot,
  'docs',
  'artifacts',
  'live-n8n',
  'warm-context-readiness.json',
);
const DEFAULT_APP_PROOF_INPUT = path.join(
  projectRoot,
  'docs',
  'artifacts',
  'chat-eval',
  'live-warm-context-app-proof.json',
);

const appBaseUrl = (process.env.LIVE_APP_BASE_URL || DEFAULT_APP_BASE_URL).replace(/\/$/, '');
const n8nBaseUrl = (process.env.LIVE_N8N_BASE_URL || DEFAULT_N8N_BASE_URL).replace(/\/$/, '');
const cookieFile = process.env.LIVE_N8N_COOKIE_FILE || DEFAULT_COOKIE_FILE;
const mainWorkflowId = process.env.LIVE_N8N_MAIN_WORKFLOW_ID || DEFAULT_MAIN_WORKFLOW_ID;
const subWorkflowId = process.env.LIVE_N8N_SUB_WORKFLOW_ID || DEFAULT_SUB_WORKFLOW_ID;
const expectedMainActiveVersion =
  process.env.LIVE_N8N_EXPECTED_MAIN_ACTIVE_VERSION || DEFAULT_MAIN_ACTIVE_VERSION;
const expectedSubActiveVersion =
  process.env.LIVE_N8N_EXPECTED_SUB_ACTIVE_VERSION || DEFAULT_SUB_ACTIVE_VERSION;
const outputPath = process.env.LIVE_WARM_CONTEXT_READINESS_OUTPUT || DEFAULT_OUTPUT;
const appProofInput = process.env.LIVE_WARM_CONTEXT_APP_PROOF_INPUT || DEFAULT_APP_PROOF_INPUT;

function printHelp() {
  console.log(`Usage:
  npm run verify:live:warm-context

Optional env:
  LIVE_APP_BASE_URL                        override the public app base URL
  LIVE_N8N_BASE_URL                        override the n8n base URL
  LIVE_N8N_COOKIE_FILE                     Netscape-format cookie jar for authenticated /rest/workflows access
  LIVE_N8N_MAIN_WORKFLOW_ID                override the main workflow id
  LIVE_N8N_SUB_WORKFLOW_ID                 override the Search_Agent0 workflow id
  LIVE_N8N_EXPECTED_MAIN_ACTIVE_VERSION    expected active main workflow version
  LIVE_N8N_EXPECTED_SUB_ACTIVE_VERSION     expected active Search_Agent0 version
  LIVE_WARM_CONTEXT_APP_PROOF_INPUT        app-level proof artifact path
  LIVE_WARM_CONTEXT_READINESS_OUTPUT       override the JSON artifact path
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

async function fetchVersionInfo() {
  const response = await fetch(`${appBaseUrl}/api/version`, {
    headers: {
      accept: 'application/json',
    },
  });

  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return {
    status: response.status,
    ok: response.ok,
    body,
  };
}

async function writeArtifact(summary) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function readAppProof() {
  try {
    const parsed = JSON.parse(await readFile(appProofInput, 'utf8'));
    return {
      present: true,
      generatedAt: parsed.generatedAt || null,
      path: path.relative(projectRoot, appProofInput),
      summary: parsed.summary || null,
      diagnostics: parsed.diagnostics || null,
      cleanup: parsed.cleanup || null,
      success:
        parsed.summary?.failureCount === 0 &&
        (parsed.proof?.latestAssistantHasAgent0ContextId === true ||
          parsed.proof?.n8n?.warmContextObserved === true),
      warmFaster: parsed.proof?.warmFaster === true,
      warmDeltaMs: parsed.proof?.warmDeltaMs ?? null,
      latestAssistantHasAgent0ContextId: parsed.proof?.latestAssistantHasAgent0ContextId === true,
      n8nWarmContextObserved: parsed.proof?.n8n?.warmContextObserved === true,
      authProbeDbUserPresent: parsed.authProbe?.body?.dbUserPresent === true,
      authProbeDbLookupError: parsed.authProbe?.body?.dbLookupError || null,
      databaseBootstrapOk: parsed.diagnostics?.databaseBootstrap?.ok === true,
      databaseBootstrapError: parsed.diagnostics?.databaseBootstrap?.error || null,
    };
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {
        present: false,
        path: path.relative(projectRoot, appProofInput),
        error: 'missing_proof_artifact',
      };
    }
    throw error;
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  appBaseUrl,
  n8nBaseUrl,
  expected: {
    agent0WarmContextFingerprint: AGENT0_WARM_CONTEXT_FINGERPRINT,
    mainActiveVersionId: expectedMainActiveVersion,
    subActiveVersionId: expectedSubActiveVersion,
  },
  app: null,
  n8n: null,
  appProof: null,
  readiness: null,
  conclusions: [],
};

try {
  const versionInfo = await fetchVersionInfo();
  summary.app = {
    status: versionInfo.status,
    ok: versionInfo.ok,
    deploymentPlatform: versionInfo.body?.deploymentPlatform || null,
    deploymentEnvironment: versionInfo.body?.deploymentEnvironment || null,
    authHydrationFingerprint: versionInfo.body?.authHydrationFingerprint || null,
    agent0WarmContextFingerprint: versionInfo.body?.agent0WarmContextFingerprint || null,
    agent0WarmContextForwarding: versionInfo.body?.agent0WarmContextForwarding ?? null,
  };

  const cookieHeader = await loadCookieHeader(cookieFile);
  if (!cookieHeader) {
    throw new Error(`Could not load an authenticated cookie header from ${cookieFile}.`);
  }

  const mainWorkflow = await fetchWorkflow(n8nBaseUrl, mainWorkflowId, cookieHeader);
  const subWorkflow = await fetchWorkflow(n8nBaseUrl, subWorkflowId, cookieHeader);
  summary.n8n = {
    main: summarizeWorkflow(mainWorkflow),
    sub: summarizeWorkflow(subWorkflow),
  };
  summary.appProof = await readAppProof();

  const appBuildReady =
    summary.app.ok &&
    summary.app.agent0WarmContextFingerprint === AGENT0_WARM_CONTEXT_FINGERPRINT &&
    summary.app.agent0WarmContextForwarding === true;
  const n8nReady =
    summary.n8n.main.activeVersionId === expectedMainActiveVersion &&
    summary.n8n.sub.activeVersionId === expectedSubActiveVersion;
  const appProofReady = summary.appProof?.success === true;

  summary.readiness = {
    appBuildReady,
    appProofReady,
    n8nReady,
    configReady: appBuildReady && n8nReady,
    fullyReady: appBuildReady && n8nReady && appProofReady,
  };

  summary.conclusions.push(
    appBuildReady
      ? 'Live app /api/version reports the warm-context forwarding fingerprint.'
      : 'Live app /api/version does not yet report the warm-context forwarding fingerprint.',
  );
  summary.conclusions.push(
    n8nReady
      ? 'Live n8n workflows are on the expected warm-context active versions.'
      : 'Live n8n workflows are not on the expected warm-context active versions.',
  );
  summary.conclusions.push(
    appProofReady
      ? 'Latest app-level warm-context proof artifact shows end-to-end forwarding or persisted context reuse.'
      : 'Latest app-level warm-context proof artifact does not yet show end-to-end forwarding or persisted context reuse.',
  );
  if (summary.appProof?.present && summary.appProof?.authProbeDbUserPresent === false) {
    summary.conclusions.push('Latest disposable app proof shows authenticated Clerk user state without a matching DB user row.');
  }

  await writeArtifact(summary);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  summary.error = error instanceof Error ? error.message : String(error);
  summary.conclusions.push('Warm-context readiness verification did not complete successfully.');
  await writeArtifact(summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}
