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
const SETTINGS_FILE = path.join(AGENT0_ROOT, 'python', 'helpers', 'settings.py');
const TEST_FILE = path.join(AGENT0_ROOT, 'tests', 'test_settings_mask_mcp_server_token.py');
const WRAPPER_DOCKERFILE = path.join(DEPLOY_ROOT, 'Dockerfile');
const WRAPPER_INIT_SCRIPT = path.join(DEPLOY_ROOT, 'initialize_with_persistence.sh');
const WRAPPER_OVERRIDE_FILE = path.join(DEPLOY_ROOT, 'overrides', 'settings_get.py');
const OUTPUT = process.env.AGENT0_SETTINGS_REMEDIATION_OUTPUT ||
  path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-settings-remediation-readiness.json');

function printHelp() {
  console.log(`Usage:
  npm run verify:agent0:settings-remediation

Optional env:
  AGENT0_SOURCE_ROOT                   local agent-zero checkout
  AGENT0_RAILWAY_DEPLOY_ROOT           Railway deploy checkout/workdir
                                       default: ${HOME_EXTERNAL_DEPLOY_ROOT}
  AGENT0_SETTINGS_REMEDIATION_OUTPUT   output artifact path
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
  agent0SourceRoot: AGENT0_ROOT,
  deployRoot: DEPLOY_ROOT,
  alternateDeployRoots: [
    HOME_EXTERNAL_DEPLOY_ROOT,
    WORKTREE_EXTERNAL_DEPLOY_ROOT,
  ],
  checks: {
    localPatchPresent: false,
    localRegressionTestPresent: false,
    localRegressionTestPass: false,
    wrapperPatchPresent: false,
    wrapperTorchvisionPinPresent: false,
    railwayAuthReady: false,
    railwayDeployRootPresent: false,
    railwayServiceLinked: null,
    railwayRolloutPending: null,
    gitRemoteReady: null,
    gitDeployObserved: null,
    repoDeployConfigPresent: null,
    liveExposureProbeDefinitive: null,
    liveExposurePresent: null,
  },
  diagnostics: {
    railwayWhoami: null,
    railwayServiceStatus: null,
    gitRemote: null,
    gitDeployStatus: null,
    wrapperDependencyDrift: null,
    rolloutFingerprint: null,
    liveExposure: null,
  },
  readiness: {
    localReady: false,
    deployLaneReady: false,
    rolloutState: 'unknown',
    fullyRemediated: false,
  },
  conclusions: [],
};

let previousArtifact = null;
try {
  previousArtifact = JSON.parse(await fs.readFile(OUTPUT, 'utf8'));
} catch {
  previousArtifact = null;
}

try {
  const settingsContent = await fs.readFile(SETTINGS_FILE, 'utf8');
  artifact.checks.localPatchPresent = settingsContent.includes(
    'API_KEY_PLACEHOLDER if out["settings"].get("mcp_server_token") else ""',
  );
} catch {
  artifact.checks.localPatchPresent = false;
}

try {
  const [dockerfile, initScript, overrideFile] = await Promise.all([
    fs.readFile(WRAPPER_DOCKERFILE, 'utf8'),
    fs.readFile(WRAPPER_INIT_SCRIPT, 'utf8'),
    fs.readFile(WRAPPER_OVERRIDE_FILE, 'utf8'),
  ]);
  artifact.checks.wrapperPatchPresent =
    dockerfile.includes('/git/agent-zero/api/settings_get.py') &&
    dockerfile.includes('/git/agent-zero/helpers/settings.py') &&
    initScript.includes('/git/agent-zero/api/settings_get.py') &&
    initScript.includes('/git/agent-zero/helpers/settings.py') &&
    overrideFile.includes('from helpers.api import ApiHandler');
  artifact.checks.wrapperTorchvisionPinPresent = dockerfile.includes('"torchvision==0.19.0"');
} catch {
  artifact.checks.wrapperPatchPresent = false;
  artifact.checks.wrapperTorchvisionPinPresent = false;
}

try {
  await fs.access(TEST_FILE);
  artifact.checks.localRegressionTestPresent = true;
} catch {
  artifact.checks.localRegressionTestPresent = false;
}

try {
  await fs.access(DEPLOY_ROOT);
  artifact.checks.railwayDeployRootPresent = true;
} catch {
  artifact.checks.railwayDeployRootPresent = false;
}

if (artifact.checks.localRegressionTestPresent) {
  const testRun = await run('python3', ['-m', 'pytest', TEST_FILE, '-q'], {
    cwd: PROJECT_ROOT,
  });
  artifact.checks.localRegressionTestPass = testRun.ok;
}

const railwayWhoami = await run('railway', ['whoami'], { cwd: AGENT0_ROOT });
artifact.checks.railwayAuthReady = railwayWhoami.ok;
artifact.diagnostics.railwayWhoami = {
  ok: railwayWhoami.ok,
  code: railwayWhoami.code,
  stderr: railwayWhoami.stderr || null,
  stdout: railwayWhoami.stdout || null,
};

if (artifact.checks.railwayAuthReady && artifact.checks.railwayDeployRootPresent) {
  const railwayServiceStatus = await run('railway', ['service', 'status', '--json'], { cwd: DEPLOY_ROOT });
  if (railwayServiceStatus.ok) {
    try {
      const parsed = JSON.parse(railwayServiceStatus.stdout || '{}');
      artifact.diagnostics.railwayServiceStatus = {
        id: parsed.id || null,
        name: parsed.name || null,
        deploymentId: parsed.deploymentId || null,
        status: parsed.status || null,
        stopped: parsed.stopped ?? null,
      };
      artifact.checks.railwayServiceLinked = Boolean(parsed.id && parsed.name);
      artifact.checks.railwayRolloutPending = parsed.status === 'BUILDING';
    } catch {
      artifact.diagnostics.railwayServiceStatus = {
        parseError: true,
        stdout: railwayServiceStatus.stdout || null,
      };
    }
  } else {
    artifact.diagnostics.railwayServiceStatus = {
      ok: false,
      code: railwayServiceStatus.code,
      stderr: railwayServiceStatus.stderr || null,
      stdout: railwayServiceStatus.stdout || null,
    };
  }
}

if (artifact.checks.railwayDeployRootPresent) {
  const gitRemoteCheck = await run('git', ['ls-remote', '--heads', 'origin', 'main'], { cwd: DEPLOY_ROOT });
  artifact.checks.gitRemoteReady = gitRemoteCheck.ok;
  artifact.diagnostics.gitRemote = {
    ok: gitRemoteCheck.ok,
    code: gitRemoteCheck.code,
    stdout: gitRemoteCheck.stdout || null,
    stderr: gitRemoteCheck.stderr || null,
  };

  const deployConfigCandidates = [
    '.github/workflows',
    'railway.json',
    'railway.toml',
    'nixpacks.toml',
    'Procfile',
  ];
  let deployConfigPresent = false;
  for (const candidate of deployConfigCandidates) {
    try {
      await fs.access(path.join(DEPLOY_ROOT, candidate));
      deployConfigPresent = true;
      break;
    } catch {
      // keep scanning
    }
  }
  artifact.checks.repoDeployConfigPresent = deployConfigPresent;
}

const gitDeployStatusProbe = await run('npm', ['run', 'probe:agent0:wrapper-deploy-status'], {
  cwd: PROJECT_ROOT,
});
if (gitDeployStatusProbe.ok) {
  try {
    const gitDeployArtifact = JSON.parse(
      await fs.readFile(
        path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-wrapper-github-deploy-status.json'),
        'utf8',
      ),
    );
    artifact.diagnostics.gitDeployStatus = {
      generatedAt: gitDeployArtifact.generatedAt || null,
      wrapperHeadCommitHash: gitDeployArtifact.wrapperHeadCommitHash || null,
      state: gitDeployArtifact.commitStatus?.state || null,
      totalCount: gitDeployArtifact.commitStatus?.totalCount ?? null,
      context: gitDeployArtifact.commitStatus?.context || null,
      description: gitDeployArtifact.commitStatus?.description || null,
      targetUrl: gitDeployArtifact.commitStatus?.targetUrl || null,
      updatedAt: gitDeployArtifact.commitStatus?.updatedAt || null,
      serviceId: gitDeployArtifact.commitStatus?.serviceId || null,
      projectId: gitDeployArtifact.commitStatus?.projectId || null,
      deploymentRuntimeId: gitDeployArtifact.commitStatus?.deploymentRuntimeId || null,
      environmentId: gitDeployArtifact.commitStatus?.environmentId || null,
      deploymentId: gitDeployArtifact.deployment?.id || null,
      deploymentState: gitDeployArtifact.deployment?.state || null,
      deploymentStatusCount: gitDeployArtifact.deployment?.statusCount ?? null,
      deploymentEnvironment: gitDeployArtifact.deployment?.environment || null,
      deploymentTargetUrl: gitDeployArtifact.deployment?.targetUrl || null,
      deploymentUpdatedAt: gitDeployArtifact.deployment?.updatedAt || null,
    };
    artifact.checks.gitDeployObserved =
      Boolean(gitDeployArtifact.deployment?.id) ||
      gitDeployArtifact.commitStatus?.state === 'pending' ||
      (Number.isInteger(gitDeployArtifact.commitStatus?.totalCount) &&
        gitDeployArtifact.commitStatus.totalCount > 0);
  } catch {
    artifact.diagnostics.gitDeployStatus = null;
  }
}

const wrapperDependencyDriftProbe = await run('npm', ['run', 'probe:agent0:wrapper-dependency-drift'], {
  cwd: PROJECT_ROOT,
});
if (wrapperDependencyDriftProbe.ok) {
  try {
    const driftArtifact = JSON.parse(
      await fs.readFile(
        path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-wrapper-dependency-drift.json'),
        'utf8',
      ),
    );
    artifact.diagnostics.wrapperDependencyDrift = {
      generatedAt: driftArtifact.generatedAt || null,
      baselinePackages: driftArtifact.baseline?.summary?.totalPackages ?? null,
      postUninstallPackages: driftArtifact.afterDockerfileUninstall?.summary?.totalPackages ?? null,
      hasTorchUpgrade: driftArtifact.afterDockerfileUninstall?.summary?.hasTorchUpgrade ?? null,
      hasTorchvisionUpgrade: driftArtifact.afterDockerfileUninstall?.summary?.hasTorchvisionUpgrade ?? null,
      cudaPackageCount: driftArtifact.afterDockerfileUninstall?.summary?.cudaPackageCount ?? null,
      recoveryPackages: driftArtifact.afterPinnedTorchvisionRecovery?.summary?.totalPackages ?? null,
      recoveryHasTorchUpgrade: driftArtifact.afterPinnedTorchvisionRecovery?.summary?.hasTorchUpgrade ?? null,
      recoveryCudaPackageCount: driftArtifact.afterPinnedTorchvisionRecovery?.summary?.cudaPackageCount ?? null,
    };
  } catch {
    artifact.diagnostics.wrapperDependencyDrift = null;
  }
}

const rolloutFingerprintProbe = await run('npm', ['run', 'probe:agent0:rollout-fingerprint'], {
  cwd: PROJECT_ROOT,
});
if (rolloutFingerprintProbe.ok) {
  try {
    const rolloutFingerprintArtifact = JSON.parse(
      await fs.readFile(
        path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-rollout-fingerprint.json'),
        'utf8',
      ),
    );
    artifact.diagnostics.rolloutFingerprint = {
      generatedAt: rolloutFingerprintArtifact.generatedAt || null,
      liveCommitHash: rolloutFingerprintArtifact.live?.gitCommitHash || null,
      baseImageCommitHash: rolloutFingerprintArtifact.baseImage?.gitCommitHash || null,
      wrapperHeadCommitHash: rolloutFingerprintArtifact.wrapperRepo?.headCommitHash || null,
      healthTracksInnerRepo: rolloutFingerprintArtifact.limitations?.healthTracksInnerRepo ?? null,
      liveMatchesBaseImage: rolloutFingerprintArtifact.comparisons?.liveMatchesBaseImage ?? null,
      liveMatchesWrapperHead: rolloutFingerprintArtifact.comparisons?.liveMatchesWrapperHead ?? null,
    };
  } catch {
    artifact.diagnostics.rolloutFingerprint = null;
  }
}

const exposureProbe = await run('npm', ['run', 'probe:agent0:settings-exposure'], {
  cwd: PROJECT_ROOT,
});

if (exposureProbe.ok) {
  try {
    const exposureArtifact = JSON.parse(
      await fs.readFile(
        path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'agent0-settings-exposure.json'),
        'utf8',
      ),
    );
    artifact.diagnostics.liveExposure = {
      generatedAt: exposureArtifact.generatedAt || null,
      healthGitBranch: exposureArtifact.health?.gitBranch || null,
      healthGitCommitHash: exposureArtifact.health?.gitCommitHash || null,
      healthGitShortTag: exposureArtifact.health?.gitShortTag || null,
      exploitChainUsable: exposureArtifact.exploitChainUsable ?? null,
      masked: exposureArtifact.exposure?.masked ?? null,
      present: exposureArtifact.exposure?.present ?? null,
      runtimeId: exposureArtifact.csrf?.runtimeId || null,
      csrfStatus: exposureArtifact.csrf?.status ?? null,
      settingsStatus: exposureArtifact.settings?.status ?? null,
    };
    artifact.checks.liveExposureProbeDefinitive =
      exposureArtifact.csrf?.status === 200 &&
      exposureArtifact.settings?.status === 200;
    artifact.checks.liveExposurePresent = artifact.checks.liveExposureProbeDefinitive
      ? exposureArtifact.exposure?.present === true && exposureArtifact.exposure?.masked === false
      : null;
  } catch {
    artifact.checks.liveExposurePresent = null;
  }
}

artifact.readiness.localReady =
  artifact.checks.localPatchPresent &&
  artifact.checks.localRegressionTestPresent &&
  artifact.checks.localRegressionTestPass &&
  artifact.checks.wrapperPatchPresent;
artifact.readiness.deployLaneReady =
  (artifact.checks.railwayAuthReady &&
    artifact.checks.railwayDeployRootPresent &&
    artifact.checks.railwayServiceLinked !== false) ||
  (artifact.checks.gitRemoteReady === true && artifact.checks.gitDeployObserved === true);

const deploymentState = artifact.diagnostics.gitDeployStatus?.deploymentState || null;
const generatedAtMs = Date.parse(artifact.generatedAt);
const commitUpdatedAtMs = artifact.diagnostics.gitDeployStatus?.updatedAt
  ? Date.parse(artifact.diagnostics.gitDeployStatus.updatedAt)
  : Number.NaN;
const deploymentUpdatedAtMs = artifact.diagnostics.gitDeployStatus?.deploymentUpdatedAt
  ? Date.parse(artifact.diagnostics.gitDeployStatus.deploymentUpdatedAt)
  : Number.NaN;
const freshestDeploySignalMs = Math.max(
  Number.isFinite(commitUpdatedAtMs) ? commitUpdatedAtMs : Number.NEGATIVE_INFINITY,
  Number.isFinite(deploymentUpdatedAtMs) ? deploymentUpdatedAtMs : Number.NEGATIVE_INFINITY,
);
const staleInProgress =
  (deploymentState === 'queued' || deploymentState === 'pending' || deploymentState === 'in_progress') &&
  Number.isFinite(generatedAtMs) &&
  Number.isFinite(freshestDeploySignalMs) &&
  generatedAtMs - freshestDeploySignalMs > 5 * 60 * 1000;

if (deploymentState === 'failure' || deploymentState === 'error' || artifact.diagnostics.gitDeployStatus?.state === 'failure') {
  artifact.readiness.rolloutState = 'failed';
} else if (staleInProgress) {
  artifact.readiness.rolloutState = 'stalled';
} else if (
  artifact.checks.railwayRolloutPending === true ||
  deploymentState === 'queued' ||
  deploymentState === 'pending' ||
  deploymentState === 'in_progress' ||
  artifact.diagnostics.gitDeployStatus?.state === 'pending'
) {
  artifact.readiness.rolloutState = 'pending';
} else if (artifact.checks.liveExposureProbeDefinitive === true) {
  const previousRuntimeId = previousArtifact?.diagnostics?.liveExposure?.runtimeId || null;
  const currentRuntimeId = artifact.diagnostics.liveExposure?.runtimeId || null;
  const runtimeChanged =
    Boolean(previousRuntimeId) &&
    Boolean(currentRuntimeId) &&
    previousRuntimeId !== currentRuntimeId;

  artifact.readiness.rolloutState =
    artifact.checks.liveExposurePresent === false
      ? 'effective'
      : runtimeChanged || artifact.checks.railwayRolloutPending === false
        ? 'ineffective'
        : 'unknown';
}

artifact.readiness.fullyRemediated =
  artifact.readiness.localReady &&
  artifact.readiness.deployLaneReady &&
  artifact.readiness.rolloutState === 'effective';

artifact.conclusions.push(
  artifact.readiness.localReady
    ? 'Local agent-zero source and wrapper deploy repo both contain the masking fix.'
    : 'Local agent-zero source or wrapper deploy repo is not yet fully ready for a safe redeploy.',
);
artifact.conclusions.push(
  artifact.checks.railwayAuthReady
    ? 'Railway auth is ready in this shell.'
    : artifact.checks.gitDeployObserved === true
      ? 'Railway auth is not ready in this shell, but Git push still reaches the live deploy integration.'
      : 'Railway auth is not ready and no alternate live deploy signal has been confirmed yet.',
);
artifact.conclusions.push(
  artifact.checks.gitRemoteReady
    ? 'The wrapper repo can still reach origin/main.'
    : artifact.checks.gitRemoteReady === false
      ? 'The wrapper repo cannot currently reach origin/main.'
      : 'The wrapper repo remote was not checked.',
);
artifact.conclusions.push(
  artifact.checks.repoDeployConfigPresent
    ? 'The wrapper repo contains repo-local deploy automation/config files.'
    : artifact.checks.repoDeployConfigPresent === false
      ? 'The wrapper repo does not contain repo-local deploy automation/config files.'
      : 'The wrapper repo deploy-config footprint was not checked.',
);
artifact.conclusions.push(
  artifact.checks.gitDeployObserved === true
    ? deploymentState === 'failure' || deploymentState === 'error' || artifact.diagnostics.gitDeployStatus?.state === 'failure'
      ? 'Git push is a live deploy lane, but the latest wrapper HEAD deployment failed before promotion.'
      : staleInProgress
        ? 'Git push is a live deploy lane, but the latest wrapper HEAD deployment has been stuck in progress without a fresher status update.'
      : deploymentState === 'success' || deploymentState === 'active' || artifact.diagnostics.gitDeployStatus?.state === 'success'
        ? 'Git push is a live deploy lane and the latest wrapper HEAD has a successful deployment status.'
        : deploymentState === 'queued' || deploymentState === 'pending' || deploymentState === 'in_progress'
          ? 'Git push is a live deploy lane and the latest wrapper HEAD deployment is in progress.'
        : artifact.diagnostics.gitDeployStatus?.state === 'pending' &&
            (artifact.diagnostics.gitDeployStatus?.totalCount ?? 0) > 0
          ? 'Git push is a live deploy lane and the latest wrapper HEAD deployment is still pending.'
          : artifact.diagnostics.gitDeployStatus?.state === 'pending'
            ? 'Git push is a live deploy lane and the latest wrapper HEAD is in a combined pending state, but Railway has not published a concrete status context yet.'
          : 'Git push is a live deploy lane, but the latest wrapper HEAD deployment state is not definitive.'
    : 'A live Git-based deploy signal has not been observed for the current wrapper HEAD.',
);
artifact.conclusions.push(
  artifact.checks.wrapperTorchvisionPinPresent === true &&
    artifact.diagnostics.wrapperDependencyDrift?.recoveryHasTorchUpgrade === false &&
    (artifact.diagnostics.wrapperDependencyDrift?.recoveryCudaPackageCount ?? 0) === 0
    ? 'The current wrapper source includes a pinned torchvision recovery that removes the torch/CUDA drift in simulation.'
    : artifact.diagnostics.wrapperDependencyDrift?.hasTorchUpgrade === true &&
        (artifact.diagnostics.wrapperDependencyDrift?.cudaPackageCount ?? 0) > 0
      ? 'The current wrapper Dockerfile likely triggers a large torch/CUDA dependency drift after its uninstall step, which is a plausible Railway build-failure lane.'
      : 'The current wrapper dependency plan did not show a large torch/CUDA drift.',
);
artifact.conclusions.push(
  artifact.diagnostics.rolloutFingerprint?.healthTracksInnerRepo === true
    ? 'Live /api/health fingerprints the inner agent-zero repo, so it cannot disprove wrapper rollout on its own.'
    : artifact.diagnostics.rolloutFingerprint?.liveMatchesBaseImage === true &&
        artifact.diagnostics.rolloutFingerprint?.liveMatchesWrapperHead === false
      ? 'Live /api/health currently matches the stock base-image commit and not the wrapper repo HEAD.'
      : 'Rollout fingerprinting did not produce a stronger live-vs-wrapper conclusion.',
);
artifact.conclusions.push(
  artifact.checks.railwayRolloutPending === true
    ? 'A Railway rollout is currently in progress; live exposure may persist until deployment promotion completes.'
    : artifact.checks.railwayRolloutPending === false
      ? 'No Railway rollout is currently pending on the linked deploy surface.'
      : 'Railway rollout status is unknown because live service status could not be read.',
);
artifact.conclusions.push(
  artifact.readiness.rolloutState === 'effective'
    ? 'The latest observed rollout state is effective: the live probe is definitive and no raw token is exposed.'
    : artifact.readiness.rolloutState === 'failed'
      ? 'The latest observed rollout state is failed: the latest wrapper HEAD deployment reported failure before remediation could reach live runtime.'
      : artifact.readiness.rolloutState === 'stalled'
        ? 'The latest observed rollout state is stalled: the last known deployment is still in progress, but its status is stale and live runtime evidence has not moved.'
      : artifact.readiness.rolloutState === 'ineffective'
        ? 'The latest observed rollout state is ineffective: the runtime changed or the deploy surface stopped building, but the live probe still sees a raw token.'
      : artifact.readiness.rolloutState === 'pending'
        ? 'The latest observed rollout state is pending: Railway still reports a build in progress.'
        : 'The latest observed rollout state is unknown: there is not enough definitive live evidence yet.',
);
artifact.conclusions.push(
  artifact.checks.liveExposureProbeDefinitive === true
    ? 'The latest live exposure probe was definitive (200/200 exploit-chain response).'
    : 'The latest live exposure probe was not definitive; non-200 responses do not count as remediation proof.',
);
artifact.conclusions.push(
  artifact.checks.liveExposurePresent === false
    ? 'Live agent0 no longer appears to expose mcp_server_token.'
    : 'Live agent0 still appears to expose mcp_server_token.',
);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
