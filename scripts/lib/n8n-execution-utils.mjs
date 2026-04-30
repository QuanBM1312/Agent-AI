import { readFile } from 'node:fs/promises';

export function parseCookieJar(text) {
  const pairs = [];

  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const columns = trimmed.split('\t');
    if (columns.length >= 7) {
      const [, , , , , name, value] = columns;
      pairs.push(`${name}=${value}`);
      continue;
    }

    if (trimmed.startsWith('#') && !trimmed.startsWith('#HttpOnly_')) {
      continue;
    }

    const first = trimmed.split(';')[0];
    if (first.includes('=')) {
      pairs.push(first);
    }
  }

  return pairs.join('; ');
}

export async function loadCookieHeader(cookieFile) {
  try {
    return parseCookieJar(await readFile(cookieFile, 'utf8'));
  } catch {
    return '';
  }
}

export async function fetchExecution(baseUrl, executionId, cookieHeader) {
  const response = await fetch(`${baseUrl}/rest/executions/${executionId}`, {
    headers: {
      accept: 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch execution ${executionId}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function fetchExecutionList(baseUrl, workflowId, cookieHeader, limit = 100) {
  const url = new URL(`${baseUrl}/rest/executions`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('filter', JSON.stringify({ workflowId }));

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch execution list for workflow ${workflowId}: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  return payload?.data?.results || [];
}

function isReferenceString(value) {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function resolveFlatted(node, table, memo) {
  if (isReferenceString(node)) {
    const index = Number.parseInt(node, 10);
    if (index >= 0 && index < table.length) {
      if (memo.has(index)) {
        return memo.get(index);
      }

      memo.set(index, null);
      const resolved = resolveFlatted(table[index], table, memo);
      memo.set(index, resolved);
      return resolved;
    }
  }

  if (Array.isArray(node)) {
    return node.map((entry) => resolveFlatted(entry, table, memo));
  }

  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, resolveFlatted(value, table, memo)]),
    );
  }

  return node;
}

export function parseExecutionPayload(raw) {
  const execution = raw.data || raw;
  const serialized =
    typeof execution.data === 'string'
      ? execution.data
      : execution.data?.data;

  if (typeof serialized !== 'string') {
    throw new Error('Execution payload does not contain a flatted data.data string.');
  }

  const table = JSON.parse(serialized);
  const parsed = resolveFlatted(table[0], table, new Map());
  return {
    meta: execution,
    parsed,
  };
}

export function toMs(dateString) {
  const value = Date.parse(dateString || '');
  return Number.isFinite(value) ? value : null;
}

function summarizeNodeRuns(runData, workflowStartMs) {
  return Object.entries(runData)
    .map(([name, runs]) => {
      const totalExecutionMs = runs.reduce((sum, run) => sum + (run.executionTime || 0), 0);
      const firstStartMs = Math.min(...runs.map((run) => run.startTime || Number.POSITIVE_INFINITY));
      const lastEndMs = Math.max(...runs.map((run) => (run.startTime || 0) + (run.executionTime || 0)));

      return {
        name,
        count: runs.length,
        totalExecutionMs,
        firstStartMs,
        lastEndMs,
        relativeStartMs:
          workflowStartMs == null || !Number.isFinite(firstStartMs) ? null : firstStartMs - workflowStartMs,
        relativeEndMs:
          workflowStartMs == null || !Number.isFinite(lastEndMs) ? null : lastEndMs - workflowStartMs,
        executionStatuses: [...new Set(runs.map((run) => run.executionStatus || 'unknown'))],
      };
    })
    .sort((left, right) => left.firstStartMs - right.firstStartMs);
}

export function summarizeExecution(label, raw) {
  const { meta, parsed } = parseExecutionPayload(raw);
  const startedAtMs = toMs(meta.startedAt);
  const stoppedAtMs = toMs(meta.stoppedAt);
  const durationMs =
    startedAtMs == null || stoppedAtMs == null
      ? null
      : Math.max(0, stoppedAtMs - startedAtMs);
  const runData = parsed.resultData?.runData || {};
  const nodes = summarizeNodeRuns(runData, startedAtMs);
  const slowestNode = [...nodes].sort((left, right) => right.totalExecutionMs - left.totalExecutionMs)[0] || null;

  return {
    label,
    executionId: String(meta.id),
    workflowId: meta.workflowId || null,
    workflowName: meta.workflowData?.name || meta.workflowName || null,
    status: meta.status || null,
    startedAt: meta.startedAt || null,
    stoppedAt: meta.stoppedAt || null,
    durationMs,
    lastNodeExecuted: parsed.resultData?.lastNodeExecuted || null,
    nodeCount: nodes.length,
    slowestNode,
    nodes,
  };
}

export function buildOverlapSummary(mainExecution, subExecution, appDurationMs) {
  if (!mainExecution || !subExecution) return null;
  if (mainExecution.durationMs == null || subExecution.durationMs == null) return null;

  const mainStart = toMs(mainExecution.startedAt);
  const mainStop = toMs(mainExecution.stoppedAt);
  const subStart = toMs(subExecution.startedAt);
  const subStop = toMs(subExecution.stoppedAt);

  if ([mainStart, mainStop, subStart, subStop].some((value) => value == null)) {
    return null;
  }

  const overlapMs = Math.max(0, Math.min(mainStop, subStop) - Math.max(mainStart, subStart));
  return {
    overlapMs,
    mainExclusiveMs: Math.max(0, mainExecution.durationMs - overlapMs),
    appOutsideMainMs:
      Number.isFinite(appDurationMs) && appDurationMs > 0
        ? Math.max(0, appDurationMs - mainExecution.durationMs)
        : null,
    mainDominantNode: mainExecution.slowestNode,
    subworkflowDominantNode: subExecution.slowestNode,
  };
}
