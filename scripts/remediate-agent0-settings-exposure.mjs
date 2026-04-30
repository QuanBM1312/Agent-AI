#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROJECT_ROOT = process.cwd();
const AGENT0_ROOT = process.env.AGENT0_SOURCE_ROOT || path.join(process.env.HOME || '', 'agent-zero');
const HOME_EXTERNAL_DEPLOY_ROOT = path.join(process.env.HOME || '', '.external', 'agent0-railway-no-wrapped');
const WORKTREE_EXTERNAL_DEPLOY_ROOT = path.join(PROJECT_ROOT, '.external', 'agent0-railway-no-wrapped');
const DEFAULT_DEPLOY_ROOT = HOME_EXTERNAL_DEPLOY_ROOT;
const DEPLOY_ROOT = process.env.AGENT0_RAILWAY_DEPLOY_ROOT || DEFAULT_DEPLOY_ROOT;
const OUTPUT = process.env.AGENT0_SETTINGS_REMEDIATION_RUN_OUTPUT ||
  path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-settings-remediation-run.json');
const waitSeconds = Number.parseInt(process.env.AGENT0_SETTINGS_REMEDIATION_WAIT_SECONDS || '180', 10);
const pollIntervalSeconds = Number.parseInt(
  process.env.AGENT0_SETTINGS_REMEDIATION_POLL_INTERVAL_SECONDS || '15',
  10,
);

