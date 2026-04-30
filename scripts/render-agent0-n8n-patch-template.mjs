#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverSearchAgent0WorkflowId } from './lib/agent0-workflow-id-discovery.mjs';

const TEMPLATE_MAP = {
  'validate-only': {
    input: 'docs/artifacts/n8n/search-agent0-api-key-validate-only.json',
    output: 'docs/artifacts/n8n/search-agent0-api-key-validate-only.rendered.json',
  },
  cleanup: {
    input: 'docs/artifacts/n8n/search-agent0-api-key-cleanup.json',
    output: 'docs/artifacts/n8n/search-agent0-api-key-cleanup.rendered.json',
  },
};

function printHelp() {
  console.log(`
Usage:
  AGENT0_N8N_WORKFLOW_ID=<workflow-id> npm run render:agent0:n8n-patch

Optional env:
  AGENT0_N8N_TEMPLATE       validate-only | cleanup | all
  AGENT0_N8N_OUTPUT         output JSON path
  AGENT0_BASE_URL           override agent0 base URL in validate-only template
  AGENT0_API_ROUTE          override route in validate-only template
  AGENT0_API_KEY_SOURCE     override header expression/value in validate-only template
  AGENT0_N8N_CREDENTIAL_ID  optional httpHeaderAuth credential id for credential-backed validate-only render
  AGENT0_N8N_CREDENTIAL_NAME optional httpHeaderAuth credential name for credential-backed validate-only render
  AGENT0_N8N_RETRY_ON_FAIL  true | false. Default: true
  AGENT0_N8N_MAX_TRIES      Default: 2
  AGENT0_N8N_WAIT_BETWEEN_TRIES_MS Default: 5000
  AGENT0_ENTRY_NODE         override source node name for validate-only addConnection and cleanup removeConnection

Defaults:
  AGENT0_N8N_TEMPLATE=validate-only
  AGENT0_BASE_URL=https://agent0-railway-no-wrapped-production.up.railway.app
  AGENT0_API_ROUTE=/api/api_message
  AGENT0_API_KEY_SOURCE=={{ $env.AGENT0_MCP_SERVER_TOKEN || $env.AGENT0_API_KEY }}
  AGENT0_N8N_RETRY_ON_FAIL=true
  AGENT0_N8N_MAX_TRIES=2
  AGENT0_N8N_WAIT_BETWEEN_TRIES_MS=5000
  AGENT0_ENTRY_NODE=Switch
  AGENT0_N8N_WORKFLOW_ID=<auto-discovered from live n8n artifacts if possible>
`.trim());
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const workflowId = process.env.AGENT0_N8N_WORKFLOW_ID || (await discoverSearchAgent0WorkflowId());
if (!workflowId) {
  console.error('AGENT0_N8N_WORKFLOW_ID is required');
  process.exit(2);
}

const templateName = process.env.AGENT0_N8N_TEMPLATE || 'validate-only';
if (templateName !== 'all' && !TEMPLATE_MAP[templateName]) {
  console.error(`Unknown AGENT0_N8N_TEMPLATE: ${templateName}`);
  process.exit(2);
}

const baseUrl = (process.env.AGENT0_BASE_URL || 'https://agent0-railway-no-wrapped-production.up.railway.app').replace(/\/$/, '');
const apiRoute = process.env.AGENT0_API_ROUTE || '/api/api_message';
const apiKeySource =
  process.env.AGENT0_API_KEY_SOURCE || '={{ $env.AGENT0_MCP_SERVER_TOKEN || $env.AGENT0_API_KEY }}';
const entryNode = process.env.AGENT0_ENTRY_NODE || 'Switch';
const credentialId = process.env.AGENT0_N8N_CREDENTIAL_ID || '';
const credentialName = process.env.AGENT0_N8N_CREDENTIAL_NAME || '';
const retryOnFail = process.env.AGENT0_N8N_RETRY_ON_FAIL !== 'false';
const maxTries = Number.parseInt(process.env.AGENT0_N8N_MAX_TRIES || '2', 10);
const waitBetweenTries = Number.parseInt(
  process.env.AGENT0_N8N_WAIT_BETWEEN_TRIES_MS || '5000',
  10,
);

if ((credentialId && !credentialName) || (!credentialId && credentialName)) {
  console.error(
    'AGENT0_N8N_CREDENTIAL_ID and AGENT0_N8N_CREDENTIAL_NAME must be provided together',
  );
  process.exit(2);
}

function getRequestedTemplates() {
  if (templateName === 'all') {
    return ['validate-only', 'cleanup'];
  }
  return [templateName];
}

function resolveOutputPath(name) {
  if (process.env.AGENT0_N8N_OUTPUT) {
    return process.env.AGENT0_N8N_OUTPUT;
  }
  return TEMPLATE_MAP[name].output;
}

function setCredentialBackedHttpHeaderAuth(operation) {
  const node = operation.node;
  node.parameters.authentication = 'genericCredentialType';
  node.parameters.genericAuthType = 'httpHeaderAuth';
  node.parameters.sendHeaders = true;
  node.parameters.headerParameters = {
    parameters: [],
  };
  node.credentials = {
    httpHeaderAuth: {
      id: credentialId,
      name: credentialName,
    },
  };
}

function applyRetryPolicy(operation) {
  const node = operation.node;
  node.retryOnFail = retryOnFail;
  if (retryOnFail) {
    node.maxTries = maxTries;
    node.waitBetweenTries = waitBetweenTries;
    return;
  }
  delete node.maxTries;
  delete node.waitBetweenTries;
}

async function renderTemplate(name) {
  const outputPath = resolveOutputPath(name);
  const rawTemplate = await readFile(TEMPLATE_MAP[name].input, 'utf8');
  const doc = JSON.parse(rawTemplate);

  doc.arguments.id = workflowId;

  if (name === 'validate-only') {
    for (const operation of doc.arguments.operations || []) {
      if (operation.type === 'addNode' && operation.node?.name === 'Call Agent0 API-Key Route') {
        operation.node.parameters.url = `=${baseUrl}{{ $json.agent0_route }}`;
        applyRetryPolicy(operation);
        if (credentialId && credentialName) {
          setCredentialBackedHttpHeaderAuth(operation);
        } else {
          const header = operation.node.parameters?.headerParameters?.parameters?.find(
            (item) => item?.name === 'X-API-KEY',
          );
          if (header) {
            header.value = apiKeySource;
          }
        }
      }

      if (operation.type === 'addNode' && operation.node?.name === 'Build Agent0 API-Key Payload') {
        operation.node.parameters.jsCode = operation.node.parameters.jsCode.replaceAll(
          "agent0_route: '/api/api_message'",
          `agent0_route: ${JSON.stringify(apiRoute)}`,
        );
      }

      if (operation.type === 'addConnection' && operation.source === 'Switch') {
        operation.source = entryNode;
      }
    }
  }

  if (name === 'cleanup') {
    for (const operation of doc.arguments.operations || []) {
      if (operation.type === 'removeConnection' && operation.source === 'Switch') {
        operation.source = entryNode;
      }
    }
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return { templateName: name, outputPath };
}

const rendered = [];
for (const requestedTemplate of getRequestedTemplates()) {
  rendered.push(await renderTemplate(requestedTemplate));
}

for (const item of rendered) {
  console.log(`Rendered ${item.templateName} patch template to ${item.outputPath}`);
}

console.log(
  JSON.stringify(
    {
      workflowId,
      templateName,
      rendered,
      baseUrl: rendered.some((item) => item.templateName === 'validate-only') ? baseUrl : null,
      apiRoute: rendered.some((item) => item.templateName === 'validate-only') ? apiRoute : null,
      credentialBacked:
        rendered.some((item) => item.templateName === 'validate-only') &&
        Boolean(credentialId && credentialName),
      retryOnFail: rendered.some((item) => item.templateName === 'validate-only')
        ? retryOnFail
        : null,
      maxTries: rendered.some((item) => item.templateName === 'validate-only') && retryOnFail
        ? maxTries
        : null,
      waitBetweenTries: rendered.some((item) => item.templateName === 'validate-only') && retryOnFail
        ? waitBetweenTries
        : null,
      credentialId: credentialId || null,
      credentialName: credentialName || null,
      entryNode,
    },
    null,
    2,
  ),
);
