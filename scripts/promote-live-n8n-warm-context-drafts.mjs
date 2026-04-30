#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCookieHeader } from './lib/n8n-execution-utils.mjs';
import {
  fetchWorkflow,
  activateWorkflowVersion,
  summarizeWorkflow,
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
  'warm-context-promotion.json',
);

const baseUrl = (process.env.LIVE_N8N_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const cookieFile = process.env.LIVE_N8N_COOKIE_FILE || DEFAULT_COOKIE_FILE;
const mainWorkflowId = process.env.LIVE_N8N_MAIN_WORKFLOW_ID || DEFAULT_MAIN_WORKFLOW_ID;
const subWorkflowId = process.env.LIVE_N8N_SUB_WORKFLOW_ID || DEFAULT_SUB_WORKFLOW_ID;
const outputPath = process.env.LIVE_N8N_PROMOTION_OUTPUT || DEFAULT_OUTPUT;
const shouldApply =
  process.argv.includes('--apply') ||
  process.env.LIVE_N8N_APPLY === '1' ||
  process.env.LIVE_N8N_APPLY === 'true';
const targetMainVersion = process.env.LIVE_N8N_TARGET_MAIN_VERSION || '';
const targetSubVersion = process.env.LIVE_N8N_TARGET_SUB_VERSION || '';

function printHelp() {
  console.log(`Usage:
  npm run promote:live:n8n:warm-context
  npm run promote:live:n8n:warm-context -- --apply
  LIVE_N8N_APPLY=1 npm run promote:live:n8n:warm-context

Optional env:
  LIVE_N8N_BASE_URL              override the live n8n base URL
  LIVE_N8N_COOKIE_FILE           Netscape-format cookie jar for authenticated /rest/* access
  LIVE_N8N_MAIN_WORKFLOW_ID      override the main workflow id
  LIVE_N8N_SUB_WORKFLOW_ID       override the Search_Agent0 workflow id
  LIVE_N8N_TARGET_MAIN_VERSION   explicit main workflow version to activate
  LIVE_N8N_TARGET_SUB_VERSION    explicit Search_Agent0 version to activate
  LIVE_N8N_PROMOTION_OUTPUT      override the promotion summary artifact path
  LIVE_N8N_APPLY=1               perform activation instead of dry-run

Default behavior:
  - dry-run only
  - when no explicit target versions are provided, the script promotes each workflow's current draft version
`);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

function resolveTargetVersion(workflow, explicitVersion, label) {
  if (explicitVersion) return explicitVersion;
  if (!workflow.versionId) {
    throw new Error(`${label} is missing versionId.`);
  }
  if (!workflow.activeVersionId) {
    throw new Error(`${label} is missing activeVersionId.`);
  }
  if (workflow.versionId === workflow.activeVersionId) {
    throw new Error(`${label} does not currently have a separate draft version to promote.`);
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
  workflows: {},
  conclusions: [],
};

try {
  const cookieHeader = await loadCookieHeader(cookieFile);
  if (!cookieHeader) {
    throw new Error(`Could not load an authenticated cookie header from ${cookieFile}.`);
  }

  const mainBefore = await fetchWorkflow(baseUrl, mainWorkflowId, cookieHeader);
  const subBefore = await fetchWorkflow(baseUrl, subWorkflowId, cookieHeader);

  const mainTargetVersion = resolveTargetVersion(mainBefore, targetMainVersion, 'Main workflow');
  const subTargetVersion = resolveTargetVersion(subBefore, targetSubVersion, 'Search_Agent0 workflow');

  summary.workflows.main = {
    before: summarizeWorkflow(mainBefore),
    targetVersionId: mainTargetVersion,
  };
  summary.workflows.sub = {
    before: summarizeWorkflow(subBefore),
    targetVersionId: subTargetVersion,
  };

  if (!shouldApply) {
    summary.conclusions.push('Dry-run only. No live activation was performed.');
    summary.conclusions.push('Target versions resolved successfully for both workflows.');
    await writeArtifact(summary);
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  await activateWorkflowVersion(baseUrl, subWorkflowId, subTargetVersion, cookieHeader);
  await activateWorkflowVersion(baseUrl, mainWorkflowId, mainTargetVersion, cookieHeader);

  const mainAfter = await fetchWorkflow(baseUrl, mainWorkflowId, cookieHeader);
  const subAfter = await fetchWorkflow(baseUrl, subWorkflowId, cookieHeader);

  summary.workflows.main.after = summarizeWorkflow(mainAfter);
  summary.workflows.sub.after = summarizeWorkflow(subAfter);
  summary.conclusions.push(`Promoted main workflow to ${mainTargetVersion}.`);
  summary.conclusions.push(`Promoted Search_Agent0 to ${subTargetVersion}.`);

  await writeArtifact(summary);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  summary.error = error instanceof Error ? error.message : String(error);
  summary.conclusions.push('Promotion did not complete successfully.');
  await writeArtifact(summary);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}
