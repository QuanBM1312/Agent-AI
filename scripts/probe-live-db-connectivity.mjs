#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_ENV_FILE = path.join(projectRoot, '.vercel', '.env.production.local');
const DEFAULT_OUTPUT = path.join(
  projectRoot,
  'docs',
  'artifacts',
  'live-auth',
  'db-connectivity.json',
);

function printHelp() {
  console.log(`Usage:
  npm run probe:live:db

Optional env:
  LIVE_DB_ENV_FILE     env file used when DATABASE_URL is not already exported
  LIVE_DB_OUTPUT       output artifact path
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

function pickEnvValue(processKey, fileEnv) {
  return process.env[processKey] || fileEnv[processKey] || '';
}

function sanitizeUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol,
      host: parsed.host,
      username: parsed.username || null,
      pathname: parsed.pathname,
    };
  } catch (error) {
    return {
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function deriveSupabaseProjectRef(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username.startsWith('postgres.')) {
      return parsed.username.slice('postgres.'.length) || null;
    }
  } catch {
    return null;
  }

  return null;
}

function formatError(error) {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      cause:
        error.cause && typeof error.cause === 'object' && 'message' in error.cause
          ? error.cause.message
          : null,
    };
  }

  return {
    name: null,
    message: String(error),
    cause: null,
  };
}

async function runPrismaProbe(url) {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  if (url) {
    process.env.DATABASE_URL = url;
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$queryRawUnsafe('select 1 as ok');
    return {
      ok: true,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      error: formatError(error),
    };
  } finally {
    await prisma.$disconnect();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  }
}

async function probeHttpsHost(host) {
  try {
    await fetch(`https://${host}`, { method: 'HEAD' });
    return {
      reachable: true,
      error: null,
    };
  } catch (error) {
    return {
      reachable: false,
      error: formatError(error),
    };
  }
}

async function probePublicDnsHost(host) {
  try {
    const [aResponse, aaaaResponse] = await Promise.all(
      ['A', 'AAAA'].map((type) =>
        fetch(
          `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`,
          {
            headers: {
              accept: 'application/json',
            },
          },
        ).then(async (response) => ({
          type,
          ok: response.ok,
          status: response.status,
          body: await response.json(),
        })),
      ),
    );
    const responses = [aResponse, aaaaResponse];
    const answers = responses.flatMap(({ body, type }) =>
      Array.isArray(body.Answer)
        ? body.Answer.map((entry) => ({
            name: entry.name || null,
            type: entry.type || type,
            data: entry.data || null,
          }))
        : [],
    );
    const hasRecords = answers.length > 0;
    const ok = responses.every((response) => response.ok);
    const status = responses.find((response) => !response.ok)?.status || responses[0]?.status || 0;
    const dnsStatus =
      responses.find(({ body }) => typeof body.Status === 'number' && body.Status !== 0)?.body?.Status ??
      responses[0]?.body?.Status ??
      null;

    return {
      ok,
      status,
      dnsStatus,
      hasRecords,
      answers,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      dnsStatus: null,
      hasRecords: false,
      answers: [],
      error: formatError(error),
    };
  }
}

const envFile = process.env.LIVE_DB_ENV_FILE || DEFAULT_ENV_FILE;
const outputPath = process.env.LIVE_DB_OUTPUT || DEFAULT_OUTPUT;
const fileEnv = await loadEnv(envFile);

const databaseUrl = pickEnvValue('DATABASE_URL', fileEnv);
const directUrl = pickEnvValue('DIRECT_URL', fileEnv);
const supabaseUrl = pickEnvValue('NEXT_PUBLIC_SUPABASE_URL', fileEnv);
const supabaseAnonKey = pickEnvValue('NEXT_PUBLIC_SUPABASE_ANON_KEY', fileEnv);
const supabaseServiceRoleKey = pickEnvValue('SUPABASE_SERVICE_ROLE_KEY', fileEnv);
const supabaseAnonPayload = decodeJwtPayload(supabaseAnonKey);
const supabaseServiceRolePayload = decodeJwtPayload(supabaseServiceRoleKey);

