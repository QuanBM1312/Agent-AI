#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const DEFAULT_LATEST_JSON = path.join(
  projectRoot,
  "docs",
  "artifacts",
  "chat-eval",
  "latest.json",
);
const DEFAULT_LATEST_MD = path.join(
  projectRoot,
  "docs",
  "artifacts",
  "chat-eval",
  "latest.md",
);
const DEFAULT_BASELINE_JSON = path.join(
  projectRoot,
  "docs",
  "artifacts",
  "chat-eval",
  "baseline.json",
);
const DEFAULT_BASELINE_MD = path.join(
  projectRoot,
  "docs",
  "artifacts",
  "chat-eval",
  "baseline.md",
);

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(`Usage:
  npm run eval:chat:promote

Environment variables:
  CHAT_EVAL_LATEST_JSON     Source JSON artifact. Default: docs/artifacts/chat-eval/latest.json
  CHAT_EVAL_LATEST_MD       Source Markdown artifact. Default: docs/artifacts/chat-eval/latest.md
  CHAT_EVAL_BASELINE_JSON   Baseline JSON output. Default: docs/artifacts/chat-eval/baseline.json
  CHAT_EVAL_BASELINE_MD     Baseline Markdown output. Default: docs/artifacts/chat-eval/baseline.md
`);
  process.exit(0);
}

async function copyFile(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

async function main() {
  const latestJson = process.env.CHAT_EVAL_LATEST_JSON || DEFAULT_LATEST_JSON;
  const latestMd = process.env.CHAT_EVAL_LATEST_MD || DEFAULT_LATEST_MD;
  const baselineJson =
    process.env.CHAT_EVAL_BASELINE_JSON || DEFAULT_BASELINE_JSON;
  const baselineMd = process.env.CHAT_EVAL_BASELINE_MD || DEFAULT_BASELINE_MD;

  await Promise.all([
    copyFile(latestJson, baselineJson),
    copyFile(latestMd, baselineMd),
  ]);

  console.log(
    `Promoted ${path.relative(projectRoot, latestJson)} -> ${path.relative(projectRoot, baselineJson)}`,
  );
  console.log(
    `Promoted ${path.relative(projectRoot, latestMd)} -> ${path.relative(projectRoot, baselineMd)}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
