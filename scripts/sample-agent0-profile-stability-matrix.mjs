#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveAgent0ApiKey } from './lib/agent0-api-key-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PROFILES = ['basic', 'retrieval', 'internal_data'];
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_OUTPUT = 'docs/artifacts/live-n8n/agent0-profile-stability-matrix.json';

function printHelp() {
  console.log(`
Usage:
  AGENT0_MCP_SERVER_TOKEN=... npm run sample:agent0:matrix
  AGENT0_API_KEY=... npm run sample:agent0:matrix

Optional env:
  AGENT0_STABILITY_PROFILES    Comma-separated probe profiles. Default: basic,retrieval,internal_data
  AGENT0_STABILITY_ATTEMPTS    Sequential attempts per profile. Default: 3
  AGENT0_STABILITY_DELAY_MS    Delay between attempts in ms. Default: 0
  AGENT0_API_TIMEOUT_MS        Per-attempt timeout in ms
  AGENT0_STABILITY_MATRIX_OUTPUT Output artifact path
`.trim());
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

function toInt(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

const { envName: apiKeyEnvName } = resolveAgent0ApiKey(process.env);

if (!apiKeyEnvName) {
  console.error('Missing AGENT0_API_KEY or AGENT0_MCP_SERVER_TOKEN');
  process.exit(1);
}

const profiles = (process.env.AGENT0_STABILITY_PROFILES || DEFAULT_PROFILES.join(','))
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const attemptsPerProfile = toInt(process.env.AGENT0_STABILITY_ATTEMPTS, DEFAULT_ATTEMPTS);
const outputPath = process.env.AGENT0_STABILITY_MATRIX_OUTPUT || DEFAULT_OUTPUT;

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent0-stability-matrix-'));

try {
  const profileRuns = [];

  for (const profile of profiles) {
    const tempArtifactPath = path.join(tempDir, `${profile}.json`);
    const result = await run(
      'node',
      [path.join(__dirname, 'sample-agent0-api-key-stability.mjs')],
      {
        cwd: path.resolve(__dirname, '..'),
        env: {
          ...process.env,
          AGENT0_API_PROBE_MODE: profile,
          AGENT0_STABILITY_ATTEMPTS: String(attemptsPerProfile),
          AGENT0_STABILITY_OUTPUT: tempArtifactPath,
        },
      },
    );

    const artifact = JSON.parse(await readFile(tempArtifactPath, 'utf8'));
    const successDurations = (artifact.attempts || [])
      .filter((attempt) => attempt.ok && typeof attempt.durationMs === 'number')
      .map((attempt) => attempt.durationMs);

    profileRuns.push({
      profile,
      exitCode: result.code,
      summary: artifact.summary,
      attempts: artifact.attempts,
      medianObservedDurationMs: median(successDurations),
    });
  }

  const slowestProfile = [...profileRuns]
    .filter((entry) => typeof entry.medianObservedDurationMs === 'number')
    .sort((left, right) => right.medianObservedDurationMs - left.medianObservedDurationMs)[0] || null;

  const artifact = {
    generatedAt: new Date().toISOString(),
    apiKeyEnvName,
    attemptsPerProfile,
    profiles,
    summary: {
      profilesTested: profileRuns.length,
      profilesWithTimeouts: profileRuns
        .filter((entry) => (entry.summary?.timeoutCount || 0) > 0)
        .map((entry) => entry.profile),
      profilesWithAllSuccesses: profileRuns
        .filter((entry) => (entry.summary?.successCount || 0) === attemptsPerProfile)
        .map((entry) => entry.profile),
      slowestProfile: slowestProfile?.profile || null,
      slowestProfileMedianDurationMs: slowestProfile?.medianObservedDurationMs || null,
    },
    profileRuns,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  console.log(`Saved stability matrix artifact to ${outputPath}`);
  console.log(
    JSON.stringify(
      {
        attemptsPerProfile,
        profiles,
        summary: artifact.summary,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
