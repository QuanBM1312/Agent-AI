#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCookieHeader } from './lib/n8n-execution-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_BASE_URL = 'https://primary-production-79be44.up.railway.app';
const DEFAULT_COOKIE_FILE = '/tmp/n8n_live.cookie';
const DEFAULT_MAIN_WORKFLOW_ID = '7Lq2tknqGOVcdAvm';
const DEFAULT_SUB_WORKFLOW_ID = 'awr_01MNmP2mUsOIoEkjq';
const DEFAULT_OUTPUT = path.join(
  projectRoot,
  'docs',
  'artifacts',
  'live-n8n',
  'warm-context-draft-patch.json',
);

const baseUrl = (process.env.LIVE_N8N_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const cookieFile = process.env.LIVE_N8N_COOKIE_FILE || DEFAULT_COOKIE_FILE;
const mainWorkflowId = process.env.LIVE_N8N_MAIN_WORKFLOW_ID || DEFAULT_MAIN_WORKFLOW_ID;
const subWorkflowId = process.env.LIVE_N8N_SUB_WORKFLOW_ID || DEFAULT_SUB_WORKFLOW_ID;
const outputPath = process.env.LIVE_N8N_WARM_CONTEXT_OUTPUT || DEFAULT_OUTPUT;
const shouldApply =
  process.argv.includes('--apply') ||
  process.env.LIVE_N8N_APPLY === '1' ||
  process.env.LIVE_N8N_APPLY === 'true';

function printHelp() {
  console.log(`Usage:
  npm run patch:live:n8n:warm-context-drafts
  npm run patch:live:n8n:warm-context-drafts -- --apply

Optional env:
  LIVE_N8N_BASE_URL              override the live n8n base URL
  LIVE_N8N_COOKIE_FILE           Netscape-format cookie jar for authenticated /rest/workflows access
  LIVE_N8N_MAIN_WORKFLOW_ID      override the main workflow id
  LIVE_N8N_SUB_WORKFLOW_ID       override the Search_Agent0 workflow id
  LIVE_N8N_WARM_CONTEXT_OUTPUT   override the summary artifact path
  LIVE_N8N_APPLY=1               apply the PATCH calls instead of dry-run only

What it patches:
  Main workflow draft:
    - Build Supervisor Context
    - Build Agent0 Payload2
    - Call 'Tool - Search_Agent0'2

  Search_Agent0 draft:
    - When Executed by Another Workflow
    - Setup
    - Send msg to Agent0

Safety:
  - PATCH updates the draft only; it does not activate a new runtime version
  - no main or sub workflow activation is performed here
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

function buildHeaders(cookieHeader, extra = {}) {
  return {
    accept: 'application/json',
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
    ...extra,
  };
}

async function fetchWorkflow(workflowId, cookieHeader) {
  const response = await fetch(`${baseUrl}/rest/workflows/${workflowId}`, {
    headers: buildHeaders(cookieHeader),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch workflow ${workflowId}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return payload.data || payload;
}

async function patchWorkflow(workflowId, body, cookieHeader) {
  const response = await fetch(`${baseUrl}/rest/workflows/${workflowId}`, {
    method: 'PATCH',
    headers: buildHeaders(cookieHeader, {
      'content-type': 'application/json',
    }),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to patch workflow ${workflowId}: ${response.status} ${response.statusText} :: ${text}`);
  }

  const payload = await response.json();
  return payload.data || payload;
}

function findNode(workflow, name) {
  return (workflow.nodes || []).find((node) => node.name === name) || null;
}

function mustFindNode(workflow, name) {
  const node = findNode(workflow, name);
  if (!node) {
    throw new Error(`Workflow ${workflow.id} is missing required node: ${name}`);
  }
  return node;
}

function ensureWorkflowInputName(triggerNode, name) {
  const values = triggerNode.parameters?.workflowInputs?.values || [];
  if (!values.some((entry) => entry?.name === name)) {
    values.push({ name });
  }
  triggerNode.parameters.workflowInputs.values = values;
}

function ensureSetAssignment(node, name, value, type = 'string') {
  const assignments = node.parameters?.assignments?.assignments || [];
  const existing = assignments.find((entry) => entry?.name === name);

  if (existing) {
    existing.value = value;
    existing.type = type;
    return;
  }

  assignments.push({
    id: `${name}-warm-context`,
    name,
    type,
    value,
  });
  node.parameters.assignments.assignments = assignments;
}

function ensureWorkflowInputMapping(node, name, value, type = 'string') {
  const workflowInputs = node.parameters?.workflowInputs;
  if (!workflowInputs) {
    throw new Error(`Node ${node.name} is missing workflowInputs`);
  }

  workflowInputs.value = workflowInputs.value || {};
  workflowInputs.value[name] = value;

  const schema = workflowInputs.schema || [];
  const existing = schema.find((entry) => entry?.id === name);
  if (!existing) {
    schema.push({
      id: name,
      displayName: name,
      required: false,
      defaultMatch: false,
      display: true,
      canBeUsedToMatch: true,
      type,
      removed: false,
    });
  }
  workflowInputs.schema = schema;
}

function sanitizeNodeSummary(node) {
  if (!node) return null;
  return {
    name: node.name,
    type: node.type,
    version: node.typeVersion,
    retryOnFail: node.retryOnFail ?? false,
    maxTries: node.maxTries ?? null,
    waitBetweenTries: node.waitBetweenTries ?? null,
    parameters: node.parameters,
    credentials:
      node.credentials && typeof node.credentials === 'object'
        ? Object.fromEntries(
            Object.entries(node.credentials).map(([key, value]) => [
              key,
              value && typeof value === 'object'
                ? { name: value.name || null }
                : null,
            ]),
          )
        : null,
  };
}

