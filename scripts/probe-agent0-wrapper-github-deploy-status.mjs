#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROJECT_ROOT = process.cwd();
const DEFAULT_DEPLOY_ROOT = path.join(process.env.HOME || '', '.external', 'agent0-railway-no-wrapped');
const DEPLOY_ROOT = process.env.AGENT0_RAILWAY_DEPLOY_ROOT || DEFAULT_DEPLOY_ROOT;
const OUTPUT = process.env.AGENT0_WRAPPER_DEPLOY_STATUS_OUTPUT ||
  path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-wrapper-github-deploy-status.json');
const BACKUP_OUTPUT = process.env.AGENT0_WRAPPER_DEPLOY_STATUS_BACKUP_OUTPUT ||
  path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-wrapper-github-deploy-status.backup.json');

function printHelp() {
  console.log(`Usage:
  npm run probe:agent0:wrapper-deploy-status

Optional env:
  AGENT0_RAILWAY_DEPLOY_ROOT           wrapper deploy checkout
  AGENT0_WRAPPER_DEPLOY_STATUS_OUTPUT  output artifact path
  AGENT0_WRAPPER_DEPLOY_STATUS_BACKUP_OUTPUT  backup artifact path
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

function parseGitHubRepo(remoteUrl) {
  if (!remoteUrl) {
    return null;
  }

  const match = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/i);
  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

function parseRailwayStatusTarget(url) {
  if (!url) {
    return {
      projectId: null,
      serviceId: null,
      deploymentRuntimeId: null,
      environmentId: null,
    };
  }

  const match = url.match(/project\/([^/]+)\/service\/([^/?]+).*?[?&]id=([^&]+).*?[?&]environmentId=([^&]+)/);
  if (!match) {
    return {
      projectId: null,
      serviceId: null,
      deploymentRuntimeId: null,
      environmentId: null,
    };
  }

  return {
    projectId: match[1] || null,
    serviceId: match[2] || null,
    deploymentRuntimeId: match[3] || null,
    environmentId: match[4] || null,
  };
}

const artifact = {
  generatedAt: new Date().toISOString(),
  deployRoot: DEPLOY_ROOT,
  wrapperHeadCommitHash: null,
  repo: null,
  commitStatus: null,
  deployment: null,
  fetchMeta: null,
  conclusions: [],
};

let previousArtifact = null;
try {
  previousArtifact = JSON.parse(await fs.readFile(OUTPUT, 'utf8'));
} catch {
  previousArtifact = null;
}

let backupArtifact = null;
try {
  backupArtifact = JSON.parse(await fs.readFile(BACKUP_OUTPUT, 'utf8'));
} catch {
  backupArtifact = null;
}

let readinessArtifact = null;
try {
  readinessArtifact = JSON.parse(
    await fs.readFile(
      path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-settings-remediation-readiness.json'),
      'utf8',
    ),
  );
} catch {
  readinessArtifact = null;
}

try {
  const [remoteRun, headRun] = await Promise.all([
    run('git', ['-C', DEPLOY_ROOT, 'remote', 'get-url', 'origin'], { cwd: PROJECT_ROOT }),
    run('git', ['-C', DEPLOY_ROOT, 'rev-parse', 'HEAD'], { cwd: PROJECT_ROOT }),
  ]);

  if (!remoteRun.ok) {
    throw new Error(remoteRun.stderr || remoteRun.stdout || 'Failed to read wrapper repo origin URL');
  }
  if (!headRun.ok) {
    throw new Error(headRun.stderr || headRun.stdout || 'Failed to read wrapper repo HEAD');
  }

  artifact.wrapperHeadCommitHash = headRun.stdout || null;
  artifact.repo = {
    remoteUrl: remoteRun.stdout || null,
    ...parseGitHubRepo(remoteRun.stdout),
  };

  if (!artifact.repo?.owner || !artifact.repo?.repo || !artifact.wrapperHeadCommitHash) {
    throw new Error('Wrapper repo origin is not a parseable GitHub remote');
  }

  const ghAuth = await run('gh', ['auth', 'status'], { cwd: PROJECT_ROOT });
  const useGh = ghAuth.ok;
  artifact.fetchMeta = {
    ghAuthOk: useGh,
  };

  if (useGh) {
    const [statusRun, deploymentsRun] = await Promise.all([
      run(
        'gh',
        ['api', `repos/${artifact.repo.owner}/${artifact.repo.repo}/commits/${artifact.wrapperHeadCommitHash}/status`],
        { cwd: PROJECT_ROOT },
      ),
      run(
        'gh',
        ['api', `repos/${artifact.repo.owner}/${artifact.repo.repo}/deployments?sha=${artifact.wrapperHeadCommitHash}`],
        { cwd: PROJECT_ROOT },
      ),
    ]);

    artifact.fetchMeta = {
      ...artifact.fetchMeta,
      source: 'gh',
      statusApiOk: statusRun.ok,
      deploymentsApiOk: deploymentsRun.ok,
      statusApiError: statusRun.ok ? null : (statusRun.stderr || statusRun.stdout || null),
      deploymentsApiError: deploymentsRun.ok ? null : (deploymentsRun.stderr || deploymentsRun.stdout || null),
    };

    if (statusRun.ok) {
      const payload = JSON.parse(statusRun.stdout || '{}');
      const latestStatus = Array.isArray(payload.statuses) && payload.statuses.length > 0
        ? payload.statuses[0]
        : null;
      artifact.commitStatus = {
        httpStatus: 200,
        ok: true,
        source: 'gh',
        stale: false,
        state: payload.state || null,
        totalCount: payload.total_count ?? null,
        context: latestStatus?.context || null,
        description: latestStatus?.description || null,
        targetUrl: latestStatus?.target_url || null,
        createdAt: latestStatus?.created_at || null,
        updatedAt: latestStatus?.updated_at || null,
        ...parseRailwayStatusTarget(latestStatus?.target_url || null),
      };
    }

    if (deploymentsRun.ok) {
      const deploymentsPayload = JSON.parse(deploymentsRun.stdout || '[]');
      const latestDeployment = Array.isArray(deploymentsPayload) && deploymentsPayload.length > 0
        ? deploymentsPayload[0]
        : null;

      if (latestDeployment?.statuses_url) {
        const deploymentStatusesRun = await run('gh', ['api', latestDeployment.statuses_url.replace('https://api.github.com/', '')], {
          cwd: PROJECT_ROOT,
        });
        artifact.fetchMeta = {
          ...artifact.fetchMeta,
          deploymentStatusesOk: deploymentStatusesRun.ok,
          deploymentStatusesError: deploymentStatusesRun.ok ? null : (deploymentStatusesRun.stderr || deploymentStatusesRun.stdout || null),
        };
        if (deploymentStatusesRun.ok) {
          const deploymentStatusesPayload = JSON.parse(deploymentStatusesRun.stdout || '[]');
          const latestDeploymentStatus =
            Array.isArray(deploymentStatusesPayload) && deploymentStatusesPayload.length > 0
              ? deploymentStatusesPayload[0]
              : null;
          artifact.deployment = {
            httpStatus: 200,
            ok: true,
            source: 'gh',
            stale: false,
            id: latestDeployment.id || null,
            environment: latestDeployment.environment || null,
            originalEnvironment: latestDeployment.original_environment || null,
            productionEnvironment: latestDeployment.production_environment ?? null,
            transientEnvironment: latestDeployment.transient_environment ?? null,
            payloadEnvironmentId: latestDeployment.payload?.environmentId || null,
            state: latestDeploymentStatus?.state || null,
            description: latestDeploymentStatus?.description || null,
            targetUrl: latestDeploymentStatus?.target_url || null,
            createdAt: latestDeploymentStatus?.created_at || latestDeployment.created_at || null,
            updatedAt: latestDeploymentStatus?.updated_at || latestDeployment.updated_at || null,
            statusCount: Array.isArray(deploymentStatusesPayload) ? deploymentStatusesPayload.length : 0,
          };
        }
      }
    }
  }

  if (!useGh || (!artifact.commitStatus && !artifact.deployment)) {

    const headers = {
      accept: 'application/vnd.github+json',
      'user-agent': 'agent-ai-wrapper-deploy-status-probe/1.0',
    };

    const response = await fetch(
      `https://api.github.com/repos/${artifact.repo.owner}/${artifact.repo.repo}/commits/${artifact.wrapperHeadCommitHash}/status`,
      { headers },
    );
    const payload = await response.json();
    artifact.fetchMeta = {
      ...artifact.fetchMeta,
      source: artifact.fetchMeta?.source || 'public-api',
      statusApiHttpStatus: response.status,
      statusApiOk: response.ok,
      rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
      rateLimitReset: response.headers.get('x-ratelimit-reset'),
      message: payload?.message || null,
    };

    if (response.ok && !artifact.commitStatus) {
      const latestStatus = Array.isArray(payload.statuses) && payload.statuses.length > 0
        ? payload.statuses[0]
        : null;

      artifact.commitStatus = {
        httpStatus: response.status,
        ok: response.ok,
        source: 'public-api',
        stale: false,
        state: payload.state || null,
        totalCount: payload.total_count ?? null,
        context: latestStatus?.context || null,
        description: latestStatus?.description || null,
        targetUrl: latestStatus?.target_url || null,
        createdAt: latestStatus?.created_at || null,
        updatedAt: latestStatus?.updated_at || null,
        ...parseRailwayStatusTarget(latestStatus?.target_url || null),
      };
    }

    const deploymentsResponse = await fetch(
      `https://api.github.com/repos/${artifact.repo.owner}/${artifact.repo.repo}/deployments?sha=${artifact.wrapperHeadCommitHash}`,
      { headers },
    );
    const deploymentsPayload = await deploymentsResponse.json();
    artifact.fetchMeta = {
      ...artifact.fetchMeta,
      deploymentsApiHttpStatus: deploymentsResponse.status,
      deploymentsApiOk: deploymentsResponse.ok,
      deploymentsRateLimitRemaining: deploymentsResponse.headers.get('x-ratelimit-remaining'),
      deploymentsRateLimitReset: deploymentsResponse.headers.get('x-ratelimit-reset'),
      deploymentsMessage: deploymentsPayload?.message || null,
    };
    const latestDeployment = Array.isArray(deploymentsPayload) && deploymentsPayload.length > 0
      ? deploymentsPayload[0]
      : null;

    if (deploymentsResponse.ok && latestDeployment?.statuses_url && !artifact.deployment) {
      const deploymentStatusesResponse = await fetch(latestDeployment.statuses_url, { headers });
      const deploymentStatusesPayload = await deploymentStatusesResponse.json();
      const latestDeploymentStatus =
        Array.isArray(deploymentStatusesPayload) && deploymentStatusesPayload.length > 0
          ? deploymentStatusesPayload[0]
          : null;

      artifact.fetchMeta = {
        ...artifact.fetchMeta,
        deploymentStatusesHttpStatus: deploymentStatusesResponse.status,
        deploymentStatusesOk: deploymentStatusesResponse.ok,
        deploymentStatusesRateLimitRemaining: deploymentStatusesResponse.headers.get('x-ratelimit-remaining'),
        deploymentStatusesRateLimitReset: deploymentStatusesResponse.headers.get('x-ratelimit-reset'),
        deploymentStatusesMessage: deploymentStatusesPayload?.message || null,
      };

      artifact.deployment = {
        httpStatus: deploymentStatusesResponse.status,
        ok: deploymentStatusesResponse.ok,
        source: 'public-api',
        stale: false,
        id: latestDeployment.id || null,
        environment: latestDeployment.environment || null,
        originalEnvironment: latestDeployment.original_environment || null,
        productionEnvironment: latestDeployment.production_environment ?? null,
        transientEnvironment: latestDeployment.transient_environment ?? null,
        payloadEnvironmentId: latestDeployment.payload?.environmentId || null,
        state: latestDeploymentStatus?.state || null,
        description: latestDeploymentStatus?.description || null,
        targetUrl: latestDeploymentStatus?.target_url || null,
        createdAt: latestDeploymentStatus?.created_at || latestDeployment.created_at || null,
        updatedAt: latestDeploymentStatus?.updated_at || latestDeployment.updated_at || null,
        statusCount: Array.isArray(deploymentStatusesPayload) ? deploymentStatusesPayload.length : 0,
      };
    }
  }
} catch (error) {
  artifact.error = error instanceof Error ? error.message : String(error);
}

