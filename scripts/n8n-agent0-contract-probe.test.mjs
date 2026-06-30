import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCredentialDiagnostics,
  classifyProbeFailure,
  formatCredentialDiagnostics,
  inspectAgent0Contract,
  inspectExecutionFields,
} from './lib/n8n-agent0-contract-probe.mjs';

function setNode(name, assignments) {
  return {
    name,
    type: 'n8n-nodes-base.set',
    parameters: {
      assignments: {
        assignments: Object.entries(assignments).map(([key, value]) => ({
          name: key,
          value,
          type: typeof value === 'object' ? 'object' : 'string',
        })),
      },
    },
  };
}

function executeWorkflowNode(name, workflowInputs) {
  return {
    name,
    type: 'n8n-nodes-base.executeWorkflow',
    parameters: {
      workflowId: {
        value: 'search-agent0-workflow',
      },
      workflowInputs: {
        value: workflowInputs,
        schema: Object.keys(workflowInputs).map((key) => ({
          id: key,
          displayName: key,
          type: 'string',
        })),
      },
    },
  };
}

function triggerNode(names) {
  return {
    name: 'When Executed by Another Workflow',
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    parameters: {
      workflowInputs: {
        values: names.map((name) => ({ name })),
      },
    },
  };
}

function mainWorkflow(callerInputs) {
  return {
    id: 'main',
    name: 'Main Chat',
    active: true,
    nodes: [
      { name: 'When chat message received', type: '@n8n/n8n-nodes-langchain.chatTrigger' },
      setNode('Build Agent0 Payload2', {
        input_context: '={{ $json.file_context || "" }}',
      }),
      executeWorkflowNode("Call 'Tool - Search_Agent0'2", callerInputs),
    ],
    connections: {
      'When chat message received': {
        main: [[{ node: 'Build Agent0 Payload2', type: 'main', index: 0 }]],
      },
      'Build Agent0 Payload2': {
        main: [[{ node: "Call 'Tool - Search_Agent0'2", type: 'main', index: 0 }]],
      },
    },
  };
}

function subWorkflow(inputNames) {
  return {
    id: 'search-agent0-workflow',
    name: 'Tool - Search_Agent0',
    active: true,
    nodes: [triggerNode(inputNames)],
    connections: {},
  };
}

test('inspectAgent0Contract flags the historical empty files_context and missing trigger fields', () => {
  const result = inspectAgent0Contract({
    mainWorkflow: mainWorkflow({
      user_query: '={{ $json.user_query }}',
      sessionID: '={{ $json.sessionID }}',
      history_chat: '={{ $json.history_chat }}',
      user_input: '={{ $json.input_context || "" }}',
      files_context: '',
    }),
    subWorkflow: subWorkflow(['user_query', 'sessionID', 'history_chat', 'user_input']),
  });

  assert.equal(result.path.reachable, true);
  assert.equal(result.verdict.ok, false);
  assert.deepEqual(result.verdict.missingCallerFields, [
    'files_context',
    'source_plan',
    'candidate_files',
    'answer_contract',
  ]);
  assert.deepEqual(result.verdict.missingTriggerFields, [
    'files_context',
    'source_plan',
    'candidate_files',
    'answer_contract',
  ]);
});

test('inspectAgent0Contract accepts the SPEC-04 required caller and trigger fields', () => {
  const result = inspectAgent0Contract({
    mainWorkflow: mainWorkflow({
      user_query: '={{ $json.user_query }}',
      sessionID: '={{ $json.sessionID }}',
      history_chat: '={{ $json.history_chat }}',
      user_input: '={{ $json.input_context || "" }}',
      files_context: '={{ $json.files_context || $json.input_context || "" }}',
      source_plan: '={{ $json.source_plan || {} }}',
      candidate_files: '={{ $json.source_plan?.candidate_files || [] }}',
      answer_contract: '={{ $json.source_plan?.answer_contract || [] }}',
    }),
    subWorkflow: subWorkflow([
      'user_query',
      'sessionID',
      'history_chat',
      'user_input',
      'files_context',
      'source_plan',
      'candidate_files',
      'answer_contract',
    ]),
  });

  assert.equal(result.verdict.ok, true);
  assert.deepEqual(result.verdict.missingCallerFields, []);
  assert.deepEqual(result.verdict.missingTriggerFields, []);
});

