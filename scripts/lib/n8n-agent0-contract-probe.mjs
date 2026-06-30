export const DEFAULT_MAIN_CALLER_NAME = "Call 'Tool - Search_Agent0'2";
export const DEFAULT_TRIGGER_NAME = 'When Executed by Another Workflow';
export const REQUIRED_AGENT0_FIELDS = [
  'files_context',
  'source_plan',
  'candidate_files',
  'answer_contract',
];
export const DEFAULT_N8N_COOKIE_FILE = '/tmp/n8n_live.cookie';

export function unwrapN8nPayload(payload) {
  return payload?.data || payload;
}

export function buildCredentialDiagnostics({
  env = process.env,
  cookieFile = DEFAULT_N8N_COOKIE_FILE,
  cookieHeader = '',
} = {}) {
  const n8nApiUrlSet = Boolean(env.N8N_API_URL);
  const n8nApiKeySet = Boolean(env.N8N_API_KEY);
  const liveN8nBaseUrlSet = Boolean(env.LIVE_N8N_BASE_URL);
  const cookieFileEnvSet = Boolean(env.LIVE_N8N_COOKIE_FILE);
  const cookieLoaded = Boolean(cookieHeader);
  const hasBaseUrl = n8nApiUrlSet || liveN8nBaseUrlSet;
  const hasAuth = n8nApiKeySet || cookieLoaded;
  const missing = [];

  if (!hasBaseUrl) {
    missing.push('N8N_API_URL or LIVE_N8N_BASE_URL');
  }

  if (!hasAuth) {
    missing.push(`N8N_API_KEY or readable LIVE_N8N_COOKIE_FILE (${cookieFile})`);
  }

  return {
    ok: hasBaseUrl && hasAuth,
    authMode: n8nApiKeySet ? 'api_key' : cookieLoaded ? 'cookie' : null,
    missing,
    env: {
      N8N_API_URL: n8nApiUrlSet ? 'set' : 'missing',
      N8N_API_KEY: n8nApiKeySet ? 'set' : 'missing',
      LIVE_N8N_BASE_URL: liveN8nBaseUrlSet ? 'set' : 'missing',
      LIVE_N8N_COOKIE_FILE: cookieFileEnvSet ? 'set' : 'missing',
    },
    cookie: {
      path: cookieFile,
      loaded: cookieLoaded,
    },
  };
}

export function formatCredentialDiagnostics(diagnostics) {
  const missing = diagnostics.missing.length > 0
    ? diagnostics.missing.join('; ')
    : 'none';

  return [
    'n8n contract probe cannot run without live management access.',
    `Missing: ${missing}.`,
    `Env status: N8N_API_URL=${diagnostics.env.N8N_API_URL}, N8N_API_KEY=${diagnostics.env.N8N_API_KEY}, LIVE_N8N_BASE_URL=${diagnostics.env.LIVE_N8N_BASE_URL}, LIVE_N8N_COOKIE_FILE=${diagnostics.env.LIVE_N8N_COOKIE_FILE}.`,
    `Cookie status: ${diagnostics.cookie.loaded ? 'loaded' : 'not loaded'} from ${diagnostics.cookie.path}.`,
    'Provide N8N_API_URL + N8N_API_KEY, or LIVE_N8N_BASE_URL + a valid LIVE_N8N_COOKIE_FILE.',
  ].join('\n');
}

export function classifyProbeFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  const status = error?.status || Number(message.match(/\b(401|403|404)\b/)?.[1] || 0) || null;
  const apiPath = error?.apiPath || message.match(/n8n (?:API|REST) ([^ ]+) failed/)?.[1] || null;

  if (status === 401 || status === 403) {
    return {
      kind: 'credential_invalid',
      message:
        '401/403: n8n credential is invalid, expired, or not a management/public API key. Create a fresh n8n API key in the n8n UI, or provide a valid authenticated cookie file.',
    };
  }

  if (status === 404 && apiPath === '/api/v1/workflows') {
    return {
      kind: 'api_workflows_not_found',
      message:
        '404 on /api/v1/workflows: base URL is not the n8n public API origin, or the n8n public API is disabled/unavailable on this deployment.',
    };
  }

  if (/Could not discover required workflows/i.test(message)) {
    return {
      kind: 'workflow_discovery_missing',
      message:
        'Workflow discovery failed: set LIVE_N8N_MAIN_WORKFLOW_ID and LIVE_N8N_SUB_WORKFLOW_ID if workflow names or list payloads are ambiguous.',
    };
  }

  if (/Workflow structure still misses|Caller missing\/empty|Trigger missing/i.test(message)) {
    return {
      kind: 'contract_missing_fields',
      message:
        'Contract missing fields: the live workflow is missing files_context/source_plan/candidate_files/answer_contract in the caller, trigger, or wrapper path.',
    };
  }

  return {
    kind: 'unknown',
    message: 'Probe failed before live contract verification completed. Inspect the sanitized error below.',
  };
}

