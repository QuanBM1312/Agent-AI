#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildOverlapSummary,
  fetchExecution,
  fetchExecutionList,
  loadCookieHeader,
  summarizeExecution,
  toMs,
} from './lib/n8n-execution-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_BASE_URL = 'https://primary-production-79be44.up.railway.app';
const DEFAULT_COOKIE_FILE = '/tmp/n8n_live.cookie';
const DEFAULT_INPUT = path.join(projectRoot, 'docs', 'artifacts', 'chat-eval', 'latest.json');
const DEFAULT_OUTPUT = path.join(
  projectRoot,
  'docs',
  'artifacts',
  'live-n8n',
  'latest-chat-eval-execution-correlation.json',
);
const DEFAULT_MAIN_WORKFLOW_ID = '7Lq2tknqGOVcdAvm';
const DEFAULT_SUB_WORKFLOW_ID = 'awr_01MNmP2mUsOIoEkjq';

function printHelp() {
  console.log(`Usage:
  npm run correlate:chat-eval:n8n

Optional env:
  CHAT_EVAL_INPUT                     input eval artifact path
  CHAT_EVAL_N8N_CORRELATION_OUTPUT    output artifact path
  LIVE_N8N_BASE_URL                   override the live n8n base URL
  LIVE_N8N_COOKIE_FILE                Netscape-format cookie jar for authenticated /rest/executions fetches
  LIVE_N8N_MAIN_WORKFLOW_ID           main workflow id to correlate
  LIVE_N8N_SUB_WORKFLOW_ID            Search_Agent0 workflow id to correlate
  LIVE_N8N_LIST_LIMIT                 number of recent executions to scan per workflow
  LIVE_N8N_MATCH_PADDING_MS           expand the eval window by this much when matching executions
  LIVE_N8N_SUB_MATCH_PADDING_MS       expand the main-execution window by this much when matching subworkflow executions

Requirements:
  Each eval result must contain startedAt and completedAt timestamps. Re-run eval:chat with the updated script if the artifact is older.
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const inputPath = process.env.CHAT_EVAL_INPUT || DEFAULT_INPUT;
const outputPath = process.env.CHAT_EVAL_N8N_CORRELATION_OUTPUT || DEFAULT_OUTPUT;
const baseUrl = (process.env.LIVE_N8N_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const cookieFile = process.env.LIVE_N8N_COOKIE_FILE || DEFAULT_COOKIE_FILE;
const mainWorkflowId = process.env.LIVE_N8N_MAIN_WORKFLOW_ID || DEFAULT_MAIN_WORKFLOW_ID;
const subWorkflowId = process.env.LIVE_N8N_SUB_WORKFLOW_ID || DEFAULT_SUB_WORKFLOW_ID;
const listLimit = Number.parseInt(process.env.LIVE_N8N_LIST_LIMIT || '100', 10);
const matchPaddingMs = Number.parseInt(process.env.LIVE_N8N_MATCH_PADDING_MS || '10000', 10);
const subMatchPaddingMs = Number.parseInt(process.env.LIVE_N8N_SUB_MATCH_PADDING_MS || '2000', 10);

function overlapMs(windowStart, windowEnd, otherStart, otherEnd) {
  return Math.max(0, Math.min(windowEnd, otherEnd) - Math.max(windowStart, otherStart));
}

function scoreCandidate(evalStart, evalEnd, executionStart, executionEnd, paddingMs) {
  const paddedStart = evalStart - paddingMs;
  const paddedEnd = evalEnd + paddingMs;
  const overlap = overlapMs(paddedStart, paddedEnd, executionStart, executionEnd);
  return {
    overlapMs: overlap,
    startDeltaMs: Math.abs(executionStart - evalStart),
    endDeltaMs: Math.abs(executionEnd - evalEnd),
  };
}

function pickBestExecution(results, evalStart, evalEnd, paddingMs) {
  const candidates = results
    .map((execution) => {
      const executionStart = toMs(execution.startedAt);
      const executionEnd = toMs(execution.stoppedAt);
      if (executionStart == null || executionEnd == null) return null;
      return {
        execution,
        ...scoreCandidate(evalStart, evalEnd, executionStart, executionEnd, paddingMs),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.overlapMs !== left.overlapMs) return right.overlapMs - left.overlapMs;
      if (left.startDeltaMs !== right.startDeltaMs) return left.startDeltaMs - right.startDeltaMs;
      return left.endDeltaMs - right.endDeltaMs;
    });

  return candidates[0] || null;
}

function pickBestSubExecution(results, mainExecution, paddingMs) {
  if (!mainExecution?.startedAt || !mainExecution?.stoppedAt) return null;
  const mainStart = toMs(mainExecution.startedAt);
  const mainEnd = toMs(mainExecution.stoppedAt);
  const candidate = pickBestExecution(results, mainStart, mainEnd, paddingMs);
  if (!candidate || candidate.overlapMs <= 0) {
    return null;
  }
  return candidate;
}

const artifact = JSON.parse(await readFile(inputPath, 'utf8'));
const results = artifact.results || [];
const missingTimestamps = results.filter((result) => !result.startedAt || !result.completedAt).map((result) => result.id);

if (missingTimestamps.length > 0) {
  throw new Error(
    `Eval artifact is missing startedAt/completedAt for cases: ${missingTimestamps.join(', ')}. Re-run eval:chat with the updated script first.`,
  );
}

const cookieHeader = await loadCookieHeader(cookieFile);
const [fetchedMainList, fetchedSubList] = await Promise.all([
  fetchExecutionList(baseUrl, mainWorkflowId, cookieHeader, listLimit),
  fetchExecutionList(baseUrl, subWorkflowId, cookieHeader, listLimit),
]);
const mainList = [...fetchedMainList].sort((left, right) => (toMs(left.startedAt) || 0) - (toMs(right.startedAt) || 0));
const subList = [...fetchedSubList].sort((left, right) => (toMs(left.startedAt) || 0) - (toMs(right.startedAt) || 0));

const detailCache = new Map();

async function loadExecutionSummary(label, executionId) {
  if (!executionId) return null;
  if (detailCache.has(executionId)) return detailCache.get(executionId);
  const raw = await fetchExecution(baseUrl, executionId, cookieHeader);
  const summary = summarizeExecution(label, raw);
  detailCache.set(executionId, summary);
  return summary;
}

const correlations = [];
const remainingMain = [...mainList];
const remainingSub = [...subList];

for (const result of [...results].sort((left, right) => (toMs(left.startedAt) || 0) - (toMs(right.startedAt) || 0))) {
  const evalStart = toMs(result.startedAt);
  const evalEnd = toMs(result.completedAt);

  if (evalStart == null || evalEnd == null) {
    correlations.push({
      id: result.id,
      matched: false,
      reason: 'invalid_eval_timestamps',
    });
    continue;
  }

  const mainCandidate = pickBestExecution(remainingMain, evalStart, evalEnd, matchPaddingMs);
  const mainExecution = mainCandidate ? await loadExecutionSummary('main', mainCandidate.execution.id) : null;
  const subCandidate = mainExecution ? pickBestSubExecution(remainingSub, mainExecution, subMatchPaddingMs) : null;
  const subExecution = subCandidate ? await loadExecutionSummary('subworkflow', subCandidate.execution.id) : null;

  if (mainCandidate) {
    const index = remainingMain.findIndex((entry) => String(entry.id) === String(mainCandidate.execution.id));
    if (index >= 0) remainingMain.splice(index, 1);
  }

  if (subCandidate) {
    const index = remainingSub.findIndex((entry) => String(entry.id) === String(subCandidate.execution.id));
    if (index >= 0) remainingSub.splice(index, 1);
  }

  correlations.push({
    id: result.id,
    requestId: result.requestId || null,
    routeHint: result.routeHint || null,
    durationMs: result.durationMs,
    serverDurationMs: result.serverDurationMs || null,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    matched: Boolean(mainExecution),
    mainCandidate: mainCandidate
      ? {
          executionId: String(mainCandidate.execution.id),
          overlapMs: mainCandidate.overlapMs,
          startDeltaMs: mainCandidate.startDeltaMs,
          endDeltaMs: mainCandidate.endDeltaMs,
        }
      : null,
    subCandidate: subCandidate
      ? {
          executionId: String(subCandidate.execution.id),
          overlapMs: subCandidate.overlapMs,
          startDeltaMs: subCandidate.startDeltaMs,
          endDeltaMs: subCandidate.endDeltaMs,
        }
      : null,
    mainExecution,
    subExecution,
    overlapSummary: mainExecution && subExecution
      ? buildOverlapSummary(mainExecution, subExecution, result.durationMs)
      : null,
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  inputPath: path.relative(projectRoot, inputPath),
  baseUrl,
  mainWorkflowId,
  subWorkflowId,
  listLimit,
  matchPaddingMs,
  subMatchPaddingMs,
  summary: {
    totalCases: correlations.length,
    matchedCases: correlations.filter((entry) => entry.matched).length,
    dominantMainNodes: correlations.reduce((acc, entry) => {
      const key = entry.mainExecution?.slowestNode?.name;
      if (!key) return acc;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    dominantSubNodes: correlations.reduce((acc, entry) => {
      const key = entry.subExecution?.slowestNode?.name;
      if (!key) return acc;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  },
  correlations,
  conclusions: [
    correlations.every((entry) => entry.matched)
      ? 'Every eval case was matched to a live main-workflow execution.'
      : 'Some eval cases could not be matched to a live main-workflow execution.',
    Object.keys(
      correlations.reduce((acc, entry) => {
        const key = entry.subExecution?.slowestNode?.name;
        if (!key) return acc;
        acc[key] = true;
        return acc;
      }, {}),
    ).length === 1
      ? `All matched subworkflow executions share the same dominant node: ${JSON.stringify(correlations.find((entry) => entry.subExecution?.slowestNode?.name)?.subExecution?.slowestNode?.name)}.`
      : 'Matched subworkflow executions do not all share the same dominant node.',
  ],
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output, null, 2));