function printHelp() {
  console.log(`Usage:
  npm run remediate:agent0:settings-exposure

Default mode is dry-run. Set AGENT0_SETTINGS_REMEDIATION_APPLY=1 to attempt deploy.

Optional env:
  AGENT0_SOURCE_ROOT                   local agent-zero checkout
  AGENT0_RAILWAY_DEPLOY_ROOT           Railway deploy checkout/workdir
                                       default: ${HOME_EXTERNAL_DEPLOY_ROOT}
  AGENT0_SETTINGS_REMEDIATION_APPLY    set to 1 to attempt Railway deploy
  AGENT0_RAILWAY_PROJECT_ID            Railway project id
  AGENT0_RAILWAY_ENVIRONMENT_ID        Railway environment id
  AGENT0_RAILWAY_SERVICE_ID            Railway service id/name
  AGENT0_SETTINGS_REMEDIATION_WAIT_SECONDS
                                       max time to wait for rollout after deploy
  AGENT0_SETTINGS_REMEDIATION_POLL_INTERVAL_SECONDS
                                       poll interval while rollout is pending
  AGENT0_SETTINGS_REMEDIATION_RUN_OUTPUT
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

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRailwayTargetUrl(targetUrl) {
  if (typeof targetUrl !== 'string' || targetUrl.length === 0) {
    return null;
  }

  try {
    const url = new URL(targetUrl);
    const match = url.pathname.match(/\/project\/([^/]+)\/service\/([^/]+)/);
    return {
      projectId: match?.[1] || null,
      serviceId: match?.[2] || null,
      environmentId: url.searchParams.get('environmentId') || null,
      deploymentId: url.searchParams.get('id') || null,
    };
  } catch {
    return null;
  }
}

const apply = process.env.AGENT0_SETTINGS_REMEDIATION_APPLY === '1';
let railwayProjectId = process.env.AGENT0_RAILWAY_PROJECT_ID || null;
let railwayEnvironmentId = process.env.AGENT0_RAILWAY_ENVIRONMENT_ID || null;
let railwayServiceId = process.env.AGENT0_RAILWAY_SERVICE_ID || null;

const artifact = {
  generatedAt: new Date().toISOString(),
  dryRun: !apply,
  agent0SourceRoot: AGENT0_ROOT,
  deployRoot: DEPLOY_ROOT,
  alternateDeployRoots: [
    HOME_EXTERNAL_DEPLOY_ROOT,
    WORKTREE_EXTERNAL_DEPLOY_ROOT,
  ],
  deployTarget: null,
  steps: {
    readinessVerify: null,
    serviceStatusBefore: null,
    deploy: null,
    serviceStatusAfter: null,
    exposureProbe: null,
    readinessRecheck: null,
    rolloutPoll: [],
  },
  conclusions: [],
};

artifact.steps.readinessVerify = await run(
  'npm',
  ['run', 'verify:agent0:settings-remediation'],
  { cwd: PROJECT_ROOT },
);

artifact.steps.serviceStatusBefore = await run(
  'railway',
  ['service', 'status', '--json'],
  { cwd: DEPLOY_ROOT },
);

let readiness = null;
try {
  readiness = await readJson(
    path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-settings-remediation-readiness.json'),
  );
} catch {
  readiness = null;
}

const inferredDeployTarget = parseRailwayTargetUrl(readiness?.diagnostics?.gitDeployStatus?.targetUrl || null);
railwayProjectId ||= inferredDeployTarget?.projectId || null;
railwayEnvironmentId ||= inferredDeployTarget?.environmentId || null;
railwayServiceId ||= inferredDeployTarget?.serviceId || null;
artifact.deployTarget = {
  projectId: railwayProjectId,
  environmentId: railwayEnvironmentId,
  serviceId: railwayServiceId,
  deploymentId: inferredDeployTarget?.deploymentId || null,
  source: inferredDeployTarget ? 'github-deploy-status' : 'env',
};

if (!apply) {
  artifact.conclusions.push('Dry-run mode only verified readiness and did not attempt deploy.');
} else if (!readiness?.readiness?.localReady) {
  artifact.conclusions.push('Local agent-zero patch is not ready; deploy was skipped.');
} else if (!readiness?.checks?.railwayAuthReady) {
  artifact.conclusions.push('Railway CLI auth is not ready in this shell; CLI deploy was skipped.');
} else if (!railwayProjectId || !railwayEnvironmentId || !railwayServiceId) {
  artifact.conclusions.push('Railway target identifiers are missing; deploy was skipped.');
} else {
  const deployArgs = ['up', '.', '--detach', '--message', 'Mask mcp_server_token in settings_get'];
  if (railwayProjectId) deployArgs.push('--project', railwayProjectId);
  if (railwayEnvironmentId) deployArgs.push('--environment', railwayEnvironmentId);
  if (railwayServiceId) deployArgs.push('--service', railwayServiceId);

  artifact.steps.deploy = await run(
    'railway',
    deployArgs,
    { cwd: DEPLOY_ROOT },
  );

  artifact.steps.serviceStatusAfter = await run(
    'railway',
    ['service', 'status', '--json'],
    { cwd: DEPLOY_ROOT },
  );

  artifact.steps.exposureProbe = await run(
    'npm',
    ['run', 'probe:agent0:settings-exposure'],
    { cwd: PROJECT_ROOT },
  );

  artifact.steps.readinessRecheck = await run(
    'npm',
    ['run', 'verify:agent0:settings-remediation'],
    { cwd: PROJECT_ROOT },
  );

  let latestReadiness = null;
  try {
    latestReadiness = await readJson(
      path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-settings-remediation-readiness.json'),
    );
  } catch {
    latestReadiness = null;
  }

  const maxPolls = Math.max(0, Math.floor(waitSeconds / Math.max(1, pollIntervalSeconds)));
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    if (latestReadiness?.readiness?.rolloutState !== 'pending') {
      break;
    }

    await sleep(pollIntervalSeconds * 1000);

    const verifyRun = await run(
      'npm',
      ['run', 'verify:agent0:settings-remediation'],
      { cwd: PROJECT_ROOT },
    );

    let polledReadiness = null;
    try {
      polledReadiness = await readJson(
        path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-settings-remediation-readiness.json'),
      );
    } catch {
      polledReadiness = null;
    }

    artifact.steps.rolloutPoll.push({
      attempt: attempt + 1,
      ok: verifyRun.ok,
      rolloutState: polledReadiness?.readiness?.rolloutState ?? null,
      fullyRemediated: polledReadiness?.readiness?.fullyRemediated ?? null,
      generatedAt: polledReadiness?.generatedAt ?? null,
    });

    latestReadiness = polledReadiness;
  }
}

artifact.conclusions.push(
  readiness?.readiness?.localReady
    ? 'Local patch and regression guard are ready.'
    : 'Local patch and regression guard are not fully ready.',
);
artifact.conclusions.push(
  readiness?.checks?.railwayAuthReady
    ? 'Railway auth was ready for CLI deploy at initial verification time.'
    : readiness?.checks?.gitDeployObserved === true
      ? 'Railway auth was not ready for CLI deploy, but Git push deployment signals were observed.'
      : 'No verified deploy control surface was ready at initial verification time.',
);
artifact.conclusions.push(
  readiness?.diagnostics?.gitDeployStatus?.state === 'failure'
    ? 'The latest wrapper HEAD deployment signal was failure before this run.'
    : readiness?.diagnostics?.gitDeployStatus?.state === 'success'
      ? 'The latest wrapper HEAD deployment signal was success before this run.'
      : readiness?.diagnostics?.gitDeployStatus?.state === 'pending'
        ? 'The latest wrapper HEAD deployment signal was pending before this run.'
        : 'No definitive wrapper HEAD deployment signal was available before this run.',
);
artifact.conclusions.push(
  readiness?.checks?.liveExposurePresent === false
    ? 'Live agent0 no longer appeared to expose the token at initial verification time.'
    : 'Live agent0 still appeared to expose the token at initial verification time.',
);

const finalPollState = artifact.steps.rolloutPoll.at(-1)?.rolloutState || null;
artifact.conclusions.push(
  finalPollState === 'effective'
    ? 'Rollout polling observed an effective live remediation state.'
    : finalPollState === 'ineffective'
      ? 'Rollout polling observed an ineffective live state: deploy completed but the live probe still saw a raw token.'
      : finalPollState === 'pending'
        ? 'Rollout polling timed out while Railway still appeared pending.'
        : 'No post-deploy rollout polling result was recorded.',
);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
