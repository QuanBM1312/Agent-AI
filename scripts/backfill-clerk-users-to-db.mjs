#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClerkClient } from '@clerk/backend';
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
  'clerk-users-backfill.json',
);

function printHelp() {
  console.log(`Usage:
  npm run backfill:clerk:users

Default mode is dry-run. Set CLERK_BACKFILL_APPLY=1 to write.

Optional env:
  CLERK_BACKFILL_ENV_FILE   env file used when Clerk/DB env vars are not exported
  CLERK_BACKFILL_OUTPUT     output artifact path
  CLERK_BACKFILL_LIMIT      max Clerk users to inspect. Default: 100
  CLERK_BACKFILL_APPLY      set to 1 to apply DB upserts
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

function buildRoleBreakdown(users) {
  return users.reduce((acc, user) => {
    acc[user.role] = (acc[user.role] || 0) + 1;
    return acc;
  }, {});
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function buildFullName(firstName, lastName) {
  return pickString(`${firstName || ''} ${lastName || ''}`.trim());
}

function coerceRole(value) {
  return ['Admin', 'Manager', 'Technician', 'Sales', 'NOT_ASSIGN'].includes(value)
    ? value
    : 'NOT_ASSIGN';
}

function normalizeClerkUserForDb(data) {
  const publicMetadata = data.publicMetadata || null;
  const email =
    pickString(data.emailAddresses?.[0]?.emailAddress) ||
    `${data.id}@clerk.local`;
  const fullName = buildFullName(data.firstName, data.lastName) || email;

  return {
    id: data.id,
    email,
    full_name: fullName,
    role: coerceRole(publicMetadata?.role),
    department_id: pickString(publicMetadata?.department_id) || null,
  };
}

async function upsertClerkUser(prisma, user) {
  return prisma.users.upsert({
    where: { id: user.id },
    update: {
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      department_id: user.department_id,
    },
    create: user,
  });
}

const envFile = process.env.CLERK_BACKFILL_ENV_FILE || DEFAULT_ENV_FILE;
const outputPath = process.env.CLERK_BACKFILL_OUTPUT || DEFAULT_OUTPUT;
const limit = Number(process.env.CLERK_BACKFILL_LIMIT || 100);
const apply = process.env.CLERK_BACKFILL_APPLY === '1';
const fileEnv = await loadEnv(envFile);

const secretKey = process.env.CLERK_SECRET_KEY || fileEnv.CLERK_SECRET_KEY || '';
const publishableKey =
  process.env.CLERK_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  fileEnv.CLERK_PUBLISHABLE_KEY ||
  fileEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  '';
const databaseUrl = process.env.DATABASE_URL || fileEnv.DATABASE_URL || '';
const directUrl = process.env.DIRECT_URL || fileEnv.DIRECT_URL || '';

if (!secretKey || !publishableKey) {
  throw new Error('Missing Clerk secret/publishable key');
}

const artifact = {
  generatedAt: new Date().toISOString(),
  envFile: path.relative(projectRoot, envFile),
  dryRun: !apply,
  limit,
  summary: {
    fetchedCount: 0,
    normalizedCount: 0,
    missingDepartmentCount: 0,
    roleBreakdown: {},
    appliedCount: 0,
    failedCount: 0,
  },
  sample: [],
  errors: [],
  conclusions: [],
};

const clerk = createClerkClient({
  secretKey,
  publishableKey,
});

const response = await clerk.users.getUserList({
  limit,
  orderBy: '-created_at',
});

const normalizedUsers = response.data.map((user) =>
  normalizeClerkUserForDb({
    id: user.id,
    emailAddresses: user.emailAddresses.map((entry) => ({
      emailAddress: entry.emailAddress,
    })),
    firstName: user.firstName,
    lastName: user.lastName,
    publicMetadata:
      user.publicMetadata && typeof user.publicMetadata === 'object'
        ? user.publicMetadata
        : null,
  }),
);

artifact.summary.fetchedCount = response.data.length;
artifact.summary.normalizedCount = normalizedUsers.length;
artifact.summary.missingDepartmentCount = normalizedUsers.filter((user) => !user.department_id).length;
artifact.summary.roleBreakdown = buildRoleBreakdown(normalizedUsers);
artifact.sample = normalizedUsers.slice(0, 10).map((user) => ({
  id: user.id,
  role: user.role,
  hasDepartmentId: Boolean(user.department_id),
}));

if (apply) {
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL for apply mode');
  }

  process.env.DATABASE_URL = databaseUrl;
  if (directUrl) {
    process.env.DIRECT_URL = directUrl;
  }

  const prisma = new PrismaClient();
  try {
    for (const user of normalizedUsers) {
      try {
        await upsertClerkUser(prisma, user);
        artifact.summary.appliedCount += 1;
      } catch (error) {
        artifact.summary.failedCount += 1;
        artifact.errors.push({
          userId: user.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

artifact.conclusions.push(
  apply
    ? 'Apply mode attempted to upsert Clerk users into public.users.'
    : 'Dry-run mode only normalized Clerk users and did not write to the database.',
);
artifact.conclusions.push(
  `Fetched ${artifact.summary.fetchedCount} Clerk users and normalized ${artifact.summary.normalizedCount}.`,
);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(artifact, null, 2));
