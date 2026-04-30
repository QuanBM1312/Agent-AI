#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const DEFAULT_INPUT = 'docs/artifacts/agent0-api-key-probe/latest.json';
const DEFAULT_OUTPUT = 'docs/artifacts/agent0-api-key-probe/latest.md';

function printHelp() {
  console.log(`
Usage:
  npm run probe:agent0:api-key:report

Optional env:
  AGENT0_API_KEY_PROBE_INPUT   JSON artifact path
  AGENT0_API_KEY_PROBE_OUTPUT  Markdown output path
`.trim());
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const inputPath = process.env.AGENT0_API_KEY_PROBE_INPUT || DEFAULT_INPUT;
const outputPath = process.env.AGENT0_API_KEY_PROBE_OUTPUT || DEFAULT_OUTPUT;

const raw = await readFile(inputPath, 'utf8');
const artifact = JSON.parse(raw);

const lines = [
  '# Agent0 API-Key Probe Report',
  '',
  `Generated at: ${artifact.generatedAt ?? 'unknown'}`,
  `Base URL: ${artifact.baseUrl ?? 'unknown'}`,
  `Explicit route override: ${artifact.explicitRoute ?? 'none'}`,
  `API key env source: ${artifact.apiKeyEnvName ?? 'unknown'}`,
  `Probe profiles: ${(artifact.probeProfiles || []).join(', ') || 'legacy-single'}`,
  `Per-attempt timeout: ${artifact.timeoutMs ?? 'unknown'} ms`,
  '',
  '## Input shape',
  '',
  `- basic message: \`${artifact.inputShape?.basicMessage ?? artifact.inputShape?.message ?? ''}\``,
  `- retrieval message: \`${artifact.inputShape?.retrievalMessage ?? ''}\``,
  `- internal-data message: \`${artifact.inputShape?.internalDataMessage ?? ''}\``,
  `- has context_id: \`${String(artifact.inputShape?.hasContextId ?? false)}\``,
  '',
  '## Outcome',
  '',
  `- success: \`${String(Boolean(artifact.success))}\``,
  `- all requested profiles successful: \`${String(Boolean(artifact.allProfilesSuccessful ?? artifact.success))}\``,
  `- auth transports tried: \`${(artifact.authTransports || []).join(', ') || 'unknown'}\``,
  '',
  '## Profile status',
  '',
];

for (const [profileName, profileResult] of Object.entries(artifact.profileResults || {})) {
  lines.push(
    `- ${profileName}: \`${profileResult?.ok ? 'ok' : 'failed'}\`${profileResult?.success ? ` via \`${profileResult.success.routePath}\` + \`${profileResult.success.authTransport}\`` : ''}`,
  );
}

lines.push(
  '',
  '## Attempts',
  '',
  '| Profile | Route | Auth | Status | OK? | Content-Type | Summary |',
  '| --- | --- | --- | --- | --- | --- | --- |',
);

for (const attempt of artifact.attempts ?? []) {
  const summary = String(attempt.summary ?? '').replace(/\|/g, '\\|');
  lines.push(
    `| \`${attempt.probeProfile ?? 'legacy'}\` | \`${attempt.routePath}\` | \`${attempt.authTransport ?? 'unknown'}\` | ${attempt.status ?? 'error'} | ${attempt.ok ? 'yes' : 'no'} | ${attempt.contentType ?? ''} | ${summary} |`,
  );
}

if (artifact.success?.parsed) {
  lines.push(
    '',
    '## Parsed success payload',
    '',
    '```json',
    JSON.stringify(artifact.success.parsed, null, 2),
    '```',
  );
}

await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`Saved Markdown report to ${outputPath}`);
