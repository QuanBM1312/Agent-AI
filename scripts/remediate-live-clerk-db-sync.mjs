#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROJECT_ROOT = process.cwd();
const OUTPUT = path.join(
  PROJECT_ROOT,
  'docs',
  'artifacts',
  'live-auth',
  'clerk-db-sync-remediation-run.json',
);

function printHelp() {
  console.log(`Usage:
  node scripts/remediate-live-clerk-db-sync.mjs

This is a read-only operator runbook generator. It does not mutate live Clerk,
Supabase, or Vercel config.
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

const verifyRun = await run('npm', ['run', 'verify:live:clerk-db-sync'], {
  cwd: PROJECT_ROOT,
});

const readiness = JSON.parse(
  await fs.readFile(
    path.join(PROJECT_ROOT, 'docs', 'artifacts', 'live-auth', 'clerk-db-sync-readiness.json'),
    'utf8',
  ),
);

const artifact = {
  generatedAt: new Date().toISOString(),
  dryRun: true,
  steps: {
    verify: {
      ok: verifyRun.ok,
      code: verifyRun.code,
      stderr: verifyRun.stderr || null,
    },
  },
  readiness: {
    webhookReady: readiness.readiness?.webhookReady ?? false,
    dbReady: readiness.readiness?.dbReady ?? false,
    fullyReady: readiness.readiness?.fullyReady ?? false,
  },
  diagnostics: {
    currentDatabaseHost: readiness.diagnostics?.dbProbe?.databaseHost || null,
    currentDatabaseUsername: readiness.diagnostics?.dbProbe?.databaseUsername || null,
    currentDatabaseModeGuess: readiness.diagnostics?.dbProbe?.databaseUrlModeGuess || null,
    currentProjectRef: readiness.diagnostics?.dbProbe?.derivedProjectRef || null,
    anonKeyProjectRef: readiness.diagnostics?.dbProbe?.anonKeyProjectRef || null,
    serviceRoleProjectRef: readiness.diagnostics?.dbProbe?.serviceRoleProjectRef || null,
    supabaseRefsConsistent: readiness.diagnostics?.dbProbe?.supabaseRefsConsistent ?? null,
    currentDatabaseHostPublicDnsHasRecords:
      readiness.diagnostics?.dbProbe?.databaseHostPublicDnsHasRecords ?? null,
    currentDirectHost: readiness.diagnostics?.dbProbe?.directHost || null,
    currentDirectUsername: readiness.diagnostics?.dbProbe?.directUsername || null,
    currentDirectModeGuess: readiness.diagnostics?.dbProbe?.directUrlModeGuess || null,
    currentDirectHostPublicDnsHasRecords:
      readiness.diagnostics?.dbProbe?.directHostPublicDnsHasRecords ?? null,
    expectedDerivedDirectHost: readiness.diagnostics?.dbProbe?.derivedDirectHost || null,
    expectedDerivedDirectHostPublicDnsHasRecords:
      readiness.diagnostics?.dbProbe?.derivedDirectHostPublicDnsHasRecords ?? null,
    currentSupabaseRestHost: readiness.diagnostics?.dbProbe?.supabaseRestHost || null,
    currentSupabaseRestPublicDnsHasRecords:
      readiness.diagnostics?.dbProbe?.supabaseRestPublicDnsHasRecords ?? null,
    currentSupabaseRestError: readiness.diagnostics?.dbProbe?.supabaseRestError || null,
    currentSvixErrorCode: readiness.diagnostics?.webhookProbe?.svixErrorCode || null,
    webhookMethods: Array.isArray(readiness.diagnostics?.webhookProbe?.webhookMethods)
      ? readiness.diagnostics.webhookProbe.webhookMethods
      : [],
  },
  references: [
    'https://supabase.com/docs/reference/postgres/connection-strings',
    'https://supabase.com/docs/guides/database/prisma',
  ],
  patternNotes: [
    'Supavisor transaction mode typically uses postgres.<project-ref>@aws-<region>.pooler.supabase.com:6543/postgres.',
    'Supavisor session mode typically uses postgres.<project-ref>@aws-<region>.pooler.supabase.com:5432/postgres.',
    'Direct Postgres connections typically use postgres@db.<project-ref>.supabase.co:5432/postgres.',
  ],
  nextActions: [],
  conclusions: [],
};

if (readiness.checks?.clerkWebhookAppPresent === false) {
  artifact.nextActions.push(
    'Create or attach a Svix webhook app in the live Clerk instance for /api/webhooks/clerk.',
  );
}

if (readiness.checks?.clerkWebhookRuntimeSecretPresent === false) {
  artifact.nextActions.push(
    readiness.checks?.clerkWebhookAppPresent === true
      ? 'Set CLERK_WEBHOOK_SIGNING_SECRET in production env to match the live Clerk Svix webhook configuration.'
      : 'Set CLERK_WEBHOOK_SIGNING_SECRET in production env after Clerk webhook creation.',
  );
}

if (readiness.diagnostics?.dbProbe?.directUrlLooksLikePooler === true) {
  artifact.nextActions.push(
    `Replace DIRECT_URL host ${artifact.diagnostics.currentDirectHost || '(unknown)'} with a true direct Postgres host${artifact.diagnostics.expectedDerivedDirectHost ? ` such as ${artifact.diagnostics.expectedDerivedDirectHost}` : ''}.`,
  );
}

if (readiness.checks?.prismaViaDatabaseUrlOk === false && readiness.checks?.prismaViaDirectUrlOk === false) {
  artifact.nextActions.push(
    'Rotate or correct Supabase database credentials because both DATABASE_URL and DIRECT_URL fail authentication.',
  );
}

if (readiness.checks?.supabaseRestReachable === false) {
  artifact.nextActions.push(
    'Correct NEXT_PUBLIC_SUPABASE_URL or restore DNS for the mirrored Supabase project host so browser/API Supabase calls can resolve.',
  );
}

if (
  readiness.diagnostics?.dbProbe?.supabaseRestPublicDnsHasRecords === false ||
  readiness.diagnostics?.dbProbe?.derivedDirectHostPublicDnsHasRecords === false
) {
  artifact.nextActions.push(
    'Verify that the Supabase project ref/hosts are still valid because public DNS returns no records for one or more mirrored project hosts.',
  );
}

if (readiness.diagnostics?.dbProbe?.supabaseRefsConsistent === true) {
  artifact.conclusions.push(
    `Mirrored DSNs and Supabase JWT keys consistently point at project ref ${artifact.diagnostics.currentProjectRef || '(unknown)'}.`,
  );
}

artifact.conclusions.push(
  artifact.readiness.fullyReady
    ? 'Clerk-to-DB sync prerequisites are fully ready.'
    : 'Clerk-to-DB sync still requires external config changes before repo-side code can succeed.',
);
artifact.conclusions.push(
  artifact.nextActions.length > 0
    ? 'The remaining work is now an operator/config runbook, not an application-code task.'
    : 'No additional remediation actions were derived from the current readiness artifact.',
);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
