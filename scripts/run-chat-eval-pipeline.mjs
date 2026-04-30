#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const defaultBaselinePath = path.join(
  projectRoot,
  "docs",
  "artifacts",
  "chat-eval",
  "baseline.json",
);
const defaultLatestPath = path.join(
  projectRoot,
  "docs",
  "artifacts",
  "chat-eval",
  "latest.json",
);

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(`Usage:
  CHAT_EVAL_BASE_URL=https://your-app.example.com \\
  CHAT_EVAL_COOKIE='__session=...' \\
  npm run eval:chat:full

Optional environment variables:
  CHAT_EVAL_AUTO_PROMOTE=1        Promote latest artifacts to baseline after a successful run
  CHAT_EVAL_COMPARE_BASE=...      Override baseline artifact path for compare step
`);
  process.exit(0);
}

function runStep(label, command, commandArgs) {
  return new Promise((resolve, reject) => {
    console.log(`\n==> ${label}`);
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      stdio: "inherit",
      env: process.env,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const compareBasePath = process.env.CHAT_EVAL_COMPARE_BASE || defaultBaselinePath;
  const latestArtifactPath = process.env.CHAT_EVAL_OUTPUT || defaultLatestPath;
  const shouldAutoPromote = process.env.CHAT_EVAL_AUTO_PROMOTE === "1";
  let evaluationFailed = false;

  if (!process.env.CHAT_EVAL_REPORT_INPUT) {
    process.env.CHAT_EVAL_REPORT_INPUT = latestArtifactPath;
  }

  try {
    await runStep("Run evaluation set", "node", ["scripts/run-chat-eval.mjs"]);
  } catch (error) {
    evaluationFailed = true;
    if (!(await fileExists(latestArtifactPath))) {
      throw error;
    }
    console.log("\n==> Evaluation failed, but latest artifact exists. Rendering report for blocker evidence.");
  }

  await runStep("Render Markdown report", "node", ["scripts/render-chat-eval-report.mjs"]);

  if (evaluationFailed) {
    throw new Error("Evaluation run failed; rendered blocker report from failure artifact.");
  }

  if (await fileExists(compareBasePath)) {
    await runStep("Compare against baseline", "node", ["scripts/compare-chat-eval.mjs"]);
  } else {
    console.log(
      `\n==> Skip compare (no baseline at ${path.relative(projectRoot, compareBasePath)})`,
    );
  }

  if (shouldAutoPromote) {
    await runStep("Promote latest artifacts to baseline", "node", [
      "scripts/promote-chat-eval-baseline.mjs",
    ]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
