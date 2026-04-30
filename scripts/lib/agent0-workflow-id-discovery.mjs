import { readFile } from 'node:fs/promises';

export const AGENT0_WORKFLOW_ARTIFACT_FILES = [
  'docs/artifacts/live-n8n/main-workflow-pre-internal-tools-failsafe.json',
  'docs/artifacts/live-n8n/main-workflow-post-enable-internal-tools.json',
  'docs/artifacts/live-n8n/main-workflow-post-revert-fast-fallback.json',
];

export async function collectSearchAgent0WorkflowHits(candidateFiles = AGENT0_WORKFLOW_ARTIFACT_FILES) {
  const hits = [];

  for (const filePath of candidateFiles) {
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const nodes = parsed?.data?.nodes || [];
      for (const node of nodes) {
        if (!String(node?.name || '').includes('Tool - Search_Agent0')) {
          continue;
        }
        const workflowId = node?.parameters?.workflowId?.value || null;
        const cachedResultName = node?.parameters?.workflowId?.cachedResultName || null;
        if (!workflowId) {
          continue;
        }
        hits.push({
          filePath,
          nodeName: node.name,
          workflowId,
          cachedResultName,
        });
      }
    } catch {
      // Ignore missing or unreadable artifact files.
    }
  }

  return hits;
}

export function groupSearchAgent0WorkflowHits(hits) {
  const grouped = new Map();

  for (const hit of hits) {
    const current = grouped.get(hit.workflowId) || {
      workflowId: hit.workflowId,
      count: 0,
      files: [],
      nodeNames: [],
      cachedResultNames: [],
    };
    current.count += 1;
    if (!current.files.includes(hit.filePath)) current.files.push(hit.filePath);
    if (!current.nodeNames.includes(hit.nodeName)) current.nodeNames.push(hit.nodeName);
    if (hit.cachedResultName && !current.cachedResultNames.includes(hit.cachedResultName)) {
      current.cachedResultNames.push(hit.cachedResultName);
    }
    grouped.set(hit.workflowId, current);
  }

  return [...grouped.values()].sort((a, b) => b.count - a.count);
}

export async function discoverSearchAgent0WorkflowCandidates(candidateFiles = AGENT0_WORKFLOW_ARTIFACT_FILES) {
  const hits = await collectSearchAgent0WorkflowHits(candidateFiles);
  return groupSearchAgent0WorkflowHits(hits);
}

export async function discoverSearchAgent0WorkflowId(candidateFiles = AGENT0_WORKFLOW_ARTIFACT_FILES) {
  const candidates = await discoverSearchAgent0WorkflowCandidates(candidateFiles);
  return candidates[0]?.workflowId || '';
}
