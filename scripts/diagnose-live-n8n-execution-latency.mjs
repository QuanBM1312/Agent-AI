#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildOverlapSummary,
  fetchExecution,
  loadCookieHeader,
  summarizeExecution,
} from './lib/n8n-execution-utils.mjs';

const DEFAULT_BASE_URL = 'https://primary-production-79be44.up.railway.app';
const DEFAULT_COOKIE_FILE = '/tmp/n8n_live.cookie';
const DEFAULT_OUTPUT = 'docs/artifacts/live-n8n/latest-execution-latency-breakdown.json';

function printHelp() {
  console.log(`Usage:
  npm run diagnose:live:n8n-execution

Required env:
  provide either LIVE_N8N_MAIN_EXECUTION_ID or LIVE_N8N_MAIN_EXECUTION_FILE

Optional env:
  LIVE_N8N_BASE_URL            override the live n8n base URL
  LIVE_N8N_COOKIE_FILE         Netscape-format cookie jar for authenticated /rest/executions fetches
  LIVE_N8N_MAIN_EXECUTION_ID   fetch the main execution from /rest/executions/:id
  LIVE_N8N_SUB_EXECUTION_ID    optional paired subworkflow execution id to fetch
  LIVE_N8N_MAIN_EXECUTION_FILE read a previously downloaded main execution JSON file instead
  LIVE_N8N_SUB_EXECUTION_FILE  read a previously downloaded subworkflow execution JSON file instead
  LIVE_N8N_CASE_ID             optional human label for the measured run
  LIVE_N8N_REQUEST_ID          optional app-side request id or trace id
  LIVE_N8N_APP_DURATION_MS     optional end-to-end app duration for comparison against n8n timing
  LIVE_N8N_OUTPUT              output artifact path

What it does:
  1. loads one or two n8n execution payloads from live /rest/executions or local files
  2. parses the flatted execution payload under data.data
  3. summarizes node timings and overlap between main workflow and subworkflow
  4. writes a JSON artifact for later diagnosis and handoff
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const baseUrl = (process.env.LIVE_N8N_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const cookieFile = process.env.LIVE_N8N_COOKIE_FILE || DEFAULT_COOKIE_FILE;
const outputPath = process.env.LIVE_N8N_OUTPUT || DEFAULT_OUTPUT;
const caseId = process.env.LIVE_N8N_CASE_ID || null;
const requestId = process.env.LIVE_N8N_REQUEST_ID || null;
const appDurationMs = Number.parseInt(process.env.LIVE_N8N_APP_DURATION_MS || '', 10);

async function loadRawExecution(label, filePath, executionId, cookieHeader) {
  if (filePath) {
    return {
      label,
      source: { type: 'file', value: filePath },
      raw: JSON.parse(await readFile(filePath, 'utf8')),
    };
  }

  if (executionId) {
    return {
      label,
      source: { type: 'live', value: executionId },
      raw: await fetchExecution(baseUrl, executionId, cookieHeader),
    };
  }

  return null;
}

const mainExecutionId = process.env.LIVE_N8N_MAIN_EXECUTION_ID || '';
const subExecutionId = process.env.LIVE_N8N_SUB_EXECUTION_ID || '';
const mainExecutionFile = process.env.LIVE_N8N_MAIN_EXECUTION_FILE || '';
const subExecutionFile = process.env.LIVE_N8N_SUB_EXECUTION_FILE || '';

if (!mainExecutionId && !mainExecutionFile) {
  console.error('Missing LIVE_N8N_MAIN_EXECUTION_ID or LIVE_N8N_MAIN_EXECUTION_FILE.');
  printHelp();
  process.exit(1);
}

const cookieHeader = await loadCookieHeader(cookieFile);
const mainLoaded = await loadRawExecution('main', mainExecutionFile, mainExecutionId, cookieHeader);
const subLoaded = await loadRawExecution('subworkflow', subExecutionFile, subExecutionId, cookieHeader);

if (!mainLoaded) {
  throw new Error('Failed to load the main execution payload.');
}

const mainExecution = summarizeExecution(mainLoaded.label, mainLoaded.raw);
const subExecution = subLoaded ? summarizeExecution(subLoaded.label, subLoaded.raw) : null;
const overlapSummary = buildOverlapSummary(mainExecution, subExecution, appDurationMs);

const artifact = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  caseId,
  requestId,
  appDurationMs: Number.isFinite(appDurationMs) ? appDurationMs : null,
  sources: {
    main: mainLoaded.source,
    subworkflow: subLoaded?.source || null,
  },
  mainExecution,
  subExecution,
  overlapSummary,
  conclusions: [
    mainExecution.slowestNode
      ? `The main workflow spent most of its measured node time in ${JSON.stringify(mainExecution.slowestNode.name)} (${mainExecution.slowestNode.totalExecutionMs}ms).`
      : null,
    subExecution?.slowestNode
      ? `The paired subworkflow spent most of its measured node time in ${JSON.stringify(subExecution.slowestNode.name)} (${subExecution.slowestNode.totalExecutionMs}ms).`
      : null,
    overlapSummary?.mainExclusiveMs != null
      ? `The main workflow spent about ${overlapSummary.mainExclusiveMs}ms outside the subworkflow overlap window.`
      : null,
    overlapSummary?.appOutsideMainMs != null
      ? `The app-side end-to-end duration exceeded the main workflow duration by about ${overlapSummary.appOutsideMainMs}ms.`
      : null,
  ].filter(Boolean),
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
