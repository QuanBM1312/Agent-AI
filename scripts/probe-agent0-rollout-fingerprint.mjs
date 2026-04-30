#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROJECT_ROOT = process.cwd();
const DEFAULT_BASE_URL = 'https://agent0-railway-no-wrapped-production.up.railway.app';
const DEFAULT_DEPLOY_ROOT = path.join(process.env.HOME || '', '.external', 'agent0-railway-no-wrapped');
const BASE_URL = (process.env.AGENT0_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const DEPLOY_ROOT = process.env.AGENT0_RAILWAY_DEPLOY_ROOT || DEFAULT_DEPLOY_ROOT;
const OUTPUT = process.env.AGENT0_ROLLOUT_FINGERPRINT_OUTPUT ||
  path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-rollout-fingerprint.json');

function printHelp() {
  console.log(`Usage:
  npm run probe:agent0:rollout-fingerprint

Optional env:
  AGENT0_BASE_URL                    live agent0 base URL
  AGENT0_RAILWAY_DEPLOY_ROOT         wrapper deploy checkout
  AGENT0_ROLLOUT_FINGERPRINT_OUTPUT  output artifact path
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
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

    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

const artifact = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  deployRoot: DEPLOY_ROOT,
  live: null,
  baseImage: null,
  wrapperRepo: null,
  limitations: {
    healthTracksInnerRepo: null,
  },
  comparisons: {
    liveMatchesBaseImage: null,
    liveMatchesWrapperHead: null,
    wrapperHeadDiffersFromBaseImage: null,
  },
  conclusions: [],
};

try {
  const liveResponse = await fetch(`${BASE_URL}/api/health`, {
    headers: {
      'user-agent': 'agent-ai-rollout-fingerprint/1.0',
    },
  });
  const livePayload = await liveResponse.json();
  artifact.live = {
    status: liveResponse.status,
    ok: liveResponse.ok,
    gitBranch: livePayload?.gitinfo?.branch || null,
    gitCommitHash: livePayload?.gitinfo?.commit_hash || null,
    gitShortTag: livePayload?.gitinfo?.short_tag || null,
    gitVersion: livePayload?.gitinfo?.version || null,
  };

  const baseImageRun = await run(
    'docker',
    [
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      'agent0ai/agent-zero:latest',
      '-lc',
      'git -C /git/agent-zero rev-parse HEAD && git -C /git/agent-zero describe --tags --always',
    ],
    { cwd: PROJECT_ROOT },
  );
  if (!baseImageRun.ok) {
    throw new Error(baseImageRun.stderr || baseImageRun.stdout || 'Failed to inspect base image git fingerprint');
  }
  const [baseCommit, baseDescribe] = baseImageRun.stdout.split('\n');
  artifact.baseImage = {
    gitCommitHash: baseCommit || null,
    gitDescribe: baseDescribe || null,
  };

  const healthSourceRun = await run(
    'docker',
    [
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      'agent0ai/agent-zero:latest',
      '-lc',
      [
        "grep -q 'from helpers import errors, git' /git/agent-zero/api/health.py",
        "grep -q 'repo_path = files.get_base_dir()' /git/agent-zero/helpers/git.py",
      ].join(' && '),
    ],
    { cwd: PROJECT_ROOT },
  );
  artifact.limitations.healthTracksInnerRepo = healthSourceRun.ok;

  const wrapperHeadRun = await run(
    'git',
    ['-C', DEPLOY_ROOT, 'rev-parse', 'HEAD'],
    { cwd: PROJECT_ROOT },
  );
  if (!wrapperHeadRun.ok) {
    throw new Error(wrapperHeadRun.stderr || wrapperHeadRun.stdout || 'Failed to inspect wrapper repo HEAD');
  }
  artifact.wrapperRepo = {
    headCommitHash: wrapperHeadRun.stdout || null,
  };

  artifact.comparisons.liveMatchesBaseImage =
    Boolean(artifact.live.gitCommitHash) &&
    artifact.live.gitCommitHash === artifact.baseImage.gitCommitHash;
  artifact.comparisons.liveMatchesWrapperHead =
    Boolean(artifact.live.gitCommitHash) &&
    artifact.live.gitCommitHash === artifact.wrapperRepo.headCommitHash;
  artifact.comparisons.wrapperHeadDiffersFromBaseImage =
    Boolean(artifact.wrapperRepo.headCommitHash) &&
    artifact.wrapperRepo.headCommitHash !== artifact.baseImage.gitCommitHash;
} catch (error) {
  artifact.error = error instanceof Error ? error.message : String(error);
}

artifact.conclusions.push(
  artifact.comparisons.liveMatchesBaseImage
    ? 'Live agent0 reports the same git commit as the local base image.'
    : 'Live agent0 does not report the same git commit as the local base image.',
);
artifact.conclusions.push(
  artifact.comparisons.liveMatchesWrapperHead
    ? 'Live agent0 reports the same git commit as the wrapper deploy repo HEAD.'
    : 'Live agent0 does not report the same git commit as the wrapper deploy repo HEAD.',
);
artifact.conclusions.push(
  artifact.limitations.healthTracksInnerRepo
    ? 'The health endpoint fingerprints the inner agent-zero repo, so commit mismatch versus wrapper HEAD does not by itself prove wrapper rollout state.'
    : artifact.comparisons.liveMatchesBaseImage && artifact.comparisons.wrapperHeadDiffersFromBaseImage
      ? 'This suggests the live health endpoint still matches the stock base-image git state.'
      : 'The current fingerprint comparison does not prove that the live runtime is still on the stock base-image git state.',
);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