const artifact = {
  generatedAt: new Date().toISOString(),
  envFile: path.relative(projectRoot, envFile),
  urls: {
    databaseUrl: sanitizeUrl(databaseUrl),
    directUrl: sanitizeUrl(directUrl),
    supabaseUrl: sanitizeUrl(supabaseUrl),
  },
  heuristics: {
    databaseUrlLooksLikePooler: false,
    directUrlLooksLikePooler: false,
    databaseUrlModeGuess: null,
    directUrlModeGuess: null,
    derivedProjectRef: null,
    derivedDirectHost: null,
  },
  auth: {
    anonKeyProjectRef: supabaseAnonPayload?.ref || null,
    serviceRoleProjectRef: supabaseServiceRolePayload?.ref || null,
    refsConsistent: null,
  },
  probes: {
    databaseHostHttps: null,
    directHostHttps: null,
    databaseHostPublicDns: null,
    directHostPublicDns: null,
    derivedDirectHostHttps: null,
    derivedDirectHostPublicDns: null,
    supabaseRest: null,
    supabaseRestPublicDns: null,
    prismaQueryViaDatabaseUrl: null,
    prismaQueryViaDirectUrl: null,
  },
  conclusions: [],
};

artifact.heuristics.databaseUrlLooksLikePooler =
  typeof artifact.urls.databaseUrl?.host === 'string' &&
  artifact.urls.databaseUrl.host.includes('pooler.supabase.com');
artifact.heuristics.directUrlLooksLikePooler =
  typeof artifact.urls.directUrl?.host === 'string' &&
  artifact.urls.directUrl.host.includes('pooler.supabase.com');
if (artifact.urls.databaseUrl?.host && artifact.urls.databaseUrl?.username) {
  if (
    artifact.urls.databaseUrl.host.includes('pooler.supabase.com') &&
    artifact.urls.databaseUrl.host.endsWith(':6543') &&
    artifact.urls.databaseUrl.username.startsWith('postgres.')
  ) {
    artifact.heuristics.databaseUrlModeGuess = 'pooler-6543-project-scoped-user';
  } else if (
    artifact.urls.databaseUrl.host.includes('pooler.supabase.com') &&
    artifact.urls.databaseUrl.host.endsWith(':5432') &&
    artifact.urls.databaseUrl.username.startsWith('postgres.')
  ) {
    artifact.heuristics.databaseUrlModeGuess = 'session-pooler';
  } else if (
    artifact.urls.databaseUrl.host.startsWith('db.') &&
    artifact.urls.databaseUrl.host.includes('.supabase.co') &&
    artifact.urls.databaseUrl.username === 'postgres'
  ) {
    artifact.heuristics.databaseUrlModeGuess = 'direct-db';
  }
}
if (artifact.urls.directUrl?.host && artifact.urls.directUrl?.username) {
  if (
    artifact.urls.directUrl.host.includes('pooler.supabase.com') &&
    artifact.urls.directUrl.host.endsWith(':5432') &&
    artifact.urls.directUrl.username.startsWith('postgres.')
  ) {
    artifact.heuristics.directUrlModeGuess = 'session-pooler';
  } else if (
    artifact.urls.directUrl.host.startsWith('db.') &&
    artifact.urls.directUrl.host.includes('.supabase.co') &&
    artifact.urls.directUrl.username === 'postgres'
  ) {
    artifact.heuristics.directUrlModeGuess = 'direct-db';
  }
}
artifact.heuristics.derivedProjectRef =
  deriveSupabaseProjectRef(databaseUrl) ||
  deriveSupabaseProjectRef(directUrl) ||
  null;
artifact.heuristics.derivedDirectHost = artifact.heuristics.derivedProjectRef
  ? `db.${artifact.heuristics.derivedProjectRef}.supabase.co`
  : null;
artifact.auth.refsConsistent =
  artifact.auth.anonKeyProjectRef !== null &&
  artifact.auth.serviceRoleProjectRef !== null &&
  artifact.auth.anonKeyProjectRef === artifact.auth.serviceRoleProjectRef &&
  artifact.auth.anonKeyProjectRef === artifact.heuristics.derivedProjectRef;

if (artifact.urls.databaseUrl?.host) {
  const databaseHost = artifact.urls.databaseUrl.host.replace(/:\d+$/, '');
  artifact.probes.databaseHostHttps = await probeHttpsHost(
    databaseHost,
  );
  artifact.probes.databaseHostPublicDns = await probePublicDnsHost(databaseHost);
}

