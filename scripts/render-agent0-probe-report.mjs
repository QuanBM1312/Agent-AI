#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
const DEFAULT_INPUT = 'docs/artifacts/agent0-runtime-probe/latest.json';
const DEFAULT_OUTPUT = 'docs/artifacts/agent0-runtime-probe/latest.md';

function printHelp() {
  console.log(`
Usage:
  npm run probe:agent0:report

Optional env:
  AGENT0_PROBE_INPUT   JSON artifact path
  AGENT0_PROBE_OUTPUT  Markdown output path
`.trim());
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const inputPath = process.env.AGENT0_PROBE_INPUT || DEFAULT_INPUT;
const outputPath = process.env.AGENT0_PROBE_OUTPUT || DEFAULT_OUTPUT;

const raw = await readFile(inputPath, 'utf8');
const artifact = JSON.parse(raw);

const lines = [
  '# Agent0 Runtime Probe Report',
  '',
  `Generated at: ${artifact.generatedAt ?? 'unknown'}`,
  `Base URL: ${artifact.baseUrl ?? 'unknown'}`,
  '',
  '## Classification',
  '',
  `- \`${artifact.classification ?? 'unknown'}\``,
  '',
  '## Endpoint matrix',
  '',
  '| Endpoint | Status | Expected OK? | Summary |',
  '| --- | --- | --- | --- |',
];

for (const result of artifact.results ?? []) {
  const summary = String(result.summary ?? '').replace(/\|/g, '\\|');
lines.push(
    `| \`${result.path}\` | ${result.status ?? 'error'} | ${result.ok ? 'yes' : 'no'} | ${summary} |`,
  );
}

if (artifact.classification === 'partial_runtime_missing_http_endpoints') {
  lines.push(
    '',
    '## Interpretation',
    '',
    '- UI/login and Socket.IO are reachable.',
    '- The HTTP API layer expected by current n8n integration is not reachable.',
    '- This points to a deploy/runtime contract mismatch, not a fully dead service.',
  );
}

if (artifact.classification === 'api_prefixed_runtime_contract_mismatch') {
  lines.push(
    '',
    '## Interpretation',
    '',
    '- UI/login and Socket.IO are reachable.',
    '- Several API routes exist under `/api/*`, while the legacy root-level paths remain `404`.',
    '- This points to a contract/prefix mismatch across the live runtime surface, not a fully missing backend.',
  );
}

const rootSignals = artifact.results?.find((item) => item.name === 'root')?.signals;
if (rootSignals) {
  lines.push(
    '',
    '## Root runtime signals',
    '',
    `- git version: \`${rootSignals.gitVersion ?? 'unknown'}\``,
    `- git commit time: \`${rootSignals.gitCommitTime ?? 'unknown'}\``,
    `- runtime id: \`${rootSignals.runtimeId ?? 'unknown'}\``,
    `- auth configured in rendered page: \`${String(rootSignals.authConfigured ?? 'unknown')}\``,
  );
}

const frontendContract = artifact.frontendContract;
if (frontendContract) {
  lines.push(
    '',
    '## Frontend contract signals',
    '',
    `- index.js uses legacy \`/message_async\`: \`${String(frontendContract.usesLegacyMessageAsyncPath ?? 'unknown')}\``,
    `- index.js mentions legacy \`/poll\`: \`${String(frontendContract.mentionsLegacyPollPath ?? 'unknown')}\``,
    `- js/api.js uses \`/api/csrf_token\`: \`${String(frontendContract.usesApiCsrfTokenPath ?? 'unknown')}\``,
    `- js/websocket.js uses Socket.IO: \`${String(frontendContract.websocketUsesSocketIo ?? 'unknown')}\``,
    `- js/websocket.js sends CSRF token in auth payload: \`${String(frontendContract.websocketUsesCsrfToken ?? 'unknown')}\``,
    `- sync-store uses \`state_request\`: \`${String(frontendContract.syncStoreUsesStateRequest ?? 'unknown')}\``,
    `- sync-store uses \`state_push\`: \`${String(frontendContract.syncStoreUsesStatePush ?? 'unknown')}\``,
  );

  const assets = frontendContract.assets ?? {};
  const assetRows = Object.entries(assets);
  if (assetRows.length > 0) {
    lines.push('', '### Asset fetch status', '', '| Asset | Status | Content-Type |', '| --- | --- | --- |');
    for (const [assetPath, asset] of assetRows) {
      lines.push(`| \`${assetPath}\` | ${asset.status ?? 'error'} | ${asset.contentType ?? ''} |`);
    }
  }
}

const behaviorRows = artifact.behaviorResults ?? [];
if (behaviorRows.length > 0) {
  lines.push(
    '',
    '## Auth / method behavior',
    '',
    '| Check | Method | Status | Expected OK? | Summary |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const row of behaviorRows) {
    const summary = String(row.summary ?? '').replace(/\|/g, '\\|');
    lines.push(
      `| \`${row.path}\` | ${row.method ?? ''} | ${row.status ?? 'error'} | ${row.ok ? 'yes' : 'no'} | ${summary} |`,
    );
  }
}

await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Saved Markdown report to ${outputPath}`);