export function summarizeWorkflow(workflow) {
  return {
    id: workflow?.id || null,
    name: workflow?.name || null,
    active: Boolean(workflow?.active),
    versionId: workflow?.versionId || null,
    activeVersionId: workflow?.activeVersionId || null,
    updatedAt: workflow?.updatedAt || null,
  };
}

export function findNode(workflow, nodeName) {
  return (workflow?.nodes || []).find((node) => node?.name === nodeName) || null;
}

export function findNodes(workflow, predicate) {
  return (workflow?.nodes || []).filter((node) => node && predicate(node));
}

export function readWorkflowInputNames(node) {
  const workflowInputs = node?.parameters?.workflowInputs || {};
  const names = new Set();

  for (const entry of workflowInputs.values || []) {
    const name = entry?.name || entry?.id || entry?.displayName;
    if (name) names.add(name);
  }

  for (const entry of workflowInputs.schema || []) {
    const name = entry?.id || entry?.name || entry?.displayName;
    if (name) names.add(name);
  }

  for (const key of Object.keys(workflowInputs.value || {})) {
    names.add(key);
  }

  return [...names].sort();
}

export function readWorkflowInputValues(node) {
  return node?.parameters?.workflowInputs?.value || {};
}

export function readSetAssignmentNames(node) {
  return (node?.parameters?.assignments?.assignments || [])
    .map((entry) => entry?.name)
    .filter(Boolean)
    .sort();
}

export function readSetAssignmentValue(node, name) {
  const assignment = (node?.parameters?.assignments?.assignments || []).find(
    (entry) => entry?.name === name,
  );
  return assignment?.value;
}

export function summarizeFieldValue(value) {
  if (value == null) {
    return {
      present: false,
      type: 'missing',
      empty: true,
      stringLength: 0,
      keys: [],
    };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return {
      present: trimmed.length > 0,
      type: 'string',
      empty: trimmed.length === 0,
      stringLength: value.length,
      expression:
        trimmed.startsWith('={{') || trimmed.startsWith('=') || trimmed.includes('$json')
          ? value
          : null,
      keys: [],
    };
  }

  if (Array.isArray(value)) {
    return {
      present: value.length > 0,
      type: 'array',
      empty: value.length === 0,
      length: value.length,
      keys: [],
    };
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return {
      present: keys.length > 0,
      type: 'object',
      empty: keys.length === 0,
      keys,
    };
  }

  return {
    present: true,
    type: typeof value,
    empty: false,
    keys: [],
  };
}

function addNeighbors(connections, nodeName) {
  const nodeConnections = connections?.[nodeName] || {};
  const neighbors = [];

  for (const group of Object.values(nodeConnections)) {
    if (!Array.isArray(group)) continue;
    for (const branch of group) {
      if (!Array.isArray(branch)) continue;
      for (const edge of branch) {
        if (edge?.node) neighbors.push(edge.node);
      }
    }
  }

  return neighbors;
}

export function findConnectionPath(workflow, startName, targetName) {
  if (!workflow?.connections || !startName || !targetName) return null;
  if (startName === targetName) return [startName];

  const queue = [[startName]];
  const seen = new Set([startName]);

  while (queue.length > 0) {
    const path = queue.shift();
    const last = path[path.length - 1];

    for (const neighbor of addNeighbors(workflow.connections, last)) {
      if (seen.has(neighbor)) continue;
      const nextPath = [...path, neighbor];
      if (neighbor === targetName) return nextPath;
      seen.add(neighbor);
      queue.push(nextPath);
    }
  }

  return null;
}

function targetWorkflowId(node) {
  const parameter =
    node?.parameters?.workflowId ||
    node?.parameters?.workflow ||
    node?.parameters?.workflowSelector;

  if (typeof parameter === 'string') return parameter;
  if (parameter && typeof parameter === 'object') {
    return parameter.value || parameter.id || null;
  }

  return null;
}

