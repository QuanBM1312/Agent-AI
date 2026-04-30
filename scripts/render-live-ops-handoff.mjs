#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const INPUT = path.join(
  PROJECT_ROOT,
  'docs',
  'artifacts',
  'live-auth',
  'live-ops-readiness.json',
);

function printHelp() {
  console.log(`Usage:
  node scripts/render-live-ops-handoff.mjs

Reads the latest overall live-ops artifact and prints a concise operator handoff.
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

function formatBool(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

const artifact = JSON.parse(await fs.readFile(INPUT, 'utf8'));
const clerkDbSync = artifact.diagnostics?.clerkDbSync || {};

const lines = [
  'Live Ops Handoff',
  `generatedAt: ${artifact.generatedAt || 'unknown'}`,
  '',
  'Status',
  `- warmContextReady: ${formatBool(artifact.checks?.warmContextReady)}`,
  `- agent0SettingsRemediated: ${formatBool(artifact.checks?.agent0SettingsRemediated)}`,
  `- clerkDbSyncReady: ${formatBool(artifact.checks?.clerkDbSyncReady)}`,
  `- fullyReady: ${formatBool(artifact.readiness?.fullyReady)}`,
  '',
  'DB Lane',
  `- webhookReady: ${formatBool(clerkDbSync.webhookReady)}`,
  `- dbReady: ${formatBool(clerkDbSync.dbReady)}`,
  `- projectRef: ${clerkDbSync.projectRef || 'unknown'}`,
  `- supabaseRefsConsistent: ${formatBool(clerkDbSync.supabaseRefsConsistent)}`,
  `- supabaseRestPublicDnsHasRecords: ${formatBool(clerkDbSync.supabaseRestPublicDnsHasRecords)}`,
  `- derivedDirectHostPublicDnsHasRecords: ${formatBool(clerkDbSync.derivedDirectHostPublicDnsHasRecords)}`,
];

if (Array.isArray(clerkDbSync.patternNotes) && clerkDbSync.patternNotes.length > 0) {
  lines.push('', 'Connection Patterns');
  for (const note of clerkDbSync.patternNotes) {
    lines.push(`- ${note}`);
  }
}

if (Array.isArray(artifact.nextActions) && artifact.nextActions.length > 0) {
  lines.push('', 'Next Actions');
  for (const action of artifact.nextActions) {
    lines.push(`- ${action}`);
  }
}

if (Array.isArray(clerkDbSync.references) && clerkDbSync.references.length > 0) {
  lines.push('', 'References');
  for (const reference of clerkDbSync.references) {
    lines.push(`- ${reference}`);
  }
}

console.log(lines.join('\n'));
