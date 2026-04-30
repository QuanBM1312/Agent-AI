#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const localNodeModules = path.join(projectRoot, "node_modules");

function exists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function ensureSymlink(linkPath, targetPath) {
  if (exists(linkPath)) {
    return;
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(targetPath, linkPath, "junction");
}

function findCachedPlaywrightPackage() {
  const npmNpxRoot = path.join(os.homedir(), ".npm", "_npx");
  if (!exists(npmNpxRoot)) {
    return null;
  }

  const candidates = fs
    .readdirSync(npmNpxRoot)
    .map((entry) => path.join(npmNpxRoot, entry, "node_modules", "playwright"))
    .filter((entry) => exists(path.join(entry, "cli.js")));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftStat = fs.statSync(left);
    const rightStat = fs.statSync(right);
    return rightStat.mtimeMs - leftStat.mtimeMs;
  });

  return candidates[0];
}

function ensurePlaywrightRuntime() {
  const localCli = path.join(localNodeModules, "playwright", "cli.js");
  if (exists(localCli)) {
    return localCli;
  }

  const cachedPlaywright = findCachedPlaywrightPackage();
  if (!cachedPlaywright) {
    throw new Error(
      "Playwright runtime is not available. Install `playwright` locally or ensure `npx playwright` has been run on this machine at least once.",
    );
  }

  const cachedNodeModules = path.dirname(cachedPlaywright);
  const cachedCore = path.join(cachedNodeModules, "playwright-core");
  const localPlaywright = path.join(localNodeModules, "playwright");
  const localCore = path.join(localNodeModules, "playwright-core");

  ensureSymlink(localPlaywright, cachedPlaywright);

  if (exists(cachedCore)) {
    ensureSymlink(localCore, cachedCore);
  }

  if (!exists(localCli)) {
    throw new Error(`Failed to prepare Playwright runtime at ${localCli}`);
  }

  return localCli;
}

async function main() {
  const cliPath = ensurePlaywrightRuntime();
  const args = process.argv.slice(2);

  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      PLAYWRIGHT_SKIP_BROWSER_GC: "1",
    },
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
