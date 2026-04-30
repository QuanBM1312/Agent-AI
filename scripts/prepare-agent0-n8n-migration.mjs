#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolveAgent0ApiKey } from './lib/agent0-api-key-env.mjs';

function printHelp() {
  console.log(`
Usage:
  AGENT0_API_KEY=... \
  npm run prepare:agent0:n8n-migration

  AGENT0_MCP_SERVER_TOKEN=... \
  npm run prepare:agent0:n8n-migration

Optional env:
  AGENT0_BASE_URL           override live agent0 base URL
  AGENT0_API_ROUTE          override API route candidate
  AGENT0_API_KEY_SOURCE     override rendered n8n header expression/value
  AGENT0_ENTRY_NODE         override rendered n8n source node name
  AGENT0_N8N_TEMPLATE       validate-only | cleanup | all
  AGENT0_N8N_OUTPUT         override rendered patch output path

Behavior:
  1. runs the full API-key probe pipeline
  2. if the probe succeeds, renders the n8n patch payload
  3. AGENT0_N8N_WORKFLOW_ID is optional if the renderer can auto-discover it from live n8n artifacts
  4. exits non-zero if the probe fails
`.trim());
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (!resolveAgent0ApiKey(process.env).value) {
  console.error('AGENT0_API_KEY or AGENT0_MCP_SERVER_TOKEN is required');
  process.exit(2);
}

function runStep(label, scriptPath) {
  return new Promise((resolve) => {
    console.log(`\n==> ${label}`);
    const child = spawn(process.execPath, [scriptPath], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
    child.on('error', (error) => resolve({ code: 1, signal: null, error }));
  });
}

const probe = await runStep(
  'Probe live agent0 API-key route and render report',
  'scripts/run-agent0-api-key-probe-pipeline.mjs',
);

if (probe.code !== 0) {
  process.exit(probe.code);
}

const render = await runStep(
  'Render n8n patch payload from template',
  'scripts/render-agent0-n8n-patch-template.mjs',
);

process.exit(render.code);
