#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClerkClient } from '@clerk/backend';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_ENV_FILE = path.join(projectRoot, '.vercel', '.env.production.local');
const DEFAULT_OUTPUT = path.join(
  projectRoot,
  'docs',
  'artifacts',
  'live-auth',
  'clerk-webhook-bootstrap.json',
);

function printHelp() {
  console.log(`Usage:
  npm run bootstrap:live:clerk:svix

Optional env:
  CLERK_WEBHOOK_ENV_FILE      env file used when Clerk keys are not already exported
  CLERK_WEBHOOK_BOOTSTRAP_OUTPUT
                             output artifact path
  CLERK_WEBHOOK_BOOTSTRAP_APPLY=1
                             create the Svix app when missing
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

function parseEnvFile(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function loadEnv(envFile) {
  try {
    return parseEnvFile(await fs.readFile(envFile, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function maskPresent(value) {
  return typeof value === 'string' && value.length > 0;
}

function sanitizeSvixResponse(response) {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const rawUrl = typeof response.svix_url === 'string' ? response.svix_url : '';

  if (!rawUrl) {
    return {
      svixUrlPresent: false,
    };
  }

  try {
    const parsed = new URL(rawUrl);
    return {
      svixUrlPresent: true,
      origin: parsed.origin,
      pathname: parsed.pathname,
      hashPresent: parsed.hash.length > 0,
    };
  } catch {
    return {
      svixUrlPresent: true,
      parseable: false,
    };
  }
}

async function captureGenerateSvixAuthURL(clerk) {
  try {
    const response = await clerk.webhooks.generateSvixAuthURL();
    return {
      ok: true,
      response: sanitizeSvixResponse(response),
    };
  } catch (error) {
    return {
      ok: false,
      name: error?.name || null,
      message: error?.message || String(error),
      status: error?.status || null,
      errors: Array.isArray(error?.errors) ? error.errors : [],
    };
  }
}

const envFile = process.env.CLERK_WEBHOOK_ENV_FILE || DEFAULT_ENV_FILE;
const outputPath = process.env.CLERK_WEBHOOK_BOOTSTRAP_OUTPUT || DEFAULT_OUTPUT;
const fileEnv = await loadEnv(envFile);
const apply = process.env.CLERK_WEBHOOK_BOOTSTRAP_APPLY === '1';

const secretKey = process.env.CLERK_SECRET_KEY || fileEnv.CLERK_SECRET_KEY || '';
const publishableKey =
  process.env.CLERK_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  fileEnv.CLERK_PUBLISHABLE_KEY ||
  fileEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  '';

const artifact = {
  generatedAt: new Date().toISOString(),
  dryRun: !apply,
  envFile: path.relative(projectRoot, envFile),
  env: {
    clerkSecretKeyPresent: maskPresent(secretKey),
    clerkPublishableKeyPresent: maskPresent(publishableKey),
  },
  before: null,
  applyAttempt: null,
  after: null,
  conclusions: [],
};

try {
  if (!secretKey || !publishableKey) {
    throw new Error('Missing Clerk secret/publishable key');
  }

  const clerk = createClerkClient({
    secretKey,
    publishableKey,
  });

  artifact.before = {
    generateSvixAuthURL: await captureGenerateSvixAuthURL(clerk),
  };

  const missingSvixApp =
    artifact.before.generateSvixAuthURL?.ok === false &&
    artifact.before.generateSvixAuthURL.errors?.some((entry) => entry?.code === 'svix_app_missing');

  if (missingSvixApp && apply) {
    try {
      const response = await clerk.webhooks.createSvixApp();
      artifact.applyAttempt = {
        ok: true,
        action: 'createSvixApp',
        response: sanitizeSvixResponse(response),
      };
    } catch (error) {
      artifact.applyAttempt = {
        ok: false,
        action: 'createSvixApp',
        name: error?.name || null,
        message: error?.message || String(error),
        status: error?.status || null,
        errors: Array.isArray(error?.errors) ? error.errors : [],
      };
    }
  } else {
    artifact.applyAttempt = {
      ok: true,
      skipped: true,
      reason: missingSvixApp
        ? 'dry-run mode'
        : 'Svix app already present or missing-state not observed',
    };
  }

  artifact.after = {
    generateSvixAuthURL: await captureGenerateSvixAuthURL(clerk),
  };

  artifact.conclusions.push(
    missingSvixApp
      ? 'The live Clerk instance started without a Svix app.'
      : 'The live Clerk instance already had a Svix app before this run.',
  );
  artifact.conclusions.push(
    artifact.applyAttempt?.skipped
      ? `No live mutation was applied: ${artifact.applyAttempt.reason}.`
      : artifact.applyAttempt?.ok
        ? 'Svix app bootstrap request completed successfully.'
        : 'Svix app bootstrap request failed.',
  );
  artifact.conclusions.push(
    artifact.after.generateSvixAuthURL?.ok
      ? 'Clerk can now generate a Svix auth URL for webhook setup.'
      : 'Clerk still cannot generate a Svix auth URL after this run.',
  );
} catch (error) {
  artifact.error = error instanceof Error ? error.message : String(error);
  artifact.conclusions.push('Clerk Svix bootstrap did not complete successfully.');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
