#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const DEFAULT_BASE_PATH = path.join(
  projectRoot,
  "docs",
  "artifacts",
  "chat-eval",
  "baseline.json",
);
const DEFAULT_TARGET_PATH = path.join(
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
  "comparison.md",
);

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(`Usage:
  CHAT_EVAL_COMPARE_BASE=docs/artifacts/chat-eval/baseline.json \\
  CHAT_EVAL_COMPARE_TARGET=docs/artifacts/chat-eval/latest.json \\
  npm run eval:chat:compare

Environment variables:
  CHAT_EVAL_COMPARE_BASE    Baseline artifact path. Default: docs/artifacts/chat-eval/baseline.json
  CHAT_EVAL_COMPARE_TARGET  Target artifact path. Default: docs/artifacts/chat-eval/latest.json
  CHAT_EVAL_COMPARE_OUTPUT  Markdown output path. Default: docs/artifacts/chat-eval/comparison.md
`);
  process.exit(0);
}

function classifyDiff(baseResult, targetResult) {
  if (!baseResult && targetResult) {
    return "new";
  }

  if (baseResult && !targetResult) {
    return "missing";
  }

  if (!baseResult || !targetResult) {
    return "unknown";
  }

  if (baseResult.ok && !targetResult.ok) {
    return "regression";
  }

  if (!baseResult.ok && targetResult.ok) {
    return "improvement";
  }

  if (targetResult.durationMs < baseResult.durationMs) {
    return "faster";
  }

  if (targetResult.durationMs > baseResult.durationMs) {
    return "slower";
  }

  if ((baseResult.routeHint || "") !== (targetResult.routeHint || "")) {
    return "route_changed";
  }

  return "unchanged";
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatDuration(value) {
  return value === "-" ? "-" : `${value}ms`;
}

async function readArtifact(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function main() {
  const basePath = process.env.CHAT_EVAL_COMPARE_BASE || DEFAULT_BASE_PATH;
  const targetPath = process.env.CHAT_EVAL_COMPARE_TARGET || DEFAULT_TARGET_PATH;
  const outputPath = process.env.CHAT_EVAL_COMPARE_OUTPUT || DEFAULT_OUTPUT_PATH;

  const [baseArtifact, targetArtifact] = await Promise.all([
    readArtifact(basePath),
    readArtifact(targetPath),
  ]);

  const targetById = new Map(targetArtifact.results.map((result) => [result.id, result]));
  const baseById = new Map(baseArtifact.results.map((result) => [result.id, result]));
  const allIds = [...new Set([...baseById.keys(), ...targetById.keys()])];

  const rows = allIds.map((id) => {
    const baseResult = baseById.get(id);
    const targetResult = targetById.get(id);

    return {
      id,
      change: classifyDiff(baseResult, targetResult),
      baseStatus: baseResult?.status ?? "-",
      targetStatus: targetResult?.status ?? "-",
      baseDurationMs: baseResult?.durationMs ?? "-",
      targetDurationMs: targetResult?.durationMs ?? "-",
      baseRoute: baseResult?.routeHint ?? "-",
      targetRoute: targetResult?.routeHint ?? "-",
      targetSummary: targetResult?.bodySummary ?? baseResult?.bodySummary ?? "",
    };
  });

  const summary = rows.reduce(
    (acc, row) => {
      acc[row.change] = (acc[row.change] || 0) + 1;
      return acc;
    },
    {},
  );

  const lines = [
    "# Chat Evaluation Comparison",
    "",
    `Baseline: ${path.relative(projectRoot, basePath)}`,
    `Target: ${path.relative(projectRoot, targetPath)}`,
    "",
    "## Summary",
    "",
  ];

  for (const [change, count] of Object.entries(summary)) {
    lines.push(`- ${change}: ${count}`);
  }

  lines.push(
    "",
    "## Per-case comparison",
    "",
    "| Case | Change | Baseline status | Target status | Baseline duration | Target duration | Baseline route | Target route | Target summary |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );

  for (const row of rows) {
    lines.push(
      `| ${escapeCell(row.id)} | ${escapeCell(row.change)} | ${escapeCell(row.baseStatus)} | ${escapeCell(row.targetStatus)} | ${escapeCell(formatDuration(row.baseDurationMs))} | ${escapeCell(formatDuration(row.targetDurationMs))} | ${escapeCell(row.baseRoute)} | ${escapeCell(row.targetRoute)} | ${escapeCell(row.targetSummary)} |`,
    );
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${lines.join("\n")}\n`);
  console.log(`Saved comparison to ${path.relative(projectRoot, outputPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
