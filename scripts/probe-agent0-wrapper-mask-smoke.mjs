#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROJECT_ROOT = process.cwd();
const DEFAULT_DEPLOY_ROOT = path.join(process.env.HOME || '', '.external', 'agent0-railway-no-wrapped');
const DEPLOY_ROOT = process.env.AGENT0_RAILWAY_DEPLOY_ROOT || DEFAULT_DEPLOY_ROOT;
const OVERRIDE_FILE = path.join(DEPLOY_ROOT, 'overrides', 'settings_get.py');
const OUTPUT = process.env.AGENT0_WRAPPER_MASK_SMOKE_OUTPUT ||
  path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-wrapper-mask-smoke.json');

function printHelp() {
  console.log(`Usage:
  npm run probe:agent0:wrapper-mask-smoke

Optional env:
  AGENT0_RAILWAY_DEPLOY_ROOT      wrapper deploy checkout
  AGENT0_WRAPPER_MASK_SMOKE_OUTPUT
                                  output artifact path
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

const smokeScript = String.raw`
set -e
mkdir -p /a0
cp -rn --no-preserve=ownership,mode /git/agent-zero/. /a0/
mkdir -p /a0/api
cp /mnt/settings_get.py /a0/api/settings_get.py
/opt/venv-a0/bin/python - <<'INNER'
import sys, json, asyncio
sys.path.insert(0, '/a0')
import api.settings_get as sg
sg.settings.API_KEY_PLACEHOLDER = '************'
sg.settings.get_settings = lambda: {'mcp_server_token': 'raw-secret'}
sg.settings.convert_out = lambda backend: {'settings': {'mcp_server_token': 'raw-secret'}, 'additional': {}}
handler = sg.GetSettings(None, None)
out = asyncio.run(handler.process({}, None))
print(json.dumps(out))
INNER
`;

const artifact = {
  generatedAt: new Date().toISOString(),
  deployRoot: DEPLOY_ROOT,
  overrideFile: OVERRIDE_FILE,
  docker: null,
  smoke: null,
  conclusions: [],
};

try {
  await fs.access(OVERRIDE_FILE);
  const dockerVersion = await run('docker', ['image', 'inspect', 'agent0ai/agent-zero:latest']);
  artifact.docker = {
    imagePresent: dockerVersion.ok,
  };

  const smokeRun = await run(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${OVERRIDE_FILE}:/mnt/settings_get.py:ro`,
      'agent0ai/agent-zero:latest',
      'sh',
      '-lc',
      smokeScript,
    ],
    { cwd: PROJECT_ROOT },
  );

  if (!smokeRun.ok) {
    throw new Error(smokeRun.stderr || smokeRun.stdout || 'Wrapper smoke test failed');
  }

  const parsed = JSON.parse(smokeRun.stdout);
  artifact.smoke = {
    ok: true,
    masked: parsed?.settings?.mcp_server_token === '************',
    output: parsed,
  };
} catch (error) {
  artifact.error = error instanceof Error ? error.message : String(error);
}

artifact.conclusions.push(
  artifact.smoke?.ok && artifact.smoke?.masked
    ? 'Wrapper override masks mcp_server_token in a base-image smoke test.'
    : 'Wrapper override did not prove masking in the base-image smoke test.',
);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
