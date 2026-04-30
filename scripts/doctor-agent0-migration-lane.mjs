#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { AGENT0_API_KEY_ENV_NAMES, resolveAgent0ApiKey } from './lib/agent0-api-key-env.mjs';
import { discoverSearchAgent0WorkflowId } from './lib/agent0-workflow-id-discovery.mjs';

const requiredFiles = [
  'scripts/probe-agent0-api-key-route.mjs',
  'scripts/render-agent0-api-key-probe-report.mjs',
  'scripts/run-agent0-api-key-probe-pipeline.mjs',
  'scripts/render-agent0-n8n-patch-template.mjs',
  'scripts/prepare-agent0-n8n-migration.mjs',
  'docs/agent0-operator-quickstart.md',
  'docs/agent0-api-key-migration-playbook.md',
  'docs/agent0-n8n-api-key-patch-spec.md',
  'docs/n8n-mcp-patch-recipes.md',
  'docs/artifacts/n8n/search-agent0-api-key-validate-only.json',
  'docs/artifacts/n8n/search-agent0-api-key-cleanup.json',
];

const artifactFiles = [
  'docs/artifacts/agent0-api-key-probe/latest.json',
  'docs/artifacts/agent0-api-key-probe/latest.md',
  'docs/artifacts/n8n/search-agent0-api-key-validate-only.rendered.json',
  'docs/artifacts/n8n/search-agent0-api-key-cleanup.rendered.json',
];

function printHelp() {
  console.log(`
Usage:
  npm run doctor:agent0:migration

Checks:
  - required repo scripts and docs exist
  - whether AGENT0_API_KEY or AGENT0_MCP_SERVER_TOKEN is present
  - whether AGENT0_N8N_WORKFLOW_ID is present or can be discovered from artifacts
  - whether prior probe/rendered artifacts already exist
  - whether the latest API-key probe artifact succeeded or failed
  - whether the latest probe artifact matches the current API-key env source
`.trim());
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readLatestProbeArtifact() {
  const filePath = 'docs/artifacts/agent0-api-key-probe/latest.json';
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const profileResults = parsed?.profileResults || null;
    const allProfilesSuccessful =
      typeof parsed?.allProfilesSuccessful === 'boolean'
        ? parsed.allProfilesSuccessful
        : Boolean(parsed?.success);
    const probeProfiles = Array.isArray(parsed?.probeProfiles) ? parsed.probeProfiles : [];
    const nonBasicProfiles = probeProfiles.filter((profileName) => profileName !== 'basic');
    const failingProfiles = nonBasicProfiles.filter(
      (profileName) => !profileResults?.[profileName]?.ok,
    );
    return {
      exists: true,
      success: allProfilesSuccessful,
      routePath: parsed?.success?.routePath || null,
      authTransport: parsed?.success?.authTransport || null,
      attemptCount: Array.isArray(parsed?.attempts) ? parsed.attempts.length : 0,
      apiKeyEnvName: parsed?.apiKeyEnvName || null,
      probeProfiles,
      profileResults,
      requiredProfilesReady:
        nonBasicProfiles.length === 0
          ? Boolean(parsed?.success)
          : failingProfiles.length === 0,
      failingProfiles,
    };
  } catch {
    return {
      exists: false,
      success: false,
      routePath: null,
      authTransport: null,
      attemptCount: 0,
      apiKeyEnvName: null,
      probeProfiles: [],
      profileResults: null,
      requiredProfilesReady: false,
      failingProfiles: [],
    };
  }
}

const checks = [];
const discoveredWorkflowId = await discoverSearchAgent0WorkflowId();
const latestProbe = await readLatestProbeArtifact();

for (const filePath of requiredFiles) {
  checks.push({
    kind: 'required_file',
    path: filePath,
    ok: await exists(filePath),
  });
}

for (const filePath of artifactFiles) {
  checks.push({
    kind: 'artifact',
    path: filePath,
    ok: await exists(filePath),
  });
}

for (const envName of AGENT0_API_KEY_ENV_NAMES) {
  checks.push({
    kind: 'env',
    name: envName,
    ok: Boolean(process.env[envName]),
  });
}

checks.push({
  kind: 'env',
  name: 'AGENT0_N8N_WORKFLOW_ID',
  ok: Boolean(process.env.AGENT0_N8N_WORKFLOW_ID),
});