const canReusePrevious =
  previousArtifact?.wrapperHeadCommitHash &&
  previousArtifact.wrapperHeadCommitHash === artifact.wrapperHeadCommitHash;
const canReuseBackup =
  backupArtifact?.wrapperHeadCommitHash &&
  backupArtifact.wrapperHeadCommitHash === artifact.wrapperHeadCommitHash;

if (!artifact.commitStatus && canReusePrevious && previousArtifact?.commitStatus) {
  artifact.commitStatus = {
    ...previousArtifact.commitStatus,
    source: 'previous-artifact',
    stale: true,
  };
}

if (!artifact.commitStatus && canReuseBackup && backupArtifact?.commitStatus) {
  artifact.commitStatus = {
    ...backupArtifact.commitStatus,
    source: 'backup-artifact',
    stale: true,
  };
}

if (!artifact.deployment && canReusePrevious && previousArtifact?.deployment) {
  artifact.deployment = {
    ...previousArtifact.deployment,
    source: 'previous-artifact',
    stale: true,
  };
}

if (!artifact.deployment && canReuseBackup && backupArtifact?.deployment) {
  artifact.deployment = {
    ...backupArtifact.deployment,
    source: 'backup-artifact',
    stale: true,
  };
}

const readinessDeployStatus = readinessArtifact?.diagnostics?.gitDeployStatus;
const canReuseReadiness =
  readinessDeployStatus?.wrapperHeadCommitHash &&
  readinessDeployStatus.wrapperHeadCommitHash === artifact.wrapperHeadCommitHash;

