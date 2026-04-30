export function buildRestHeaders(cookieHeader, extra = {}) {
  return {
    accept: 'application/json',
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
    ...extra,
  };
}

export function summarizeWorkflow(workflow) {
  return {
    id: workflow.id,
    name: workflow.name,
    active: workflow.active,
    versionId: workflow.versionId,
    activeVersionId: workflow.activeVersionId,
    updatedAt: workflow.updatedAt,
  };
}

export async function fetchWorkflow(baseUrl, workflowId, cookieHeader) {
  const response = await fetch(`${baseUrl}/rest/workflows/${workflowId}`, {
    headers: buildRestHeaders(cookieHeader),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch workflow ${workflowId}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return payload.data || payload;
}

export async function activateWorkflowVersion(baseUrl, workflowId, versionId, cookieHeader) {
  const response = await fetch(`${baseUrl}/rest/workflows/${workflowId}/activate`, {
    method: 'POST',
    headers: buildRestHeaders(cookieHeader, {
      'content-type': 'application/json',
    }),
    body: JSON.stringify({ versionId }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to activate workflow ${workflowId} version ${versionId}: ${response.status} ${response.statusText} :: ${text}`,
    );
  }

  const payload = await response.json();
  return payload.data || payload;
}

export function extractChatTrigger(baseUrl, workflow, nodeName = 'When chat message received') {
  const node = (workflow.nodes || []).find((candidate) => candidate?.name === nodeName);

  if (!node) {
    throw new Error(`Workflow ${workflow.id} is missing the "${nodeName}" node.`);
  }

  const webhookPath = node.webhookId || node.id;
  if (!webhookPath) {
    throw new Error(`Workflow ${workflow.id} chat trigger is missing webhookId and node.id.`);
  }

  return {
    nodeName: node.name,
    nodeId: node.id,
    webhookId: node.webhookId || null,
    url: `${baseUrl}/webhook/${webhookPath}/chat`,
  };
}
