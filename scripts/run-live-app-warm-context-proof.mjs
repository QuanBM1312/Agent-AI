#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClerkClient } from '@clerk/backend';
import {
  loadCookieHeader,
  fetchExecution,
  fetchExecutionList,
  parseExecutionPayload,
} from './lib/n8n-execution-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_APP_BASE_URL = 'https://aioperation.dieuhoathanglong.com.vn';
const DEFAULT_ENV_FILE = path.join(projectRoot, '.vercel', '.env.production.local');
const DEFAULT_OUTPUT_PATH = path.join(
  projectRoot,
  'docs',
  'artifacts',
  'chat-eval',
  'live-warm-context-app-proof.json',
);
const DEFAULT_N8N_BASE_URL = 'https://primary-production-79be44.up.railway.app';
const DEFAULT_N8N_COOKIE_FILE = '/tmp/n8n_live.cookie';
const DEFAULT_N8N_MAIN_WORKFLOW_ID = '7Lq2tknqGOVcdAvm';
const DEFAULT_MESSAGES = [
  'Kiểm tra tình trạng dữ liệu nội bộ hiện có và trả lời ngắn gọn.',
  'Từ cùng ngữ cảnh trước đó, nêu thêm 2 điểm chi tiết quan trọng.',
];

const args = new Set(process.argv.slice(2));

if (args.has('--help')) {
  console.log(`Usage:
  npm run eval:chat:chain:live:disposable

Environment variables:
  CHAT_EVAL_BASE_URL          App base URL. Default: ${DEFAULT_APP_BASE_URL}
  CHAT_CHAIN_ENV_FILE         Env file used to load Clerk keys if not already present.
                              Default: ${path.relative(projectRoot, DEFAULT_ENV_FILE)}
  CHAT_CHAIN_OUTPUT           Output artifact path.
                              Default: docs/artifacts/chat-eval/live-warm-context-app-proof.json
  CHAT_CHAIN_MESSAGES         JSON array of prompts. Default: built-in 2-turn warm-context proof.
  CLERK_SECRET_KEY            Clerk secret key. Optional when present in env file.
  CLERK_PUBLISHABLE_KEY       Clerk publishable key. Optional when present in env file.
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
                              Alternate publishable key env name.
  LIVE_N8N_BASE_URL           Live n8n base URL for execution correlation.
                              Default: ${DEFAULT_N8N_BASE_URL}
  LIVE_N8N_COOKIE_FILE        Authenticated n8n cookie jar for /rest/executions fetches.
                              Default: ${DEFAULT_N8N_COOKIE_FILE}
  LIVE_N8N_MAIN_WORKFLOW_ID   Main workflow id used for matching executions.
                              Default: ${DEFAULT_N8N_MAIN_WORKFLOW_ID}
`);
  process.exit(0);
}

function normalizeBaseUrl(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function parseEnvFile(content) {
  const entries = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}

async function loadEnvFile(envFile) {
  try {
    const content = await fs.readFile(envFile, 'utf8');
    return parseEnvFile(content);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
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

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(`${command} ${commandArgs.join(' ')} failed with code ${code}\n${stderr || stdout}`),
      );
    });
  });
}

function buildDisposableCredentials() {
  const nonce = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  return {
    email: `warm-context-proof-${nonce}@example.com`,
    password: `WarmCtx!${crypto.randomBytes(12).toString('base64url')}9`,
  };
}

function extractTriggerInput(parsed) {
  return (
    parsed?.resultData?.runData?.['When chat message received']?.[0]?.data?.main?.[0]?.[0]?.json ||
    null
  );
}

function extractCallSearchAgent0Output(parsed) {
  return (
    parsed?.resultData?.runData?.["Call 'Tool - Search_Agent0'2"]?.[0]?.data?.main?.[0]?.[0]?.json ||
    null
  );
}

function extractBuildSupervisorContext(parsed) {
  return (
    parsed?.resultData?.runData?.['Build Supervisor Context']?.[0]?.data?.main?.[0]?.[0]?.json ||
    null
  );
}

