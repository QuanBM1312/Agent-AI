#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const buildInfoPath = path.join(projectRoot, "lib", "build-info.ts");
const defaultArtifactPath = path.join(
  projectRoot,
  "docs",
  "artifacts",
  "live-deploy-verification",
  "latest.json",
);

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(`Usage:
  LIVE_PROBE_BASE_URL=https://your-app.example.com \\
  npm run verify:live:deploy

Environment variables:
  LIVE_PROBE_BASE_URL               Base app URL. Default: https://aioperation.dieuhoathanglong.com.vn
  LIVE_DEPLOY_VERIFY_OUTPUT         JSON artifact path. Default: docs/artifacts/live-deploy-verification/latest.json
  LIVE_PROBE_EMAIL                  Optional. If set with LIVE_PROBE_PASSWORD, run browser auth probe after fingerprint check.
  LIVE_PROBE_PASSWORD               Optional. Used with LIVE_PROBE_EMAIL.
  LIVE_PROBE_HEADLESS               Optional. Passed through to browser probe.
`);
  process.exit(0);
}

const baseUrl = (process.env.LIVE_PROBE_BASE_URL ||
  "https://aioperation.dieuhoathanglong.com.vn").replace(/\/$/, "");
const outputPath = process.env.LIVE_DEPLOY_VERIFY_OUTPUT || defaultArtifactPath;

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }

      resolve({ code, stdout, stderr });
    });
  });
}

async function getExpectedFingerprint() {
  const source = await fs.readFile(buildInfoPath, "utf8");
  const match = source.match(/AUTH_HYDRATION_FINGERPRINT = "([^"]+)"/);
  if (!match) {
    throw new Error("Could not extract AUTH_HYDRATION_FINGERPRINT from lib/build-info.ts");
  }
  return match[1];
}

async function probeVersion(expectedFingerprint) {
  const response = await fetch(`${baseUrl}/api/version`, {
    headers: {
      accept: "application/json",
    },
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  const actualFingerprint =
    typeof body === "object" && body && "authHydrationFingerprint" in body
      ? body.authHydrationFingerprint
      : null;

  return {
    status: response.status,
    ok: response.ok,
    expectedFingerprint,
    actualFingerprint,
    fingerprintMatches: actualFingerprint === expectedFingerprint,
    headers: {
      "x-clerk-auth-status": response.headers.get("x-clerk-auth-status"),
      "x-clerk-auth-reason": response.headers.get("x-clerk-auth-reason"),
      "x-vercel-id": response.headers.get("x-vercel-id"),
      "content-type": response.headers.get("content-type"),
    },
    body,
  };
}

function classifyVersionProbe(versionProbe) {
  if (versionProbe.fingerprintMatches) {
    return "fingerprint_visible";
  }

  if (versionProbe.headers["x-clerk-auth-status"] === "signed-out") {
    return "inconclusive_signed_out_or_old_proxy";
  }

  return "fingerprint_mismatch";
}

async function main() {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const expectedFingerprint = await getExpectedFingerprint();
  const versionProbe = await probeVersion(expectedFingerprint);

  const artifact = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    expectedFingerprint,
    versionProbe,
    versionConclusion: classifyVersionProbe(versionProbe),
    browserProbe: null,
  };

  const shouldRunBrowserProbe =
    Boolean(process.env.LIVE_PROBE_EMAIL && process.env.LIVE_PROBE_PASSWORD) &&
    (
      versionProbe.fingerprintMatches ||
      versionProbe.headers["x-clerk-auth-status"] === "signed-out"
    );

  if (shouldRunBrowserProbe) {
    const result = await run(
      "node",
      ["scripts/probe-live-chat-auth-browser.mjs"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          LIVE_PROBE_BASE_URL: baseUrl,
        },
      },
    );

    const browserArtifactPath = path.join(
      projectRoot,
      "docs",
      "artifacts",
      "live-auth-probe",
      "latest.json",
    );

    let browserProbe = null;
    try {
      browserProbe = JSON.parse(await fs.readFile(browserArtifactPath, "utf8"));
    } catch {
      browserProbe = {
        error: "browser probe did not produce a readable artifact",
        stdout: result.stdout || null,
        stderr: result.stderr || null,
      };
    }

    artifact.browserProbe = browserProbe;
  }

  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Saved live deployment verification to ${path.relative(projectRoot, outputPath)}`);

  const authenticatedVersionResult =
    artifact.browserProbe?.results?.find?.((result) => result.endpoint === "/api/version") || null;

  const fingerprintMatchedAfterAuth =
    authenticatedVersionResult?.ok &&
    authenticatedVersionResult?.body?.authHydrationFingerprint === expectedFingerprint;

  const failed =
    (!versionProbe.fingerprintMatches &&
      !fingerprintMatchedAfterAuth &&
      artifact.versionConclusion !== "inconclusive_signed_out_or_old_proxy") ||
    (artifact.browserProbe &&
      Array.isArray(artifact.browserProbe.results) &&
      artifact.browserProbe.results
        .filter((result) => result.endpoint !== "/api/version")
        .some((result) => !result.ok));

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
