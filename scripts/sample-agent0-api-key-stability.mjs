#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveAgent0ApiKey } from './lib/agent0-api-key-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_OUTPUT = 'docs/artifacts/live-n8n/agent0-internal-data-burst-sampling.json';
const DEFAULT_ATTEMPTS = 5;
const DEFAULT_DELAY_MS = 0;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_PROFILE = 'internal_data';

function printHelp() {
  console.log(`
Usage:
  AGENT0_MCP_SERVER_TOKEN=... npm run sample:agent0:stability
  AGENT0_API_KEY=... npm run sample:agent0:stability

Optional env:
  AGENT0_BASE_URL              Base URL to probe
  AGENT0_API_ROUTE             Override route, e.g. /api/api_message
  AGENT0_API_KEY_TRANSPORT     header | body | both. Default: header
  AGENT0_API_PROBE_MODE        basic | retrieval | internal_data | all. Default: internal_data
  AGENT0_API_TIMEOUT_MS        Per-attempt timeout in ms. Default: 60000
  AGENT0_STABILITY_ATTEMPTS    Number of sequential attempts. Default: 5
  AGENT0_STABILITY_DELAY_MS    Delay between attempts in ms. Default: 0
  AGENT0_STABILITY_OUTPUT      Output artifact path
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function percentile(values, fraction) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function classifyAttempt(attempt) {
  if (attempt?.ok) {
    return 'success';
  }
  const errorMessage = String(attempt?.error || '').toLowerCase();
  const summary = String(attempt?.summary || '').toLowerCase();
  if (errorMessage.includes('timeout') || summary.includes('timeout')) {
    return 'timeout';
  }
  if (typeof attempt?.status === 'number') {
    return 'http_error';
  }
  return 'error';
}

function summarizeAttempt(attempt, attemptNumber) {
  return {
    attempt: attemptNumber,
    probeProfile: attempt?.probeProfile || null,
    routePath: attempt?.routePath || null,
    authTransport: attempt?.authTransport || null,
    status: typeof attempt?.status === 'number' ? attempt.status : null,
    ok: Boolean(attempt?.ok),
    durationMs: typeof attempt?.durationMs === 'number' ? attempt.durationMs : null,
    classification: classifyAttempt(attempt),
    summary: attempt?.summary || '',
    error: attempt?.error || null,
  };
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

const attemptsCount = toInt(process.env.AGENT0_STABILITY_ATTEMPTS, DEFAULT_ATTEMPTS);
const delayMs = toInt(process.env.AGENT0_STABILITY_DELAY_MS, DEFAULT_DELAY_MS);
const timeoutMs = toInt(process.env.AGENT0_API_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
const probeMode = process.env.AGENT0_API_PROBE_MODE || DEFAULT_PROFILE;
const outputPath = process.env.AGENT0_STABILITY_OUTPUT || DEFAULT_OUTPUT;

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent0-stability-'));

try {
  const sampleAttempts = [];

  for (let index = 0; index < attemptsCount; index += 1) {
    const attemptNumber = index + 1;
    const tempArtifactPath = path.join(tempDir, `attempt-${attemptNumber}.json`);
    const startedAt = new Date().toISOString();
    const result = await run(
      'node',
      [path.join(__dirname, 'probe-agent0-api-key-route.mjs')],
      {
        cwd: path.resolve(__dirname, '..'),
        env: {
          ...process.env,
          AGENT0_API_KEY_TRANSPORT: process.env.AGENT0_API_KEY_TRANSPORT || 'header',
          AGENT0_API_PROBE_MODE: probeMode,
          AGENT0_API_TIMEOUT_MS: String(timeoutMs),
          AGENT0_API_OUTPUT: tempArtifactPath,
        },
      },
    );
    const completedAt = new Date().toISOString();

    let artifact = null;
    try {
      artifact = JSON.parse(await readFile(tempArtifactPath, 'utf8'));
    } catch {
      artifact = null;
    }

    const pickedAttempt = artifact?.attempts?.find((entry) => entry.probeProfile === probeMode)
      || artifact?.attempts?.[0]
      || null;

    sampleAttempts.push({
      ...summarizeAttempt(pickedAttempt, attemptNumber),
      exitCode: result.code,
      startedAt,
      completedAt,
      apiKeyEnvName: artifact?.apiKeyEnvName || apiKeyEnvName,
    });

    if (delayMs > 0 && attemptNumber < attemptsCount) {
      await sleep(delayMs);
    }
  }

  const successDurations = sampleAttempts
    .filter((attempt) => attempt.ok && typeof attempt.durationMs === 'number')
    .map((attempt) => attempt.durationMs);

  const counts = sampleAttempts.reduce((accumulator, attempt) => {
    accumulator[attempt.classification] = (accumulator[attempt.classification] || 0) + 1;
    return accumulator;
  }, {});

  const artifact = {
    generatedAt: new Date().toISOString(),
    baseUrl: process.env.AGENT0_BASE_URL || 'https://agent0-railway-no-wrapped-production.up.railway.app',
    apiKeyEnvName,
    probeMode,
    attemptsRequested: attemptsCount,
    delayMs,
    timeoutMs,
    outputPath,
    summary: {
      successCount: counts.success || 0,
      timeoutCount: counts.timeout || 0,
      httpErrorCount: counts.http_error || 0,
      errorCount: counts.error || 0,
      successRate: sampleAttempts.length ? Number(((counts.success || 0) / sampleAttempts.length).toFixed(3)) : 0,
      medianSuccessDurationMs: percentile(successDurations, 0.5),
      p95SuccessDurationMs: percentile(successDurations, 0.95),
    },
    attempts: sampleAttempts,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  console.log(`Saved stability artifact to ${outputPath}`);
  console.log(
    JSON.stringify(
      {
        probeMode,
        attemptsRequested: attemptsCount,
        summary: artifact.summary,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
