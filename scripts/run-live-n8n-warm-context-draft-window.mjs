#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCookieHeader,
  fetchExecution,
  fetchExecutionList,
  parseExecutionPayload,
} from './lib/n8n-execution-utils.mjs';
import {
  fetchWorkflow,
  activateWorkflowVersion,
  summarizeWorkflow,
  extractChatTrigger,
} from './lib/live-n8n-workflow-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_BASE_URL = 'https://primary-production-79be44.up.railway.app';
const DEFAULT_COOKIE_FILE = '/tmp/n8n_live.cookie';
const DEFAULT_MAIN_WORKFLOW_ID = '7Lq2tknqGOVcdAvm';
const DEFAULT_SUB_WORKFLOW_ID = 'awr_01MNmP2mUsOIoEkjq';
const DEFAULT_OUTPUT = path.join(
  projectRoot,
  'docs',
  'artifacts',
  'live-n8n',
  'warm-context-draft-window.json',
);
const DEFAULT_TURN_ONE =
  'Kiểm tra tình trạng dữ liệu nội bộ hiện có và trả lời ngắn gọn, tập trung vào trạng thái hiện tại.';
const DEFAULT_TURN_TWO =
  'Từ đúng ngữ cảnh nội bộ vừa dùng, nêu thêm 2 chi tiết quan trọng nhưng vẫn ngắn gọn.';