function buildPatchBody(workflow) {
  return {
    name: workflow.name,
    description: workflow.description ?? null,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: workflow.settings ?? {},
    staticData: workflow.staticData ?? null,
    pinData: workflow.pinData ?? {},
    meta: workflow.meta ?? null,
    versionId: workflow.versionId,
  };
}

function mutateMainWorkflow(workflow) {
  const buildSupervisorContext = mustFindNode(workflow, 'Build Supervisor Context');
  const buildAgent0Payload = mustFindNode(workflow, 'Build Agent0 Payload2');
  const callSearchAgent0 = mustFindNode(workflow, "Call 'Tool - Search_Agent0'2");
  const normalizeAgent0Output = mustFindNode(workflow, 'Edit Fields10');

  ensureSetAssignment(
    buildSupervisorContext,
    'agent0_context_id',
    "={{ $('When chat message received').first().json.agent0_context_id || '' }}",
  );
  ensureSetAssignment(
    buildAgent0Payload,
    'agent0_context_id',
    "={{ $('Build Supervisor Context').first().json.agent0_context_id || '' }}",
  );
  ensureWorkflowInputMapping(
    callSearchAgent0,
    'agent0_context_id',
    "={{ $json.agent0_context_id || '' }}",
  );
  ensureSetAssignment(
    normalizeAgent0Output,
    'context_id',
    "={{ $json.context_id || '' }}",
  );

  return {
    buildSupervisorContext: sanitizeNodeSummary(buildSupervisorContext),
    buildAgent0Payload: sanitizeNodeSummary(buildAgent0Payload),
    callSearchAgent0: sanitizeNodeSummary(callSearchAgent0),
    normalizeAgent0Output: sanitizeNodeSummary(normalizeAgent0Output),
  };
}

function mutateSubWorkflow(workflow) {
  const triggerNode = mustFindNode(workflow, 'When Executed by Another Workflow');
  const setupNode = mustFindNode(workflow, 'Setup');
  const sendNode = mustFindNode(workflow, 'Send msg to Agent0');

  ensureWorkflowInputName(triggerNode, 'agent0_context_id');
  ensureSetAssignment(
    setupNode,
    'agent0_context_id',
    "={{ $json.agent0_context_id || '' }}",
  );
  sendNode.parameters.jsonBody =
    "={{ (() => { const payload = { message: $json.message }; const contextId = String($json.agent0_context_id || '').trim(); if (contextId) payload.context_id = contextId; return JSON.stringify(payload); })() }}";
  sendNode.retryOnFail = true;
  sendNode.maxTries = 2;
  sendNode.waitBetweenTries = 5000;

  return {
    triggerNode: sanitizeNodeSummary(triggerNode),
    setupNode: sanitizeNodeSummary(setupNode),
    sendNode: sanitizeNodeSummary(sendNode),
  };
}

function workflowVersionSummary(workflow) {
  return {
    id: workflow.id,
    name: workflow.name,
    active: Boolean(workflow.active),
    versionId: workflow.versionId || null,
    activeVersionId: workflow.activeVersionId || null,
    updatedAt: workflow.updatedAt || null,
  };
}

const cookieHeader = await loadCookieHeader(cookieFile);
if (!cookieHeader) {
  throw new Error(`No cookie header could be loaded from ${cookieFile}`);
}

const beforeMain = await fetchWorkflow(mainWorkflowId, cookieHeader);
const beforeSub = await fetchWorkflow(subWorkflowId, cookieHeader);

const nextMain = structuredClone(beforeMain);
const nextSub = structuredClone(beforeSub);

const mainNodeSummary = mutateMainWorkflow(nextMain);
const subNodeSummary = mutateSubWorkflow(nextSub);

let afterMain = beforeMain;
let afterSub = beforeSub;

if (shouldApply) {
  afterMain = await patchWorkflow(mainWorkflowId, buildPatchBody(nextMain), cookieHeader);
  afterSub = await patchWorkflow(subWorkflowId, buildPatchBody(nextSub), cookieHeader);
} else {
  afterMain = nextMain;
  afterSub = nextSub;
}

const artifact = {
  generatedAt: new Date().toISOString(),
  mode: shouldApply ? 'apply' : 'dry_run',
  baseUrl,
  cookieFile,
  workflows: {
    main: {
      before: workflowVersionSummary(beforeMain),
      after: workflowVersionSummary(afterMain),
      nodes: mainNodeSummary,
      draftOnly:
        workflowVersionSummary(afterMain).activeVersionId === workflowVersionSummary(beforeMain).activeVersionId,
    },
    sub: {
      before: workflowVersionSummary(beforeSub),
      after: workflowVersionSummary(afterSub),
      nodes: subNodeSummary,
      draftOnly:
        workflowVersionSummary(afterSub).activeVersionId === workflowVersionSummary(beforeSub).activeVersionId,
    },
  },
  conclusions: [
    shouldApply
      ? 'Patched both workflow drafts without activating a new runtime version.'
      : 'Prepared the warm-context draft mutations without sending PATCH calls.',
    "The main workflow draft now carries agent0_context_id into Call 'Tool - Search_Agent0'2.",
    'The main workflow draft now preserves context_id in the normalized Search_Agent0 response shape.',
    'The Search_Agent0 draft now accepts agent0_context_id and only forwards context_id when that dedicated field is present.',
  ],
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
