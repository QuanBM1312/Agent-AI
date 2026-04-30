#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROJECT_ROOT = process.cwd();
const OUTPUT = process.env.AGENT0_WRAPPER_DEPENDENCY_DRIFT_OUTPUT ||
  path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-wrapper-dependency-drift.json');
const IMAGE = process.env.AGENT0_WRAPPER_BASE_IMAGE || 'agent0ai/agent-zero:latest';

function printHelp() {
  console.log(`Usage:
  npm run probe:agent0:wrapper-dependency-drift

Optional env:
  AGENT0_WRAPPER_BASE_IMAGE              base image to inspect
  AGENT0_WRAPPER_DEPENDENCY_DRIFT_OUTPUT output artifact path
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

function extractWouldInstall(stdout) {
  const line = stdout
    .split('\n')
    .find((entry) => entry.startsWith('Would install '));
  if (!line) {
    return [];
  }

  return line
    .replace('Would install ', '')
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
}

function summarizePackages(packages) {
  const hasTorchUpgrade = packages.some((pkg) => pkg.startsWith('torch-2.11.0'));
  const hasTorchvisionUpgrade = packages.some((pkg) => pkg.startsWith('torchvision-0.26.0'));
  const cudaPackages = packages.filter((pkg) =>
    pkg.startsWith('cuda-') || pkg.startsWith('nvidia-') || pkg.startsWith('triton-'),
  );

  return {
    totalPackages: packages.length,
    hasTorchUpgrade,
    hasTorchvisionUpgrade,
    cudaPackageCount: cudaPackages.length,
    cudaPackages,
  };
}

async function pipDryRun(shellCommand) {
  return run(
    'docker',
    ['run', '--rm', '--entrypoint', 'sh', IMAGE, '-lc', shellCommand],
    { cwd: PROJECT_ROOT },
  );
}

const baselineCommand =
  "/opt/venv-a0/bin/python -m pip install --dry-run --no-cache-dir 'timm==1.0.9' 'faiss-cpu==1.8.0' 'numpy<2'";
const afterUninstallCommand = [
  "/opt/venv-a0/bin/python -m pip uninstall -y",
  'numpy scipy scikit-learn transformers accelerate sentence-transformers',
  'torchvision timm onnx onnxruntime ml_dtypes faiss-cpu >/dev/null 2>&1 || true;',
  baselineCommand,
].join(' ');
const afterPinnedTorchvisionRecoveryCommand = [
  "/opt/venv-a0/bin/python -m pip uninstall -y",
  'numpy scipy scikit-learn transformers accelerate sentence-transformers',
  'torchvision timm onnx onnxruntime ml_dtypes faiss-cpu >/dev/null 2>&1 || true;',
  "/opt/venv-a0/bin/python -m pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu",
  "'numpy==1.26.4' 'torchvision==0.19.0';",
  baselineCommand,
].join(' ');

const artifact = {
  generatedAt: new Date().toISOString(),
  image: IMAGE,
  baseline: null,
  afterDockerfileUninstall: null,
  afterPinnedTorchvisionRecovery: null,
  conclusions: [],
};

const [baselineRun, postUninstallRun, postRecoveryRun] = await Promise.all([
  pipDryRun(baselineCommand),
  pipDryRun(afterUninstallCommand),
  pipDryRun(afterPinnedTorchvisionRecoveryCommand),
]);

for (const [label, result] of [
  ['baseline', baselineRun],
  ['afterDockerfileUninstall', postUninstallRun],
  ['afterPinnedTorchvisionRecovery', postRecoveryRun],
]) {
  const packages = result.ok ? extractWouldInstall(result.stdout) : [];
  artifact[label] = {
    ok: result.ok,
    code: result.code,
    packages,
    summary: summarizePackages(packages),
    tail: result.ok ? result.stdout.split('\n').slice(-8) : [],
    stderr: result.stderr || null,
  };
}

artifact.conclusions.push(
  artifact.baseline?.summary?.hasTorchUpgrade
    ? 'Baseline dependency resolution already upgrades torch unexpectedly.'
    : 'Baseline dependency resolution does not upgrade torch unexpectedly.',
);
artifact.conclusions.push(
  artifact.afterDockerfileUninstall?.summary?.hasTorchUpgrade
    ? 'After the Dockerfile uninstall step, the same pip install would upgrade torch.'
    : 'After the Dockerfile uninstall step, the same pip install would not upgrade torch.',
);
artifact.conclusions.push(
  artifact.afterDockerfileUninstall?.summary?.cudaPackageCount > 0
    ? 'After the Dockerfile uninstall step, the pip plan pulls a large CUDA/triton stack.'
    : 'After the Dockerfile uninstall step, the pip plan does not pull CUDA/triton packages.',
);
artifact.conclusions.push(
  artifact.afterPinnedTorchvisionRecovery?.summary?.hasTorchUpgrade === false &&
    (artifact.afterPinnedTorchvisionRecovery?.summary?.cudaPackageCount ?? 0) === 0
    ? 'Reinstalling pinned torchvision after the uninstall step removes the torch/CUDA drift.'
    : 'Reinstalling pinned torchvision after the uninstall step does not fully remove the torch/CUDA drift.',
);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