const baseUrl = (process.env.LIVE_N8N_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const cookieFile = process.env.LIVE_N8N_COOKIE_FILE || DEFAULT_COOKIE_FILE;
const mainWorkflowId = process.env.LIVE_N8N_MAIN_WORKFLOW_ID || DEFAULT_MAIN_WORKFLOW_ID;
const subWorkflowId = process.env.LIVE_N8N_SUB_WORKFLOW_ID || DEFAULT_SUB_WORKFLOW_ID;
const outputPath = process.env.LIVE_N8N_WARM_CONTEXT_WINDOW_OUTPUT || DEFAULT_OUTPUT;
const shouldApply =
  process.argv.includes('--apply') ||
  process.env.LIVE_N8N_APPLY === '1' ||
  process.env.LIVE_N8N_APPLY === 'true';
const keepActive =
  process.argv.includes('--keep-active') ||
  process.env.LIVE_N8N_KEEP_ACTIVE === '1' ||
  process.env.LIVE_N8N_KEEP_ACTIVE === 'true';
const turnOnePrompt = process.env.WARM_CONTEXT_TURN_ONE || DEFAULT_TURN_ONE;
const turnTwoPrompt = process.env.WARM_CONTEXT_TURN_TWO || DEFAULT_TURN_TWO;
const sessionId = process.env.WARM_CONTEXT_SESSION_ID || `warm_ctx_${Date.now()}`;

function printHelp() {
  console.log(`Usage:
  npm run eval:live:n8n:warm-context-window
  npm run eval:live:n8n:warm-context-window -- --apply
  LIVE_N8N_APPLY=1 npm run eval:live:n8n:warm-context-window

Optional env:
  LIVE_N8N_BASE_URL                    override the live n8n base URL
  LIVE_N8N_COOKIE_FILE                 Netscape-format cookie jar for authenticated /rest/* access
  LIVE_N8N_MAIN_WORKFLOW_ID            override the main workflow id
  LIVE_N8N_SUB_WORKFLOW_ID             override the Search_Agent0 workflow id
  LIVE_N8N_WARM_CONTEXT_WINDOW_OUTPUT  override the summary artifact path
  LIVE_N8N_APPLY=1                     activate the draft versions temporarily
  LIVE_N8N_KEEP_ACTIVE=1               skip rollback in finally (not recommended)
  WARM_CONTEXT_TURN_ONE                override first-turn prompt
  WARM_CONTEXT_TURN_TWO                override second-turn prompt
  WARM_CONTEXT_SESSION_ID              override chat session id

Behavior:
  - dry-run by default
  - when apply=true:
    1. activate Search_Agent0 draft version
    2. activate main workflow draft version
    3. send turn 1 to the n8n chat webhook
    4. fetch the matching execution and extract context_id
    5. send turn 2 with agent0_context_id reused
    6. fetch the second execution and compare durations
    7. rollback both workflows to their original active versions unless keep-active=true
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

async function postChatTurn(url, payload) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const completedAt = new Date().toISOString();
  const text = await response.text();

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    startedAt,
    completedAt,
    durationMs: Date.now() - startedMs,
    status: response.status,
    ok: response.ok,
    payload,
    responsePreview: text.slice(0, 800),
    responseJson: json,
  };
}

function extractTriggerInput(parsed) {
  return (
    parsed?.resultData?.runData?.['When chat message received']?.[0]?.data?.main?.[0]?.[0]?.json ||
    null
  );
}

function extractCallNodeOutput(parsed) {
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

async function findExecutionBySession(workflowId, targetSessionId, cookieHeader, startedAfterMs) {
  const executions = await fetchExecutionList(baseUrl, workflowId, cookieHeader, 20);

  for (const execution of executions) {
    const executionStartedMs = Date.parse(execution.startedAt || '');
    if (Number.isFinite(startedAfterMs) && Number.isFinite(executionStartedMs) && executionStartedMs < startedAfterMs) {
      continue;
    }

    const raw = await fetchExecution(baseUrl, String(execution.id), cookieHeader);
    const { meta, parsed } = parseExecutionPayload(raw);
    const triggerInput = extractTriggerInput(parsed);

    if (triggerInput?.sessionId === targetSessionId) {
      return {
        executionId: String(meta.id),
        startedAt: meta.startedAt || null,
        stoppedAt: meta.stoppedAt || null,
        status: meta.status || null,
        triggerInput,
        buildSupervisorContext: extractBuildSupervisorContext(parsed),
        callSearchAgent0Output: extractCallNodeOutput(parsed),
      };
    }
  }

  return null;
}

function requireDraftVersion(workflow, label) {
  if (!workflow.versionId) {
    throw new Error(`${label} is missing versionId.`);
  }
  if (!workflow.activeVersionId) {
    throw new Error(`${label} is missing activeVersionId.`);
  }
  if (workflow.versionId === workflow.activeVersionId) {
    throw new Error(
      `${label} does not have a draft version separate from activeVersionId. Re-run the draft patch step first.`,
    );
  }
  return workflow.versionId;
}

async function writeArtifact(summary) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

const summary = {
  generatedAt: new Date().toISOString(),
  mode: shouldApply ? 'apply' : 'dry-run',
  baseUrl,
  cookieFile,
  keepActive,
  sessionId,
  prompts: {
    turnOne: turnOnePrompt,
    turnTwo: turnTwoPrompt,
  },
  workflows: {},
  chatTrigger: null,
  turns: [],
  conclusions: [],
};

let cookieHeader = '';
let mainBefore = null;
let subBefore = null;
let rollbackTargets = null;
let shouldRollback = false;

try {
  cookieHeader = await loadCookieHeader(cookieFile);
  if (!cookieHeader) {
    throw new Error(`Could not load an authenticated cookie header from ${cookieFile}.`);
  }

  mainBefore = await fetchWorkflow(baseUrl, mainWorkflowId, cookieHeader);
  subBefore = await fetchWorkflow(baseUrl, subWorkflowId, cookieHeader);

  summary.workflows.main = { before: summarizeWorkflow(mainBefore) };
  summary.workflows.sub = { before: summarizeWorkflow(subBefore) };

  const mainDraftVersionId = requireDraftVersion(mainBefore, 'Main workflow');
  const subDraftVersionId = requireDraftVersion(subBefore, 'Search_Agent0 workflow');

  summary.workflows.main.draftVersionId = mainDraftVersionId;
  summary.workflows.sub.draftVersionId = subDraftVersionId;
  summary.chatTrigger = extractChatTrigger(baseUrl, mainBefore);

  if (!shouldApply) {
    summary.conclusions.push('Dry-run only. No activation or chat execution was performed.');
    summary.conclusions.push('Both workflows have a separate draft version ready for a temporary warm-context eval window.');
    await writeArtifact(summary);
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  rollbackTargets = {
    main: mainBefore.activeVersionId,
    sub: subBefore.activeVersionId,
  };
  shouldRollback = !keepActive;

  await activateWorkflowVersion(baseUrl, subWorkflowId, subDraftVersionId, cookieHeader);
  await activateWorkflowVersion(baseUrl, mainWorkflowId, mainDraftVersionId, cookieHeader);

  const mainDuring = await fetchWorkflow(baseUrl, mainWorkflowId, cookieHeader);
  const subDuring = await fetchWorkflow(baseUrl, subWorkflowId, cookieHeader);
  summary.workflows.main.during = summarizeWorkflow(mainDuring);
  summary.workflows.sub.during = summarizeWorkflow(subDuring);

  const firstTurn = await postChatTurn(summary.chatTrigger.url, {
    action: 'sendMessage',
    sessionId,
    chatInput: turnOnePrompt,
  });
  summary.turns.push({
    turn: 1,
    request: {
      sessionId,
      chatInput: turnOnePrompt,
    },
    response: {
      status: firstTurn.status,
      ok: firstTurn.ok,
      durationMs: firstTurn.durationMs,
      startedAt: firstTurn.startedAt,
      completedAt: firstTurn.completedAt,
      preview: firstTurn.responsePreview,
    },
  });

  if (!firstTurn.ok) {
    throw new Error(`Turn 1 chat webhook failed with status ${firstTurn.status}.`);
  }

  const turnOneExecution = await findExecutionBySession(
    mainWorkflowId,
    sessionId,
    cookieHeader,
    Date.parse(firstTurn.startedAt) - 5000,
  );
  if (!turnOneExecution) {
    throw new Error('Could not find the matching n8n execution for turn 1.');
  }

  const reusedContextId = turnOneExecution.callSearchAgent0Output?.context_id || null;
  summary.turns[0].execution = turnOneExecution;
  summary.turns[0].response.output = firstTurn.responseJson?.output || null;
  summary.turns[0].reusedContextId = reusedContextId;

  if (!reusedContextId) {
    throw new Error('Turn 1 completed, but no context_id was found in Call Search_Agent0 output.');
  }

  const secondTurn = await postChatTurn(summary.chatTrigger.url, {
    action: 'sendMessage',
    sessionId,
    chatInput: turnTwoPrompt,
    agent0_context_id: reusedContextId,
  });
  summary.turns.push({
    turn: 2,
    request: {
      sessionId,
      chatInput: turnTwoPrompt,
      agent0_context_id: reusedContextId,
    },
    response: {
      status: secondTurn.status,
      ok: secondTurn.ok,
      durationMs: secondTurn.durationMs,
      startedAt: secondTurn.startedAt,
      completedAt: secondTurn.completedAt,
      preview: secondTurn.responsePreview,
    },
  });

  if (!secondTurn.ok) {
    throw new Error(`Turn 2 chat webhook failed with status ${secondTurn.status}.`);
  }

  const turnTwoExecution = await findExecutionBySession(
    mainWorkflowId,
    sessionId,
    cookieHeader,
    Date.parse(secondTurn.startedAt) - 5000,
  );
  if (!turnTwoExecution) {
    throw new Error('Could not find the matching n8n execution for turn 2.');
  }

  summary.turns[1].execution = turnTwoExecution;
  summary.turns[1].response.output = secondTurn.responseJson?.output || null;

  const firstTurnDuration = firstTurn.durationMs;
  const secondTurnDuration = secondTurn.durationMs;

  summary.comparison = {
    firstTurnDurationMs: firstTurnDuration,
    secondTurnDurationMs: secondTurnDuration,
    deltaMs: secondTurnDuration - firstTurnDuration,
    warmFaster: secondTurnDuration < firstTurnDuration,
    turnOneBuildSupervisorContextAgent0ContextId:
      turnOneExecution.buildSupervisorContext?.agent0_context_id || '',
    turnTwoBuildSupervisorContextAgent0ContextId:
      turnTwoExecution.buildSupervisorContext?.agent0_context_id || '',
  };

  summary.conclusions.push('Activated both draft versions temporarily and exercised the n8n chat trigger directly.');
  summary.conclusions.push(
    `Turn 1 produced context_id ${reusedContextId}; turn 2 reused it via agent0_context_id.`,
  );
  summary.conclusions.push(
    summary.comparison.warmFaster
      ? `Warm turn was faster by ${Math.abs(summary.comparison.deltaMs)}ms.`
      : `Warm turn was not faster; delta was ${summary.comparison.deltaMs}ms.`,
  );
} catch (error) {
  summary.error = error instanceof Error ? error.message : String(error);
  summary.conclusions.push('Warm-context draft window did not complete successfully.');
  throw error;
} finally {
  if (shouldRollback && rollbackTargets && cookieHeader) {
    const rollbackNotes = [];

    try {
      await activateWorkflowVersion(baseUrl, mainWorkflowId, rollbackTargets.main, cookieHeader);
      rollbackNotes.push(`Rolled main workflow back to ${rollbackTargets.main}.`);
    } catch (error) {
      rollbackNotes.push(
        `Failed to roll main workflow back to ${rollbackTargets.main}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      await activateWorkflowVersion(baseUrl, subWorkflowId, rollbackTargets.sub, cookieHeader);
      rollbackNotes.push(`Rolled Search_Agent0 back to ${rollbackTargets.sub}.`);
    } catch (error) {
      rollbackNotes.push(
        `Failed to roll Search_Agent0 back to ${rollbackTargets.sub}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      const mainAfterRollback = await fetchWorkflow(baseUrl, mainWorkflowId, cookieHeader);
      const subAfterRollback = await fetchWorkflow(baseUrl, subWorkflowId, cookieHeader);
      summary.workflows.main.afterRollback = summarizeWorkflow(mainAfterRollback);
      summary.workflows.sub.afterRollback = summarizeWorkflow(subAfterRollback);
    } catch (error) {
      rollbackNotes.push(
        `Failed to refetch workflow states after rollback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    summary.rollback = {
      performed: true,
      notes: rollbackNotes,
    };
  } else {
    summary.rollback = {
      performed: false,
      notes: keepActive ? ['keep-active=true skipped rollback.'] : ['No rollback was needed.'],
    };
  }

  await writeArtifact(summary);
  console.log(JSON.stringify(summary, null, 2));
}
