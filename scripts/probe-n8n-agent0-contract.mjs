#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_N8N_COOKIE_FILE,
  DEFAULT_MAIN_CALLER_NAME,
  DEFAULT_TRIGGER_NAME,
  buildCredentialDiagnostics,
  classifyProbeFailure,
  formatCredentialDiagnostics,
  inspectAgent0Contract,
  inspectExecutionFields,
  unwrapN8nPayload,
} from './lib/n8n-agent0-contract-probe.mjs';
import {
  fetchExecution,
  loadCookieHeader,
  parseExecutionPayload,
} from './lib/n8n-execution-utils.mjs';

const DEFAULT_OUTPUT = 'docs/artifacts/live-n8n/agent0-contract-probe.json';

function printHelp() {
  console.log(`
Usage:
  N8N_API_URL=https://n8n.example.com N8N_API_KEY=... npm run probe:n8n:agent0-contract

Optional env:
  N8N_API_URL                    n8n base URL for /api/v1 workflow management
  N8N_API_KEY                    API key sent as X-N8N-API-KEY
  LIVE_N8N_BASE_URL              fallback n8n base URL for /rest when using a cookie
  LIVE_N8N_COOKIE_FILE           fallback authenticated cookie jar for /rest
  LIVE_N8N_MAIN_WORKFLOW_ID      known main chat workflow id
  LIVE_N8N_SUB_WORKFLOW_ID       known Search_Agent0 workflow id
  LIVE_N8N_MAIN_EXECUTION_ID     optional execution id for main workflow field inspection
  LIVE_N8N_SUB_EXECUTION_ID      optional execution id for Search_Agent0 field inspection
  N8N_AGENT0_CONTRACT_OUTPUT     output artifact path

The artifact records node names, workflow ids, active version ids, field presence, and
expression shapes. It never writes full workflow JSON or credential values.
`.trim());
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/$/, '');
}

function buildApiHeaders(apiKey, extra = {}) {
  return {
    accept: 'application/json',
    'X-N8N-API-KEY': apiKey,
    ...extra,
  };
}

async function fetchApiJson(baseUrl, apiKey, apiPath) {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    headers: buildApiHeaders(apiKey),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `n8n API ${apiPath} failed: ${response.status} ${response.statusText} :: ${text.slice(0, 240)}`,
    );
    error.status = response.status;
    error.apiPath = apiPath;
    throw error;
  }

  return response.json();
}