test('inspectExecutionFields reports presence without leaking raw field values', () => {
  const parsedExecution = {
    resultData: {
      runData: {
        'When Executed by Another Workflow': [
          {
            data: {
              main: [
                [
                  {
                    json: {
                      files_context: 'sensitive business context',
                      source_plan: { candidate_files: [{ name: 'report.xlsx' }] },
                    },
                  },
                ],
              ],
            },
          },
        ],
      },
    },
  };

  const result = inspectExecutionFields(parsedExecution, 'When Executed by Another Workflow', [
    'files_context',
    'source_plan',
  ]);

  assert.equal(result.observed, true);
  assert.equal(result.fields.files_context.present, true);
  assert.equal(result.fields.files_context.stringLength, 'sensitive business context'.length);
  assert.equal(result.fields.files_context.expression, null);
  assert.deepEqual(result.fields.source_plan.keys, ['candidate_files']);
});

test('buildCredentialDiagnostics names both missing base URL and missing auth', () => {
  const diagnostics = buildCredentialDiagnostics({
    env: {},
    cookieFile: '/tmp/missing-cookie',
    cookieHeader: '',
  });

  assert.equal(diagnostics.ok, false);
  assert.deepEqual(diagnostics.missing, [
    'N8N_API_URL or LIVE_N8N_BASE_URL',
    'N8N_API_KEY or readable LIVE_N8N_COOKIE_FILE (/tmp/missing-cookie)',
  ]);

  const message = formatCredentialDiagnostics(diagnostics);
  assert.match(message, /N8N_API_URL=missing/);
  assert.match(message, /N8N_API_KEY=missing/);
  assert.match(message, /Cookie status: not loaded from \/tmp\/missing-cookie/);
});

test('buildCredentialDiagnostics accepts API-key access without a cookie', () => {
  const diagnostics = buildCredentialDiagnostics({
    env: {
      N8N_API_URL: 'https://n8n.example.test',
      N8N_API_KEY: 'secret',
    },
    cookieFile: '/tmp/missing-cookie',
    cookieHeader: '',
  });

  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.authMode, 'api_key');
  assert.deepEqual(diagnostics.missing, []);
});

test('buildCredentialDiagnostics accepts cookie access without an API key', () => {
  const diagnostics = buildCredentialDiagnostics({
    env: {
      LIVE_N8N_BASE_URL: 'https://n8n.example.test',
      LIVE_N8N_COOKIE_FILE: '/tmp/n8n.cookie',
    },
    cookieFile: '/tmp/n8n.cookie',
    cookieHeader: 'n8n-auth=present',
  });

  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.authMode, 'cookie');
  assert.deepEqual(diagnostics.missing, []);
});

test('classifyProbeFailure maps n8n HTTP and discovery failures', () => {
  const unauthorized = new Error('n8n API /api/v1/workflows failed: 401 Unauthorized');
  unauthorized.status = 401;
  unauthorized.apiPath = '/api/v1/workflows';
  assert.equal(classifyProbeFailure(unauthorized).kind, 'credential_invalid');

  const notFound = new Error('n8n API /api/v1/workflows failed: 404');
  notFound.status = 404;
  notFound.apiPath = '/api/v1/workflows';
  assert.equal(classifyProbeFailure(notFound).kind, 'api_workflows_not_found');

  const missingWorkflow = new Error('Could not discover required workflows. main=missing sub=missing');
  assert.equal(classifyProbeFailure(missingWorkflow).kind, 'workflow_discovery_missing');
});