async function findExecutionBySession({
  baseUrl,
  workflowId,
  cookieHeader,
  targetSessionId,
  targetClientMessageId,
  startedAfterMs,
}) {
  const executions = await fetchExecutionList(baseUrl, workflowId, cookieHeader, 30);

  for (const execution of executions) {
    const executionStartedMs = Date.parse(execution.startedAt || '');
    if (Number.isFinite(startedAfterMs) && Number.isFinite(executionStartedMs) && executionStartedMs < startedAfterMs) {
      continue;
    }

    const raw = await fetchExecution(baseUrl, String(execution.id), cookieHeader);
    const { meta, parsed } = parseExecutionPayload(raw);
    const triggerInput = extractTriggerInput(parsed);

    if (
      triggerInput?.sessionId === targetSessionId &&
      (!targetClientMessageId || triggerInput?.clientMessageId === targetClientMessageId)
    ) {
      return {
        executionId: String(meta.id),
        startedAt: meta.startedAt || null,
        stoppedAt: meta.stoppedAt || null,
        status: meta.status || null,
        triggerInput,
        buildSupervisorContext: extractBuildSupervisorContext(parsed),
        callSearchAgent0Output: extractCallSearchAgent0Output(parsed),
      };
    }
  }

  return null;
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.env.CHAT_EVAL_BASE_URL || DEFAULT_APP_BASE_URL);
  const envFile = process.env.CHAT_CHAIN_ENV_FILE || DEFAULT_ENV_FILE;
  const outputPath = process.env.CHAT_CHAIN_OUTPUT || DEFAULT_OUTPUT_PATH;
  const liveN8nBaseUrl = normalizeBaseUrl(process.env.LIVE_N8N_BASE_URL || DEFAULT_N8N_BASE_URL);
  const liveN8nCookieFile = process.env.LIVE_N8N_COOKIE_FILE || DEFAULT_N8N_COOKIE_FILE;
  const liveN8nMainWorkflowId =
    process.env.LIVE_N8N_MAIN_WORKFLOW_ID || DEFAULT_N8N_MAIN_WORKFLOW_ID;
  const fileEnv = await loadEnvFile(envFile);

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
    throw new Error('Missing Clerk secret/publishable key for disposable live proof');
  }
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL for disposable live proof');
  }

  process.env.DATABASE_URL = databaseUrl;
  if (directUrl) {
    process.env.DIRECT_URL = directUrl;
  }

  let messages = DEFAULT_MESSAGES;
  if (process.env.CHAT_CHAIN_MESSAGES) {
    const parsed = JSON.parse(process.env.CHAT_CHAIN_MESSAGES);
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
      throw new Error('CHAT_CHAIN_MESSAGES must be a JSON array of strings');
    }
    messages = parsed;
  }

  const clerk = createClerkClient({
    secretKey,
    publishableKey,
  });
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  const disposable = buildDisposableCredentials();
  let createdUserId = null;
  let deletedUser = false;
  let deletedDatabaseUser = false;
  let artifact = null;
  let databaseBootstrap = {
    attempted: false,
    ok: false,
    error: null,
  };

  try {
    const createdUser = await clerk.users.createUser({
      emailAddress: [disposable.email],
      password: disposable.password,
      skipPasswordChecks: true,
      skipPasswordRequirement: false,
      skipLegalChecks: true,
      firstName: 'Warm',
      lastName: 'Context Proof',
      publicMetadata: {
        role: 'NOT_ASSIGN',
      },
    });
    createdUserId = createdUser.id;

    databaseBootstrap.attempted = true;
    try {
      await prisma.users.upsert({
        where: { id: createdUser.id },
        update: {
          email: disposable.email,
          full_name: 'Warm Context Proof',
          role: 'NOT_ASSIGN',
        },
        create: {
          id: createdUser.id,
          email: disposable.email,
          full_name: 'Warm Context Proof',
          role: 'NOT_ASSIGN',
        },
      });
      databaseBootstrap.ok = true;
    } catch (error) {
      databaseBootstrap.error = error instanceof Error ? error.message : String(error);
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    await run('node', [path.join(projectRoot, 'scripts', 'run-chat-session-chain-eval.mjs')], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CHAT_EVAL_BASE_URL: baseUrl,
        CHAT_EVAL_EMAIL: disposable.email,
        CHAT_EVAL_PASSWORD: disposable.password,
        CHAT_CHAIN_MESSAGES: JSON.stringify(messages),
        CHAT_CHAIN_OUTPUT: outputPath,
      },
    });

    const rawArtifact = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    const n8nCookieHeader = await loadCookieHeader(liveN8nCookieFile);
    const firstTurn = rawArtifact.results[0] || null;
    const secondTurn = rawArtifact.results[1] || null;
    const firstTurnExecution =
      firstTurn?.startedAt
        ? await findExecutionBySession({
            baseUrl: liveN8nBaseUrl,
            workflowId: liveN8nMainWorkflowId,
            cookieHeader: n8nCookieHeader,
            targetSessionId: rawArtifact.sessionId,
            targetClientMessageId: firstTurn.clientMessageId,
            startedAfterMs: Date.parse(firstTurn.startedAt) - 5000,
          })
        : null;
    const secondTurnExecution =
      secondTurn?.startedAt
        ? await findExecutionBySession({
            baseUrl: liveN8nBaseUrl,
            workflowId: liveN8nMainWorkflowId,
            cookieHeader: n8nCookieHeader,
            targetSessionId: rawArtifact.sessionId,
            targetClientMessageId: secondTurn.clientMessageId,
            startedAfterMs: Date.parse(secondTurn.startedAt) - 5000,
          })
        : null;
    const reusedContextId = firstTurnExecution?.callSearchAgent0Output?.context_id || null;
    const forwardedContextId =
      secondTurnExecution?.buildSupervisorContext?.agent0_context_id || null;
    const turnDurations = rawArtifact.results.map((result) => result.durationMs);
    const firstTurnDurationMs = rawArtifact.results[0]?.durationMs ?? null;
    const secondTurnDurationMs = rawArtifact.results[1]?.durationMs ?? null;
    const warmDeltaMs =
      typeof firstTurnDurationMs === 'number' && typeof secondTurnDurationMs === 'number'
        ? secondTurnDurationMs - firstTurnDurationMs
        : null;

    artifact = {
      ...rawArtifact,
      proof: {
        baseUrl,
        turnDurations,
        firstTurnDurationMs,
        secondTurnDurationMs,
        warmDeltaMs,
        warmFaster: typeof warmDeltaMs === 'number' ? warmDeltaMs < 0 : false,
        latestAssistantHasAgent0ContextId:
          rawArtifact.summary?.latestAssistantHasAgent0ContextId === true,
        n8n: {
          baseUrl: liveN8nBaseUrl,
          mainWorkflowId: liveN8nMainWorkflowId,
          firstTurnExecution,
          secondTurnExecution,
          reusedContextId,
          forwardedContextId,
          warmContextObserved:
            typeof reusedContextId === 'string' &&
            reusedContextId.length > 0 &&
            reusedContextId === forwardedContextId,
        },
      },
      cleanup: {
        disposableUserDeleted: false,
        databaseUserDeleted: false,
      },
      diagnostics: {
        databaseBootstrap,
      },
    };
  } finally {
    if (createdUserId && databaseBootstrap.ok) {
      try {
        await prisma.users.delete({
          where: { id: createdUserId },
        });
        deletedDatabaseUser = true;
      } catch (error) {
        if (artifact) {
          artifact.cleanup.databaseDeleteError =
            error instanceof Error ? error.message : String(error);
        }
      }
    }

    if (createdUserId) {
      try {
        await clerk.users.deleteUser(createdUserId);
        deletedUser = true;
      } catch (error) {
        if (artifact) {
          artifact.cleanup.deleteError =
            error instanceof Error ? error.message : String(error);
        }
      }
    }

    if (artifact) {
      artifact.cleanup.disposableUserDeleted = deletedUser;
      artifact.cleanup.databaseUserDeleted = deletedDatabaseUser;
      await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    }

    await prisma.$disconnect();
  }

  if (!artifact) {
    throw new Error('Failed to produce warm-context app proof artifact');
  }

  if (artifact.summary?.failureCount > 0) {
    throw new Error(`Live app warm-context proof recorded ${artifact.summary.failureCount} failed turns`);
  }

  if (
    !artifact.proof?.latestAssistantHasAgent0ContextId &&
    artifact.proof?.n8n?.warmContextObserved !== true
  ) {
    throw new Error(
      'Live app warm-context proof did not show persisted/forwarded agent0 context in either chat messages or n8n execution data',
    );
  }

  if (!artifact.cleanup?.disposableUserDeleted) {
    throw new Error('Disposable Clerk user cleanup did not complete');
  }
  if (artifact.diagnostics?.databaseBootstrap?.ok && !artifact.cleanup?.databaseUserDeleted) {
    throw new Error('Disposable database user cleanup did not complete');
  }

  console.log(JSON.stringify(artifact, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