if (artifact.urls.directUrl?.host) {
  const directHost = artifact.urls.directUrl.host.replace(/:\d+$/, '');
  artifact.probes.directHostHttps = await probeHttpsHost(
    directHost,
  );
  artifact.probes.directHostPublicDns = await probePublicDnsHost(directHost);
}

if (artifact.heuristics.derivedDirectHost) {
  artifact.probes.derivedDirectHostHttps = await probeHttpsHost(
    artifact.heuristics.derivedDirectHost,
  );
  artifact.probes.derivedDirectHostPublicDns = await probePublicDnsHost(
    artifact.heuristics.derivedDirectHost,
  );
}

if (supabaseUrl) {
  const supabaseHost = artifact.urls.supabaseUrl?.host || null;
  const restUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/`;
  try {
    const response = await fetch(restUrl, { method: 'GET' });
    artifact.probes.supabaseRest = {
      reachable: true,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      error: null,
    };
  } catch (error) {
    artifact.probes.supabaseRest = {
      reachable: false,
      ok: false,
      status: 0,
      statusText: null,
      error: formatError(error),
    };
  }
  if (supabaseHost) {
    artifact.probes.supabaseRestPublicDns = await probePublicDnsHost(supabaseHost);
  }
}

if (databaseUrl) {
  artifact.probes.prismaQueryViaDatabaseUrl = await runPrismaProbe(databaseUrl);
}

if (directUrl) {
  artifact.probes.prismaQueryViaDirectUrl = await runPrismaProbe(directUrl);
}

artifact.conclusions.push(
  artifact.probes.prismaQueryViaDatabaseUrl?.ok
    ? 'Prisma query succeeded against DATABASE_URL.'
    : 'Prisma query failed against DATABASE_URL.',
);

artifact.conclusions.push(
  artifact.probes.prismaQueryViaDirectUrl?.ok
    ? 'Prisma query succeeded against DIRECT_URL.'
    : directUrl
      ? 'Prisma query failed against DIRECT_URL.'
      : 'DIRECT_URL is not configured in the mirrored env.',
);

if (artifact.heuristics.directUrlLooksLikePooler) {
  artifact.conclusions.push(
    'DIRECT_URL currently points at a Supabase pooler host, not a direct db.<project-ref>.supabase.co host.',
  );
}

if (artifact.heuristics.databaseUrlModeGuess) {
  artifact.conclusions.push(`DATABASE_URL mode guess: ${artifact.heuristics.databaseUrlModeGuess}.`);
}

if (artifact.heuristics.directUrlModeGuess) {
  artifact.conclusions.push(`DIRECT_URL mode guess: ${artifact.heuristics.directUrlModeGuess}.`);
}

if (artifact.auth.refsConsistent === true) {
  artifact.conclusions.push(
    `Mirrored Supabase DSNs and JWT keys consistently point at project ref ${artifact.heuristics.derivedProjectRef}.`,
  );
}

if (
  artifact.probes.derivedDirectHostPublicDns?.ok === true &&
  artifact.probes.derivedDirectHostPublicDns?.hasRecords === false
) {
  artifact.conclusions.push(
    'Public DNS does not currently return records for the derived direct db.<project-ref>.supabase.co host.',
  );
}

artifact.conclusions.push(
  artifact.probes.supabaseRest?.reachable
    ? 'Supabase REST endpoint is reachable from this machine using the mirrored env.'
    : 'Supabase REST endpoint is not reachable from this machine using the mirrored env.',
);

if (
  artifact.probes.supabaseRestPublicDns?.ok === true &&
  artifact.probes.supabaseRestPublicDns?.hasRecords === false
) {
  artifact.conclusions.push(
    'Public DNS does not currently return records for the mirrored NEXT_PUBLIC_SUPABASE_URL host.',
  );
}

if (
  artifact.probes.prismaQueryViaDatabaseUrl?.error?.message?.includes('Tenant or user not found') ||
  artifact.probes.prismaQueryViaDirectUrl?.error?.message?.includes('Tenant or user not found')
) {
  artifact.conclusions.push(
    'Current Prisma DB path is blocked by database tenant/user authentication, not app-level auth logic.',
  );
}

if (
  artifact.probes.supabaseRest?.error?.cause?.includes('ENOTFOUND') ||
  artifact.probes.supabaseRest?.error?.message?.includes('ENOTFOUND')
) {
  artifact.conclusions.push(
    'Supabase REST fallback cannot currently be proved from this machine because the mirrored Supabase host does not resolve.',
  );
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
