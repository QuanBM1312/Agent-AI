#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveAgent0ApiKey } from './lib/agent0-api-key-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_OUTPUT = 'docs/artifacts/live-n8n/agent0-context-chain-sample.json';

function printHelp() {
  console.log(`
Usage:
  AGENT0_MCP_SERVER_TOKEN=... npm run sample:agent0:context-chain
  AGENT0_API_KEY=... npm run sample:agent0:context-chain

Optional env:
  AGENT0_CONTEXT_CHAIN_PROFILE   basic | retrieval | internal_data. Default: internal_data
  AGENT0_CONTEXT_CHAIN_HOPS      Total hop count including the first cold hop. Default: 3
  AGENT0_CONTEXT_CHAIN_MESSAGE   Override all hops to use the same message
  AGENT0_CONTEXT_CHAIN_OUTPUT    Output artifact path
  AGENT0_API_TIMEOUT_MS          Per-hop timeout in ms
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

function summarizeHop(artifact, exitCode, hopNumber) {
  const success = artifact?.success || null;
  return {
    hop: hopNumber,
    exitCode,
    ok: Boolean(success?.ok),
    status: typeof success?.status === 'number' ? success.status : null,
    durationMs: typeof success?.durationMs === 'number' ? success.durationMs : null,
    contextId: success?.parsed?.context_id || null,
    summary: success?.summary || '',
  };
}

const { envName: apiKeyEnvName } = resolveAgent0ApiKey(process.env);
if (!apiKeyEnvName) {
  console.error('Missing AGENT0_API_KEY or AGENT0_MCP_SERVER_TOKEN');
  process.exit(1);
}

const profile = process.env.AGENT0_CONTEXT_CHAIN_PROFILE || 'internal_data';
const hopCount = Number.parseInt(process.env.AGENT0_CONTEXT_CHAIN_HOPS || '3', 10);
const outputPath = process.env.AGENT0_CONTEXT_CHAIN_OUTPUT || DEFAULT_OUTPUT;
const messageOverride = process.env.AGENT0_CONTEXT_CHAIN_MESSAGE || '';
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agent0-context-chain-'));

try {
  const hops = [];
  let currentContextId = '';

  for (let index = 0; index < hopCount; index += 1) {
    const hopNumber = index + 1;
    const artifactPath = path.join(tempDir, `hop-${hopNumber}.json`);
    const env = {
      ...process.env,
      AGENT0_API_PROBE_MODE: profile,
      AGENT0_API_OUTPUT: artifactPath,
    };

    if (currentContextId) {
      env.AGENT0_API_CONTEXT_ID = currentContextId;
    }

    if (messageOverride) {
      if (profile === 'retrieval') {
        env.AGENT0_API_RETRIEVAL_MESSAGE = messageOverride;
      } else if (profile === 'internal_data') {
        env.AGENT0_API_INTERNAL_DATA_MESSAGE = messageOverride;
      } else {
        env.AGENT0_API_MESSAGE = messageOverride;
      }
    }

    const result = await run('node', [path.join(__dirname, 'probe-agent0-api-key-route.mjs')], {
      cwd: path.resolve(__dirname, '..'),
      env,
    });
    const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
    const hop = summarizeHop(artifact, result.code, hopNumber);
    hops.push(hop);
    currentContextId = hop.contextId || currentContextId;

    if (!hop.ok || !hop.contextId) {
      break;
    }
  }

  const durations = hops.filter((hop) => typeof hop.durationMs === 'number').map((hop) => hop.durationMs);
  const artifact = {
    generatedAt: new Date().toISOString(),
    apiKeyEnvName,
    profile,
    hopCountRequested: hopCount,
    hops,
    summary: {
      hopsCompleted: hops.length,
      allSuccessful: hops.length === hopCount && hops.every((hop) => hop.ok),
      firstHopDurationMs: durations[0] ?? null,
      fastestWarmHopDurationMs: durations.length > 1 ? Math.min(...durations.slice(1)) : null,
      finalContextId: hops.at(-1)?.contextId || null,
    },
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  console.log(`Saved context chain artifact to ${outputPath}`);
  console.log(JSON.stringify(artifact.summary, null, 2));
  process.exit(artifact.summary.allSuccessful ? 0 : 1);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
