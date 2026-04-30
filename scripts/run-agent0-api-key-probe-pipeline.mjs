#!/usr/bin/env node

import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { spawn } from 'node:child_process';

const DEFAULT_ARTIFACT = 'docs/artifacts/agent0-api-key-probe/latest.json';
const DEFAULT_REPORT = 'docs/artifacts/agent0-api-key-probe/latest.md';

function printHelp() {
  console.log(`
Usage:
  AGENT0_API_KEY=... npm run probe:agent0:api-key:full
  AGENT0_MCP_SERVER_TOKEN=... npm run probe:agent0:api-key:full

Optional env:
  AGENT0_API_KEY_TRANSPORT          header | body | both
  AGENT0_API_OUTPUT                 JSON artifact path
  AGENT0_API_KEY_PROBE_INPUT        Report input path
  AGENT0_API_KEY_PROBE_OUTPUT       Report output path

Behavior:
  1. runs the API-key probe
  2. the probe tries header + body auth by default unless pinned
  3. the probe runs all prompt profiles by default: basic, retrieval, internal_data
  4. if an artifact exists, renders the Markdown report
  5. exits non-zero if the probe itself failed
`.trim());
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

function runNodeScript(scriptPath, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
    });

    child.on('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
    child.on('error', (error) => resolve({ code: 1, signal: null, error }));
  });
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const artifactPath = process.env.AGENT0_API_OUTPUT || DEFAULT_ARTIFACT;
const reportInput = process.env.AGENT0_API_KEY_PROBE_INPUT || artifactPath;
const reportOutput = process.env.AGENT0_API_KEY_PROBE_OUTPUT || DEFAULT_REPORT;

const probe = await runNodeScript('scripts/probe-agent0-api-key-route.mjs');

if (await fileExists(reportInput)) {
  await runNodeScript('scripts/render-agent0-api-key-probe-report.mjs', {
    AGENT0_API_KEY_PROBE_INPUT: reportInput,
    AGENT0_API_KEY_PROBE_OUTPUT: reportOutput,
  });
}

process.exit(probe.code);