async function fetchRestJson(baseUrl, cookieHeader, restPath) {
  const response = await fetch(`${baseUrl}${restPath}`, {
    headers: {
      accept: 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `n8n REST ${restPath} failed: ${response.status} ${response.statusText} :: ${text.slice(0, 240)}`,
    );
    error.status = response.status;
    error.apiPath = restPath;
    throw error;
  }

  const payload = await response.json();
  return unwrapN8nPayload(payload);
}

async function listApiWorkflows(baseUrl, apiKey) {
  const workflows = [];
  let cursor = '';

  do {
    const pathWithCursor = `/api/v1/workflows${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
    const payload = await fetchApiJson(baseUrl, apiKey, pathWithCursor);
    workflows.push(...(payload.data || []));
    cursor = payload.nextCursor || '';
  } while (cursor);

  return workflows;
}

async function listRestWorkflows(baseUrl, cookieHeader) {
  const payload = await fetchRestJson(baseUrl, cookieHeader, '/rest/workflows');
  return payload?.results || payload || [];
}

async function fetchWorkflow({ baseUrl, apiKey, cookieHeader, workflowId }) {
  if (apiKey) {
    return unwrapN8nPayload(await fetchApiJson(baseUrl, apiKey, `/api/v1/workflows/${workflowId}`));
  }

  return fetchRestJson(baseUrl, cookieHeader, `/rest/workflows/${workflowId}`);
}

function workflowHasNode(workflow, nodeName) {
  return (workflow.nodes || []).some((node) => node?.name === nodeName);
}

function discoverWorkflowIds(workflows) {
  const active = workflows.filter((workflow) => workflow?.active !== false);
  const mainCandidates = active.filter((workflow) =>
    workflowHasNode(workflow, DEFAULT_MAIN_CALLER_NAME) ||
    workflowHasNode(workflow, 'When chat message received'),
  );
  const subCandidates = active.filter((workflow) =>
    workflow?.name === 'Tool - Search_Agent0' ||
    workflowHasNode(workflow, DEFAULT_TRIGGER_NAME),
  );

  return {
    mainWorkflowId: mainCandidates[0]?.id || null,
    subWorkflowId: subCandidates[0]?.id || null,
    mainCandidates: mainCandidates.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      active: workflow.active,
      updatedAt: workflow.updatedAt || null,
    })),
    subCandidates: subCandidates.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      active: workflow.active,
      updatedAt: workflow.updatedAt || null,
    })),
  };
}

async function loadExecutionSummary({ baseUrl, cookieHeader, executionId, nodeName }) {
  if (!executionId) return null;
  const raw = await fetchExecution(baseUrl, executionId, cookieHeader);
  const { parsed, meta } = parseExecutionPayload(raw);
  return {
    executionId: String(meta.id || executionId),
    workflowId: meta.workflowId || null,
    status: meta.status || null,
    startedAt: meta.startedAt || null,
    stoppedAt: meta.stoppedAt || null,
    node: inspectExecutionFields(parsed, nodeName),
  };
}

const apiKey = process.env.N8N_API_KEY || '';
const apiBaseUrl = normalizeBaseUrl(process.env.N8N_API_URL || process.env.LIVE_N8N_BASE_URL);
const cookieFile = process.env.LIVE_N8N_COOKIE_FILE || DEFAULT_N8N_COOKIE_FILE;
const outputPath = process.env.N8N_AGENT0_CONTRACT_OUTPUT || DEFAULT_OUTPUT;
const mainExecutionId = process.env.LIVE_N8N_MAIN_EXECUTION_ID || '';
const subExecutionId = process.env.LIVE_N8N_SUB_EXECUTION_ID || '';

const cookieHeader = apiKey ? '' : await loadCookieHeader(cookieFile);
const credentialDiagnostics = buildCredentialDiagnostics({
  env: process.env,
  cookieFile,
  cookieHeader,
});

if (!credentialDiagnostics.ok) {
  console.error(formatCredentialDiagnostics(credentialDiagnostics));
  printHelp();
  process.exit(1);
}

try {
  const workflowList = apiKey
    ? await listApiWorkflows(apiBaseUrl, apiKey)
    : await listRestWorkflows(apiBaseUrl, cookieHeader);
  const discovered = discoverWorkflowIds(workflowList);
  const mainWorkflowId = process.env.LIVE_N8N_MAIN_WORKFLOW_ID || discovered.mainWorkflowId;
  const subWorkflowId = process.env.LIVE_N8N_SUB_WORKFLOW_ID || discovered.subWorkflowId;

  if (!mainWorkflowId || !subWorkflowId) {
    throw new Error(
      `Could not discover required workflows. main=${mainWorkflowId || 'missing'} sub=${subWorkflowId || 'missing'}`,
    );
  }

  const mainWorkflow = await fetchWorkflow({
    baseUrl: apiBaseUrl,
    apiKey,
    cookieHeader,
    workflowId: mainWorkflowId,
  });
  const subWorkflow = await fetchWorkflow({
    baseUrl: apiBaseUrl,
    apiKey,
    cookieHeader,
    workflowId: subWorkflowId,
  });
  const contract = inspectAgent0Contract({ mainWorkflow, subWorkflow });

  const artifact = {
    generatedAt: new Date().toISOString(),
    baseUrl: apiBaseUrl,
    authMode: apiKey ? 'api_key' : 'cookie',
    discovered,
    contract,
    executions: {
      main: await loadExecutionSummary({
        baseUrl: apiBaseUrl,
        cookieHeader,
        executionId: mainExecutionId,
        nodeName: DEFAULT_MAIN_CALLER_NAME,
      }),
      sub: await loadExecutionSummary({
        baseUrl: apiBaseUrl,
        cookieHeader,
        executionId: subExecutionId,
        nodeName: DEFAULT_TRIGGER_NAME,
      }),
    },
    conclusions: [
      contract.verdict.ok
        ? 'Workflow structure declares and forwards all required SPEC-04 fields into Search_Agent0.'
        : 'Workflow structure still misses at least one required SPEC-04 field.',
      contract.path.reachable
        ? `${JSON.stringify(DEFAULT_MAIN_CALLER_NAME)} is reachable from the chat trigger.`
        : `${JSON.stringify(DEFAULT_MAIN_CALLER_NAME)} was not proven reachable from the chat trigger.`,
      contract.verdict.missingCallerFields.length > 0
        ? `Caller missing/empty: ${contract.verdict.missingCallerFields.join(', ')}.`
        : null,
      contract.verdict.missingTriggerFields.length > 0
        ? `Trigger missing: ${contract.verdict.missingTriggerFields.join(', ')}.`
        : null,
      artifactExecutionNote(mainExecutionId, subExecutionId),
    ].filter(Boolean),
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    outputPath,
    authMode: artifact.authMode,
    mainWorkflow: contract.mainWorkflow,
    subWorkflow: contract.subWorkflow,
    verdict: contract.verdict,
    conclusions: artifact.conclusions,
  }, null, 2));

  process.exit(contract.verdict.ok ? 0 : 2);
} catch (error) {
  const classification = classifyProbeFailure(error);
  console.error(JSON.stringify({
    ok: false,
    classification,
    sanitizedError: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
}

function artifactExecutionNote(mainId, subId) {
  if (mainId || subId) {
    return 'Execution-level field inspection was requested; see artifact.executions for presence-only results.';
  }
  return 'No execution ids were provided, so this run validates workflow shape only.';
}
