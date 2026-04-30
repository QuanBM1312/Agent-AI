#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveAgent0ApiKey } from './lib/agent0-api-key-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_OUTPUT = 'docs/artifacts/live-n8n/agent0-context-reuse-probe.json';

function printHelp() {
  console.log(`
Usage:
  AGENT0_MCP_SERVER_TOKEN=... npm run probe:agent0:context-reuse
  AGENT0_API_KEY=... npm run probe:agent0:context-reuse

Optional env:
  AGENT0_CONTEXT_REUSE_PROFILE      basic | retrieval | internal_data. Default: internal_data
  AGENT0_CONTEXT_REUSE_MESSAGE      Override the first-hop message for the selected profile
  AGENT0_CONTEXT_REUSE_FOLLOWUP_MESSAGE Override the second-hop message. Default: reuse the first-hop message
  AGENT0_CONTEXT_REUSE_OUTPUT       Output artifact path
  AGENT0_API_TIMEOUT_MS             Per-hop timeout in ms
`.trim());
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
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

function summarizeHop(artifact, exitCode, hopName) {
  const success = artifact?.success || null;
  return {
    hop: hopName,
    exitCode,
    ok: Boolean(success?.ok),
    status: typeof success?.status === 'number' ? success.status : null,
    durationMs: typeof success?.durationMs === 'number' ? success.durationMs : null,
    contextId: success?.parsed?.context_id || null,
    summary: success?.summary || '',
    allProfilesSuccessful: Boolean(artifact?.allProfilesSuccessful),
  };
}

const { envName: apiKeyEnvName } = resolveAgent0ApiKey(process.env);
if (!apiKeyEnvName) {
  console.error('Missing AGENT0_API_KEY or AGENT0_MCP_SERVER_TOKEN');
  process.exit(1);
}

const probeProfile = process.env.AGENT0_CONTEXT_REUSE_PROFILE || 'internal_data';
const outputPath = process.env.AGENT0_CONTEXT_REUSE_OUTPUT || DEFAULT_OUTPUT;
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent0-context-reuse-'));

try {
  const firstArtifactPath = path.join(tempDir, 'hop1.json');
  const secondArtifactPath = path.join(tempDir, 'hop2.json');

  const firstEnv = {
    ...process.env,
    AGENT0_API_PROBE_MODE: probeProfile,
    AGENT0_API_OUTPUT: firstArtifactPath,
  };

  if (process.env.AGENT0_CONTEXT_REUSE_MESSAGE) {
    if (probeProfile === 'retrieval') {
      firstEnv.AGENT0_API_RETRIEVAL_MESSAGE = process.env.AGENT0_CONTEXT_REUSE_MESSAGE;
    } else if (probeProfile === 'internal_data') {
      firstEnv.AGENT0_API_INTERNAL_DATA_MESSAGE = process.env.AGENT0_CONTEXT_REUSE_MESSAGE;
    } else {
      firstEnv.AGENT0_API_MESSAGE = process.env.AGENT0_CONTEXT_REUSE_MESSAGE;
    }
  }

  const firstResult = await run('node', [path.join(__dirname, 'probe-agent0-api-key-route.mjs')], {
    cwd: path.resolve(__dirname, '..'),
    env: firstEnv,
  });
  const firstArtifact = JSON.parse(await readFile(firstArtifactPath, 'utf8'));
  const firstHop = summarizeHop(firstArtifact, firstResult.code, 'cold');

  const secondEnv = {
    ...firstEnv,
    AGENT0_API_OUTPUT: secondArtifactPath,
    AGENT0_API_CONTEXT_ID: firstHop.contextId || '',
  };

  const followupMessage = process.env.AGENT0_CONTEXT_REUSE_FOLLOWUP_MESSAGE;
  if (followupMessage) {
    if (probeProfile === 'retrieval') {
      secondEnv.AGENT0_API_RETRIEVAL_MESSAGE = followupMessage;
    } else if (probeProfile === 'internal_data') {
      secondEnv.AGENT0_API_INTERNAL_DATA_MESSAGE = followupMessage;
    } else {
      secondEnv.AGENT0_API_MESSAGE = followupMessage;
    }
  }

  let secondArtifact = null;
  let secondHop = null;
  if (firstHop.contextId) {
    const secondResult = await run(
      'node',
      [path.join(__dirname, 'probe-agent0-api-key-route.mjs')],
      {
        cwd: path.resolve(__dirname, '..'),
        env: secondEnv,
      },
    );
    secondArtifact = JSON.parse(await readFile(secondArtifactPath, 'utf8'));
    secondHop = summarizeHop(secondArtifact, secondResult.code, 'warm');
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    apiKeyEnvName,
    probeProfile,
    firstHop,
    secondHop,
    summary: {
      hasReusableContextId: Boolean(firstHop.contextId),
      coldDurationMs: firstHop.durationMs,
      warmDurationMs: secondHop?.durationMs || null,
      latencyDeltaMs:
        typeof firstHop.durationMs === 'number' && typeof secondHop?.durationMs === 'number'
          ? secondHop.durationMs - firstHop.durationMs
          : null,
      warmFaster:
        typeof firstHop.durationMs === 'number' && typeof secondHop?.durationMs === 'number'
          ? secondHop.durationMs < firstHop.durationMs
          : null,
    },
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  console.log(`Saved context reuse artifact to ${outputPath}`);
  console.log(JSON.stringify(artifact.summary, null, 2));
  process.exit(secondHop?.ok || firstHop.ok ? 0 : 1);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
