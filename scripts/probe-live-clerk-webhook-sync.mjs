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
  'clerk-webhook-sync.json',
);
const DEFAULT_APP_BASE_URL = 'https://aioperation.dieuhoathanglong.com.vn';

function printHelp() {
  console.log(`Usage:
  npm run probe:live:clerk:webhooks

Optional env:
  CLERK_WEBHOOK_ENV_FILE      env file used when CLERK_SECRET_KEY is not already exported
  CLERK_WEBHOOK_OUTPUT        output artifact path
  LIVE_PROBE_BASE_URL         base app URL for runtime webhook probe
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

const envFile = process.env.CLERK_WEBHOOK_ENV_FILE || DEFAULT_ENV_FILE;
const outputPath = process.env.CLERK_WEBHOOK_OUTPUT || DEFAULT_OUTPUT;
const appBaseUrl = (process.env.LIVE_PROBE_BASE_URL || DEFAULT_APP_BASE_URL).replace(/\/$/, '');
const fileEnv = await loadEnv(envFile);

const secretKey = process.env.CLERK_SECRET_KEY || fileEnv.CLERK_SECRET_KEY || '';
const publishableKey =
  process.env.CLERK_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  fileEnv.CLERK_PUBLISHABLE_KEY ||
  fileEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  '';
const webhookSecret =
  process.env.CLERK_WEBHOOK_SECRET ||
  process.env.CLERK_WEBHOOK_SIGNING_SECRET ||
  fileEnv.CLERK_WEBHOOK_SECRET ||
  fileEnv.CLERK_WEBHOOK_SIGNING_SECRET ||
  '';

const artifact = {
  generatedAt: new Date().toISOString(),
  envFile: path.relative(projectRoot, envFile),
  env: {
    clerkSecretKeyPresent: maskPresent(secretKey),
    clerkPublishableKeyPresent: maskPresent(publishableKey),
    clerkWebhookSecretPresent: maskPresent(webhookSecret),
  },
  sdk: {
    webhookMethods: [],
  },
  clerk: {
    generateSvixAuthURL: null,
  },
  runtime: {
    webhookRouteProbe: null,
  },
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
  artifact.sdk.webhookMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(clerk.webhooks))
    .filter((entry) => entry !== 'constructor')
    .sort();

  try {
    const response = await clerk.webhooks.generateSvixAuthURL();
    artifact.clerk.generateSvixAuthURL = {
      ok: true,
      response: sanitizeSvixResponse(response),
    };
  } catch (error) {
    artifact.clerk.generateSvixAuthURL = {
      ok: false,
      name: error?.name || null,
      message: error?.message || String(error),
      status: error?.status || null,
      errors: Array.isArray(error?.errors) ? error.errors : [],
    };
  }

  try {
    const response = await fetch(`${appBaseUrl}/api/webhooks/clerk`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ping: true }),
    });
    const body = await response.text();
    artifact.runtime.webhookRouteProbe = {
      ok: response.ok,
      status: response.status,
      bodyPreview: body.slice(0, 200),
      runtimeSecretPresent:
        response.status === 400 && /Webhook verification failed/i.test(body),
      runtimeSecretMissing:
        response.status === 500 && /Missing Clerk webhook signing secret/i.test(body),
    };
  } catch (error) {
    artifact.runtime.webhookRouteProbe = {
      ok: false,
      name: error?.name || null,
      message: error?.message || String(error),
    };
  }

  const missingSvixApp =
    artifact.clerk.generateSvixAuthURL?.ok === false &&
    artifact.clerk.generateSvixAuthURL.errors?.some((entry) => entry?.code === 'svix_app_missing');

  artifact.conclusions.push(
    missingSvixApp
      ? 'Clerk instance does not currently have a Svix webhook app associated with it.'
      : 'Clerk webhook API did not report a missing Svix app.',
  );
  artifact.conclusions.push(
    artifact.env.clerkWebhookSecretPresent
      ? 'A Clerk webhook signing secret is present in the local production env mirror.'
      : 'No Clerk webhook signing secret is present in the local production env mirror.',
  );
  artifact.conclusions.push(
    artifact.runtime.webhookRouteProbe?.runtimeSecretPresent
      ? 'The live webhook route behaves as if the signing secret is present at runtime.'
      : artifact.runtime.webhookRouteProbe?.runtimeSecretMissing
        ? 'The live webhook route still reports a missing signing secret at runtime.'
        : 'The live webhook route probe was inconclusive about runtime signing-secret presence.',
  );
  artifact.conclusions.push(
    missingSvixApp
      ? 'Fresh-user DB sync is unlikely to be driven by Clerk webhooks in the current live instance.'
      : 'Fresh-user DB sync may still depend on app-side webhook handling or another provisioning path.',
  );
} catch (error) {
  artifact.error = error instanceof Error ? error.message : String(error);
  artifact.conclusions.push('Clerk webhook sync probe did not complete successfully.');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
