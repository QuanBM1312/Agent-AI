#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const OUTPUT = path.join(
  PROJECT_ROOT,
  'docs',
  'artifacts',
  'live-auth',
  'live-ops-readiness.json',
);

function printHelp() {
  console.log(`Usage:
  node scripts/verify-live-ops-readiness.mjs
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, relativePath), 'utf8'));
}

const [warmContext, agent0Settings, clerkDbSync, clerkDbSyncRunbook] = await Promise.all([
  readJson('docs/artifacts/live-n8n/warm-context-readiness.json'),
  readJson('docs/artifacts/live-auth/agent0-settings-remediation-readiness.json'),
  readJson('docs/artifacts/live-auth/clerk-db-sync-readiness.json'),
  readJson('docs/artifacts/live-auth/clerk-db-sync-remediation-run.json'),
]);

const artifact = {
  generatedAt: new Date().toISOString(),
  checks: {
    warmContextReady: warmContext.readiness?.fullyReady === true,
    agent0SettingsRemediated: agent0Settings.readiness?.fullyRemediated === true,
    clerkDbSyncReady: clerkDbSync.readiness?.fullyReady === true,
  },
  diagnostics: {
    warmContext: {
      fullyReady: warmContext.readiness?.fullyReady ?? false,
      appReady: warmContext.readiness?.appProofReady ?? warmContext.readiness?.appBuildReady ?? null,
      n8nReady: warmContext.readiness?.n8nReady ?? null,
    },
    agent0Settings: {
      rolloutState: agent0Settings.readiness?.rolloutState || null,
      fullyRemediated: agent0Settings.readiness?.fullyRemediated ?? false,
    },
    clerkDbSync: {
      webhookReady: clerkDbSync.readiness?.webhookReady ?? false,
      dbReady: clerkDbSync.readiness?.dbReady ?? false,
      fullyReady: clerkDbSync.readiness?.fullyReady ?? false,
      projectRef: clerkDbSync.diagnostics?.dbProbe?.derivedProjectRef ?? null,
      supabaseRefsConsistent: clerkDbSync.diagnostics?.dbProbe?.supabaseRefsConsistent ?? null,
      supabaseRestPublicDnsHasRecords:
        clerkDbSync.diagnostics?.dbProbe?.supabaseRestPublicDnsHasRecords ?? null,
      derivedDirectHostPublicDnsHasRecords:
        clerkDbSync.diagnostics?.dbProbe?.derivedDirectHostPublicDnsHasRecords ?? null,
      references: clerkDbSyncRunbook.references || [],
      patternNotes: clerkDbSyncRunbook.patternNotes || [],
      nextActions: clerkDbSyncRunbook.nextActions || [],
    },
  },
  readiness: {
    securityReady:
      warmContext.readiness?.fullyReady === true &&
      agent0Settings.readiness?.fullyRemediated === true,
    identityDataReady: clerkDbSync.readiness?.fullyReady === true,
    fullyReady:
      warmContext.readiness?.fullyReady === true &&
      agent0Settings.readiness?.fullyRemediated === true &&
      clerkDbSync.readiness?.fullyReady === true,
  },
  nextActions: [],
  conclusions: [],
};

if (Array.isArray(clerkDbSyncRunbook.nextActions) && clerkDbSyncRunbook.nextActions.length > 0) {
  artifact.nextActions.push(...clerkDbSyncRunbook.nextActions);
}

artifact.conclusions.push(
  artifact.checks.warmContextReady
    ? 'Live warm-context path is ready.'
    : 'Live warm-context path is not fully ready.',
);
artifact.conclusions.push(
  artifact.checks.agent0SettingsRemediated
    ? 'Live agent0 settings exposure is remediated.'
    : 'Live agent0 settings exposure is not fully remediated.',
);
artifact.conclusions.push(
  artifact.checks.clerkDbSyncReady
    ? 'Fresh-user Clerk-to-DB sync is ready.'
    : 'Fresh-user Clerk-to-DB sync is still blocked.',
);
artifact.conclusions.push(
  artifact.readiness.fullyReady
    ? 'Overall live ops readiness is green.'
    : 'Overall live ops readiness is not yet fully green.',
);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
