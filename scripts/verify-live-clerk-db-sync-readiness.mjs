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
  'clerk-db-sync-readiness.json',
);

function printHelp() {
  console.log(`Usage:
  node scripts/verify-live-clerk-db-sync-readiness.mjs
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

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, relativePath), 'utf8'));
}

const artifact = {
  generatedAt: new Date().toISOString(),
  checks: {
    clerkWebhookAppPresent: null,
    clerkWebhookSecretPresent: null,
    clerkWebhookRuntimeSecretPresent: null,
    databaseUrlReachable: null,
    directUrlReachable: null,
    prismaViaDatabaseUrlOk: null,
    prismaViaDirectUrlOk: null,
    supabaseRestReachable: null,
  },
  diagnostics: {
    webhookProbe: null,
    dbProbe: null,
  },
  readiness: {
    webhookReady: false,
    dbReady: false,
    fullyReady: false,
  },
  conclusions: [],
};

const [webhookRun, dbRun] = await Promise.all([
  run('npm', ['run', 'probe:live:clerk:webhooks'], { cwd: PROJECT_ROOT }),
  run('npm', ['run', 'probe:live:db'], { cwd: PROJECT_ROOT }),
]);

if (webhookRun.ok) {
  const webhookArtifact = await readJson('docs/artifacts/live-auth/clerk-webhook-sync.json');
  artifact.diagnostics.webhookProbe = {
    generatedAt: webhookArtifact.generatedAt || null,
    clerkWebhookSecretPresent: webhookArtifact.env?.clerkWebhookSecretPresent ?? null,
    webhookMethods: Array.isArray(webhookArtifact.sdk?.webhookMethods)
      ? webhookArtifact.sdk.webhookMethods
      : [],
    runtimeWebhookStatus: webhookArtifact.runtime?.webhookRouteProbe?.status ?? null,
    runtimeSecretPresent: webhookArtifact.runtime?.webhookRouteProbe?.runtimeSecretPresent ?? null,
    svixErrorCode: webhookArtifact.clerk?.generateSvixAuthURL?.errors?.[0]?.code || null,
    svixErrorMessage: webhookArtifact.clerk?.generateSvixAuthURL?.errors?.[0]?.message || null,
  };
  artifact.checks.clerkWebhookSecretPresent = webhookArtifact.env?.clerkWebhookSecretPresent === true;
  artifact.checks.clerkWebhookRuntimeSecretPresent =
    webhookArtifact.runtime?.webhookRouteProbe?.runtimeSecretPresent === true;
  artifact.checks.clerkWebhookAppPresent =
    webhookArtifact.clerk?.generateSvixAuthURL?.ok === true ||
    webhookArtifact.clerk?.generateSvixAuthURL?.errors?.[0]?.code !== 'svix_app_missing';
}

if (dbRun.ok) {
  const dbArtifact = await readJson('docs/artifacts/live-auth/db-connectivity.json');
  artifact.diagnostics.dbProbe = {
    generatedAt: dbArtifact.generatedAt || null,
    databaseHost: dbArtifact.urls?.databaseUrl?.host || null,
    databaseUsername: dbArtifact.urls?.databaseUrl?.username || null,
    databaseHostPublicDnsOk: dbArtifact.probes?.databaseHostPublicDns?.ok ?? null,
    databaseHostPublicDnsHasRecords:
      dbArtifact.probes?.databaseHostPublicDns?.hasRecords ?? null,
    directHost: dbArtifact.urls?.directUrl?.host || null,
    directUsername: dbArtifact.urls?.directUrl?.username || null,
    directHostPublicDnsOk: dbArtifact.probes?.directHostPublicDns?.ok ?? null,
    directHostPublicDnsHasRecords:
      dbArtifact.probes?.directHostPublicDns?.hasRecords ?? null,
    databaseUrlModeGuess: dbArtifact.heuristics?.databaseUrlModeGuess || null,
    directUrlModeGuess: dbArtifact.heuristics?.directUrlModeGuess || null,
    derivedProjectRef: dbArtifact.heuristics?.derivedProjectRef || null,
    directUrlLooksLikePooler: dbArtifact.heuristics?.directUrlLooksLikePooler ?? null,
    anonKeyProjectRef: dbArtifact.auth?.anonKeyProjectRef || null,
    serviceRoleProjectRef: dbArtifact.auth?.serviceRoleProjectRef || null,
    supabaseRefsConsistent: dbArtifact.auth?.refsConsistent ?? null,
    derivedDirectHost: dbArtifact.heuristics?.derivedDirectHost || null,
    derivedDirectHostReachable:
      dbArtifact.probes?.derivedDirectHostPublicDns?.hasRecords ??
      dbArtifact.probes?.prismaQueryViaDirectUrl?.ok ??
      dbArtifact.probes?.derivedDirectHostHttps?.reachable ??
      null,
    derivedDirectHostPublicDnsOk:
      dbArtifact.probes?.derivedDirectHostPublicDns?.ok ?? null,
    derivedDirectHostPublicDnsHasRecords:
      dbArtifact.probes?.derivedDirectHostPublicDns?.hasRecords ?? null,
    supabaseRestHost: dbArtifact.urls?.supabaseUrl?.host || null,
    supabaseRestPublicDnsOk: dbArtifact.probes?.supabaseRestPublicDns?.ok ?? null,
    supabaseRestPublicDnsHasRecords:
      dbArtifact.probes?.supabaseRestPublicDns?.hasRecords ?? null,
    databaseUrlError: dbArtifact.probes?.prismaQueryViaDatabaseUrl?.error?.message || null,
    directUrlError: dbArtifact.probes?.prismaQueryViaDirectUrl?.error?.message || null,
    supabaseRestError:
      dbArtifact.probes?.supabaseRest?.error?.cause ||
      dbArtifact.probes?.supabaseRest?.error?.message ||
      null,
  };
  artifact.checks.databaseUrlReachable =
    dbArtifact.probes?.prismaQueryViaDatabaseUrl?.ok ??
    dbArtifact.probes?.databaseHostPublicDns?.hasRecords ??
    dbArtifact.probes?.databaseHostHttps?.reachable ??
    null;
  artifact.checks.directUrlReachable =
    dbArtifact.probes?.prismaQueryViaDirectUrl?.ok ??
    dbArtifact.probes?.directHostPublicDns?.hasRecords ??
    dbArtifact.probes?.directHostHttps?.reachable ??
    null;
  artifact.checks.prismaViaDatabaseUrlOk = dbArtifact.probes?.prismaQueryViaDatabaseUrl?.ok ?? null;
  artifact.checks.prismaViaDirectUrlOk = dbArtifact.probes?.prismaQueryViaDirectUrl?.ok ?? null;
  artifact.checks.supabaseRestReachable =
    dbArtifact.probes?.supabaseRest?.reachable ??
    dbArtifact.probes?.supabaseRest?.ok ??
    null;
}

artifact.readiness.webhookReady =
  artifact.checks.clerkWebhookAppPresent === true &&
  artifact.checks.clerkWebhookRuntimeSecretPresent === true;

artifact.readiness.dbReady =
  artifact.checks.prismaViaDatabaseUrlOk === true ||
  artifact.checks.prismaViaDirectUrlOk === true;

artifact.readiness.fullyReady =
  artifact.readiness.webhookReady &&
  artifact.readiness.dbReady;

if (artifact.readiness.webhookReady) {
  artifact.conclusions.push('Clerk webhook sync appears configured and ready.');
} else if (
  artifact.checks.clerkWebhookAppPresent === true &&
  artifact.checks.clerkWebhookRuntimeSecretPresent === false
) {
  artifact.conclusions.push(
    'Clerk webhook sync is partially configured: the Svix app exists, but the live webhook route still does not behave as if the signing secret is present.',
  );
} else if (artifact.checks.clerkWebhookAppPresent === false) {
  artifact.conclusions.push(
    'Clerk webhook sync is not ready: the Svix app is still missing in the live Clerk instance.',
  );
} else {
  artifact.conclusions.push('Clerk webhook sync is not ready: webhook prerequisites are incomplete.');
}

artifact.conclusions.push(
  artifact.readiness.dbReady
    ? 'At least one database DSN is usable for Prisma.'
    : 'Neither DATABASE_URL nor DIRECT_URL is currently usable for Prisma.',
);

if (artifact.diagnostics.dbProbe?.directUrlLooksLikePooler) {
  artifact.conclusions.push(
    'DIRECT_URL is configured as a pooler host, so it is not a true direct-db fallback in the mirrored env.',
  );
}

if (artifact.diagnostics.dbProbe?.supabaseRefsConsistent === true) {
  artifact.conclusions.push(
    'Mirrored Supabase DSNs and JWT keys all point at the same project ref, so this does not look like a mixed-project env drift.',
  );
}

if (
  artifact.diagnostics.dbProbe?.derivedDirectHost &&
  artifact.diagnostics.dbProbe?.derivedDirectHostReachable === false
) {
  artifact.conclusions.push(
    'The direct db.<project-ref>.supabase.co host derived from the mirrored credentials does not resolve from this machine.',
  );
}

if (
  artifact.diagnostics.dbProbe?.derivedDirectHost &&
  artifact.diagnostics.dbProbe?.derivedDirectHostPublicDnsOk === true &&
  artifact.diagnostics.dbProbe?.derivedDirectHostPublicDnsHasRecords === false
) {
  artifact.conclusions.push(
    'Public DNS also returns no records for the derived direct Supabase host, so this is not just a local resolver issue.',
  );
}

artifact.conclusions.push(
  artifact.checks.supabaseRestReachable
    ? 'Supabase REST fallback is reachable from this machine.'
    : 'Supabase REST fallback is not reachable from this machine.',
);

if (
  artifact.diagnostics.dbProbe?.supabaseRestHost &&
  artifact.diagnostics.dbProbe?.supabaseRestPublicDnsOk === true &&
  artifact.diagnostics.dbProbe?.supabaseRestPublicDnsHasRecords === false
) {
  artifact.conclusions.push(
    'Public DNS also returns no records for the mirrored NEXT_PUBLIC_SUPABASE_URL host.',
  );
}

artifact.conclusions.push(
  artifact.readiness.fullyReady
    ? 'Fresh-user Clerk-to-DB sync prerequisites are fully ready.'
    : 'Fresh-user Clerk-to-DB sync is still blocked by external config and/or DB credentials.',
);

await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
