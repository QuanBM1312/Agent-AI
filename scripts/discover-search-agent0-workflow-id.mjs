#!/usr/bin/env node

import {
  AGENT0_WORKFLOW_ARTIFACT_FILES,
  discoverSearchAgent0WorkflowCandidates,
} from './lib/agent0-workflow-id-discovery.mjs';

function printHelp() {
  console.log(`
Usage:
  npm run discover:agent0:workflow-id

Behavior:
  - scans known live n8n workflow artifacts
  - extracts workflowId values for nodes named Tool - Search_Agent0
  - prints the strongest candidate and evidence files
`.trim());
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const candidates = await discoverSearchAgent0WorkflowCandidates(AGENT0_WORKFLOW_ARTIFACT_FILES);
const best = candidates[0] || null;

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      candidates,
      best,
    },
    null,
    2,
  ),
);

process.exit(best ? 0 : 1);