export function inspectAgent0Contract({
  mainWorkflow,
  subWorkflow,
  chatTriggerName = 'When chat message received',
  mainCallerName = DEFAULT_MAIN_CALLER_NAME,
  subTriggerName = DEFAULT_TRIGGER_NAME,
} = {}) {
  const caller = findNode(mainWorkflow, mainCallerName);
  const trigger = findNode(subWorkflow, subTriggerName);
  const buildAgent0Payload = findNode(mainWorkflow, 'Build Agent0 Payload2');
  const callerValues = readWorkflowInputValues(caller);
  const triggerInputs = readWorkflowInputNames(trigger);
  const requiredInCaller = Object.fromEntries(
    REQUIRED_AGENT0_FIELDS.map((name) => [name, summarizeFieldValue(callerValues[name])]),
  );
  const requiredInTrigger = Object.fromEntries(
    REQUIRED_AGENT0_FIELDS.map((name) => [name, triggerInputs.includes(name)]),
  );
  const missingCallerFields = REQUIRED_AGENT0_FIELDS.filter(
    (name) => !requiredInCaller[name].present,
  );
  const missingTriggerFields = REQUIRED_AGENT0_FIELDS.filter((name) => !requiredInTrigger[name]);
  const chatToCallerPath = caller
    ? findConnectionPath(mainWorkflow, chatTriggerName, caller.name)
    : null;

  return {
    generatedAt: new Date().toISOString(),
    mainWorkflow: summarizeWorkflow(mainWorkflow),
    subWorkflow: summarizeWorkflow(subWorkflow),
    path: {
      chatTriggerName,
      callerName: mainCallerName,
      reachable: Boolean(chatToCallerPath),
      nodePath: chatToCallerPath,
    },
    caller: caller
      ? {
          nodeName: caller.name,
          nodeType: caller.type || null,
          targetWorkflowId: targetWorkflowId(caller),
          inputKeys: Object.keys(callerValues).sort(),
          requiredFields: requiredInCaller,
          missingOrEmptyRequiredFields: missingCallerFields,
        }
      : {
          nodeName: mainCallerName,
          missing: true,
          missingOrEmptyRequiredFields: [...REQUIRED_AGENT0_FIELDS],
        },
    buildAgent0Payload: buildAgent0Payload
      ? {
          nodeName: buildAgent0Payload.name,
          assignmentKeys: readSetAssignmentNames(buildAgent0Payload),
          inputContext: summarizeFieldValue(readSetAssignmentValue(buildAgent0Payload, 'input_context')),
          sourcePlan: summarizeFieldValue(readSetAssignmentValue(buildAgent0Payload, 'source_plan')),
        }
      : null,
    trigger: trigger
      ? {
          nodeName: trigger.name,
          nodeType: trigger.type || null,
          inputNames: triggerInputs,
          requiredFields: requiredInTrigger,
          missingRequiredFields: missingTriggerFields,
        }
      : {
          nodeName: subTriggerName,
          missing: true,
          missingRequiredFields: [...REQUIRED_AGENT0_FIELDS],
        },
    verdict: {
      ok:
        Boolean(caller) &&
        Boolean(trigger) &&
        Boolean(chatToCallerPath) &&
        missingCallerFields.length === 0 &&
        missingTriggerFields.length === 0,
      missingCallerFields,
      missingTriggerFields,
      notes: [
        !caller ? `Main workflow is missing ${JSON.stringify(mainCallerName)}.` : null,
        !trigger ? `Subworkflow is missing ${JSON.stringify(subTriggerName)}.` : null,
        caller && !chatToCallerPath
          ? `${JSON.stringify(mainCallerName)} was not reachable from ${JSON.stringify(chatTriggerName)}.`
          : null,
        missingCallerFields.length > 0
          ? `Caller is missing or passing empty values for: ${missingCallerFields.join(', ')}.`
          : null,
        missingTriggerFields.length > 0
          ? `Search_Agent0 trigger does not declare: ${missingTriggerFields.join(', ')}.`
          : null,
      ].filter(Boolean),
    },
  };
}

export function inspectExecutionFields(parsedExecution, nodeName, fields = REQUIRED_AGENT0_FIELDS) {
  const runData = parsedExecution?.resultData?.runData || {};
  const runs = runData[nodeName] || [];
  const firstItem = runs?.[0]?.data?.main?.[0]?.[0]?.json || null;

  return {
    nodeName,
    observed: Boolean(firstItem),
    fields: Object.fromEntries(fields.map((field) => [field, summarizeFieldValue(firstItem?.[field])])),
  };
}