const missingRequired = checks.filter((item) => item.kind === 'required_file' && !item.ok);
const envReady = checks.filter((item) => item.kind === 'env' && item.ok).length;
const resolvedApiKey = resolveAgent0ApiKey(process.env);
const hasApiKey = Boolean(resolvedApiKey.value);
const hasExplicitWorkflowId = checks.some(
  (item) => item.kind === 'env' && item.name === 'AGENT0_N8N_WORKFLOW_ID' && item.ok,
);
const hasWorkflowId = hasExplicitWorkflowId || Boolean(discoveredWorkflowId);
const hasProbeArtifact = checks.some(
  (item) => item.kind === 'artifact' && item.path === 'docs/artifacts/agent0-api-key-probe/latest.json' && item.ok,
);
const probeMatchesCurrentApiKeyEnv =
  !latestProbe.exists ||
  !latestProbe.apiKeyEnvName ||
  !resolvedApiKey.envName ||
  latestProbe.apiKeyEnvName === resolvedApiKey.envName;

let nextStep = 'Fix missing required repo files before using this lane.';
if (missingRequired.length === 0 && !hasApiKey && !hasExplicitWorkflowId && discoveredWorkflowId) {
  nextStep = `Export AGENT0_API_KEY or AGENT0_MCP_SERVER_TOKEN, and optionally AGENT0_N8N_WORKFLOW_ID=${discoveredWorkflowId} if you want to pin the discovered candidate explicitly.`;
} else if (missingRequired.length === 0 && !hasApiKey && !hasWorkflowId) {
  nextStep = 'Export AGENT0_API_KEY or AGENT0_MCP_SERVER_TOKEN and AGENT0_N8N_WORKFLOW_ID, then rerun doctor or start the operator quickstart.';
} else if (missingRequired.length === 0 && hasApiKey && hasWorkflowId && hasProbeArtifact && !probeMatchesCurrentApiKeyEnv) {
  nextStep = `Latest API-key probe artifact was generated with ${latestProbe.apiKeyEnvName}, but the current session resolves to ${resolvedApiKey.envName}. Rerun npm run prepare:agent0:n8n-migration before applying any patch.`;
} else if (
  missingRequired.length === 0 &&
  hasApiKey &&
  hasWorkflowId &&
  hasProbeArtifact &&
  probeMatchesCurrentApiKeyEnv &&
  !latestProbe.requiredProfilesReady
) {
  const failingProfilesText =
    latestProbe.failingProfiles.length > 0
      ? latestProbe.failingProfiles.join(', ')
      : 'one or more non-basic profiles';
  nextStep = `Latest API-key probe is still failing these required profiles: ${failingProfilesText}. Do not patch Search_Agent0 yet; fix those direct /api/api_message prompt classes first, then rerun npm run prepare:agent0:n8n-migration.`;
} else if (missingRequired.length === 0 && hasApiKey && hasWorkflowId && hasProbeArtifact && !latestProbe.success) {
  nextStep = 'Latest API-key probe artifact is failing. Rerun npm run prepare:agent0:n8n-migration with the real live token before applying any patch.';
} else if (missingRequired.length === 0 && hasApiKey && hasWorkflowId && hasProbeArtifact && latestProbe.success && probeMatchesCurrentApiKeyEnv) {
  nextStep = 'Latest API-key probe is green and matches the current env source. Apply the rendered validate-only n8n patch payload for Search_Agent0.';
} else if (missingRequired.length === 0 && hasApiKey && !hasExplicitWorkflowId && discoveredWorkflowId) {
  nextStep = discoveredWorkflowId
    ? `You can rely on auto-discovery or export AGENT0_N8N_WORKFLOW_ID=${discoveredWorkflowId} explicitly, then run npm run prepare:agent0:n8n-migration.`
    : 'Export AGENT0_N8N_WORKFLOW_ID, then run npm run prepare:agent0:n8n-migration.';
} else if (missingRequired.length === 0 && hasApiKey && hasWorkflowId && !hasProbeArtifact) {
  nextStep = 'Run npm run prepare:agent0:n8n-migration.';
}

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      requiredFiles: checks.filter((item) => item.kind === 'required_file'),
      artifacts: checks.filter((item) => item.kind === 'artifact'),
      env: checks.filter((item) => item.kind === 'env'),
      discoveredWorkflowId: discoveredWorkflowId || null,
      resolvedApiKeyEnvName: resolvedApiKey.envName,
      latestProbe,
      probeMatchesCurrentApiKeyEnv,
      summary: {
        requiredFilesOk: missingRequired.length === 0,
        envReadyCount: envReady,
        readyForQuickstart: missingRequired.length === 0 && hasApiKey && hasWorkflowId,
        readyForValidateOnly:
          missingRequired.length === 0 &&
          hasApiKey &&
          hasWorkflowId &&
          hasProbeArtifact &&
          latestProbe.success &&
          latestProbe.requiredProfilesReady &&
          probeMatchesCurrentApiKeyEnv,
        nextStep,
      },
    },
    null,
    2,
  ),
);

process.exit(missingRequired.length === 0 ? 0 : 1);
