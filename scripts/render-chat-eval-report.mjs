#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = path.join(
  projectRoot,
  "docs",
  "artifacts",
  "chat-eval",
  "latest.json",
);
const DEFAULT_OUTPUT_PATH = path.join(
  projectRoot,
  "docs",
  "artifacts",
  "chat-eval",
  "latest.md",
);

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(`Usage:
  npm run eval:chat:report

Environment variables:
  CHAT_EVAL_REPORT_INPUT   JSON artifact path. Default: docs/artifacts/chat-eval/latest.json
  CHAT_EVAL_REPORT_OUTPUT  Markdown output path. Default: docs/artifacts/chat-eval/latest.md
`);
  process.exit(0);
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function summarizeResult(result) {
  const statusLabel = result.ok ? "pass" : "fail";
  return `- ${result.id}: ${statusLabel}, status ${result.status}, ${result.durationMs}ms, route \`${result.routeHint || "unknown"}\``;
}

async function main() {
  const inputPath = process.env.CHAT_EVAL_REPORT_INPUT || DEFAULT_INPUT_PATH;
  const outputPath = process.env.CHAT_EVAL_REPORT_OUTPUT || DEFAULT_OUTPUT_PATH;
  const artifact = JSON.parse(await fs.readFile(inputPath, "utf8"));

  const lines = [
    "# Chat Evaluation Report",
    "",
    `Generated at: ${artifact.generatedAt}`,
    `Base URL: ${artifact.baseUrl}`,
    `Session ID: ${artifact.sessionId}`,
    "",
  ];

  if (artifact.setupError) {
    lines.push(
      "## Setup error",
      "",
      `- Stage: ${artifact.setupStage || "unknown"}`,
      `- Error: ${artifact.setupError}`,
      "",
    );
  }

  lines.push(
    "## Summary",
    "",
    `- Total cases: ${artifact.summary.total}`,
    `- Success count: ${artifact.summary.successCount}`,
    `- Failure count: ${artifact.summary.failureCount}`,
    `- Average duration: ${artifact.summary.averageDurationMs}ms`,
    "",
    "## Route hints",
    "",
  );

  for (const [routeHint, count] of Object.entries(artifact.summary.routeHints || {})) {
    lines.push(`- \`${routeHint}\`: ${count}`);
  }

  lines.push(
    "",
    "## Quick verdict",
    "",
    ...(artifact.results.length > 0
      ? artifact.results.map(summarizeResult)
      : ["- No case results were recorded."]),
    "",
    "## Per-case detail",
    "",
    "| Case | Category | Status | Duration | Route | Expected behavior | Response summary |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );

  if (artifact.results.length === 0) {
    lines.push("| - | - | - | - | - | - | - |");
  } else {
    for (const result of artifact.results) {
      lines.push(
        `| ${escapeCell(result.id)} | ${escapeCell(result.category)} | ${escapeCell(result.status)} | ${escapeCell(result.durationMs)}ms | ${escapeCell(result.routeHint || "unknown")} | ${escapeCell((result.expectedBehavior || []).join("; "))} | ${escapeCell(result.bodySummary || "")} |`,
      );
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${lines.join("\n")}\n`);
  console.log(`Saved report to ${path.relative(projectRoot, outputPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