if (!artifact.deployment && canReuseReadiness && readinessDeployStatus?.deploymentId) {
  artifact.deployment = {
    httpStatus: null,
    ok: null,
    source: 'readiness-artifact',
    stale: true,
    id: readinessDeployStatus.deploymentId || null,
    environment: readinessDeployStatus.deploymentEnvironment || null,
    originalEnvironment: readinessDeployStatus.deploymentEnvironment || null,
    productionEnvironment: null,
    transientEnvironment: null,
    payloadEnvironmentId: null,
    state: readinessDeployStatus.deploymentState || null,
    description: null,
    targetUrl: readinessDeployStatus.deploymentTargetUrl || null,
    createdAt: null,
    updatedAt: readinessDeployStatus.deploymentUpdatedAt || null,
    statusCount: readinessDeployStatus.deploymentStatusCount ?? null,
  };
}

if (!artifact.commitStatus && canReuseReadiness && readinessDeployStatus?.state) {
  artifact.commitStatus = {
    httpStatus: null,
    ok: null,
    source: 'readiness-artifact',
    stale: true,
    state: readinessDeployStatus.state || null,
    totalCount: readinessDeployStatus.totalCount ?? null,
    context: readinessDeployStatus.context || null,
    description: readinessDeployStatus.description || null,
    targetUrl: readinessDeployStatus.targetUrl || null,
    createdAt: null,
    updatedAt: readinessDeployStatus.updatedAt || null,
  };
}

artifact.conclusions.push(
  artifact.fetchMeta?.statusApiHttpStatus === 403 || artifact.fetchMeta?.deploymentsApiHttpStatus === 403
    ? 'GitHub public API rate limiting interrupted live deploy-status refresh; using last known state where available.'
    : 'GitHub deploy-status APIs responded without rate-limit interruption during this probe.',
);
artifact.conclusions.push(
  artifact.deployment?.statusCount && artifact.deployment.statusCount > 0
    ? 'GitHub Deployments reports at least one deployment status for the current wrapper HEAD.'
    : artifact.deployment?.id
      ? 'GitHub Deployments found a deployment record for the current wrapper HEAD, but no deployment status rows yet.'
      : 'GitHub Deployments did not return a deployment record for the current wrapper HEAD.',
);
artifact.conclusions.push(
  artifact.deployment?.state === 'success'
    ? 'The latest deployment record for the current wrapper HEAD is successful.'
    : artifact.deployment?.state === 'failure' || artifact.deployment?.state === 'error'
      ? 'The latest deployment record for the current wrapper HEAD is failing.'
      : artifact.deployment?.state === 'in_progress' || artifact.deployment?.state === 'queued' || artifact.deployment?.state === 'pending'
        ? 'The latest deployment record for the current wrapper HEAD is still in progress.'
        : artifact.deployment?.id
          ? 'The latest deployment record for the current wrapper HEAD is present but not yet definitive.'
          : 'There is no deployment-record proof yet for the current wrapper HEAD.',
);
artifact.conclusions.push(
  artifact.commitStatus?.totalCount && artifact.commitStatus.totalCount > 0
    ? 'GitHub reports at least one commit status for the current wrapper HEAD.'
    : artifact.commitStatus?.state === 'pending'
      ? 'GitHub reports a combined pending state for the current wrapper HEAD, but no concrete status context yet.'
    : 'GitHub does not report any commit status for the current wrapper HEAD.',
);
artifact.conclusions.push(
  artifact.commitStatus?.state === 'success'
    ? 'The current wrapper HEAD has a successful deployment/check status.'
    : artifact.commitStatus?.state === 'failure'
      ? 'The current wrapper HEAD has a failing deployment/check status.'
      : artifact.commitStatus?.state === 'pending' && (artifact.commitStatus?.totalCount ?? 0) > 0
        ? 'The current wrapper HEAD has a pending deployment/check status.'
        : artifact.commitStatus?.state === 'pending'
          ? 'The current wrapper HEAD has a pending combined state, but no concrete deployment/check status yet.'
        : 'The current wrapper HEAD does not have a definitive success/failure deployment status.',
);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
if (
  artifact.wrapperHeadCommitHash &&
  ((artifact.commitStatus && artifact.commitStatus.source === 'live') ||
    (artifact.deployment && artifact.deployment.source === 'live'))
) {
  await fs.mkdir(path.dirname(BACKUP_OUTPUT), { recursive: true });
  await fs.writeFile(BACKUP_OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(artifact, null, 2));
