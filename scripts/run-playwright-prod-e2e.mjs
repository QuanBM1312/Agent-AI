#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { PrismaClient } from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const DEFAULT_ENV_FILE = path.join(projectRoot, ".vercel", ".env.production.local");
const DEFAULT_BASE_URL = "https://aioperation.dieuhoathanglong.com.vn";

function parseEnvFile(content) {
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

async function loadEnvFile(envFilePath) {
  try {
    return parseEnvFile(await fs.readFile(envFilePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function requireValue(name, ...values) {
  const value = pickString(...values);
  if (value) {
    return value;
  }
  throw new Error(`Missing required value: ${name}`);
}

function buildDisposableUser() {
  const suffix = crypto.randomBytes(6).toString("hex");
  return {
    email: `playwright-e2e-${suffix}@example.com`,
    password: `Pw!${suffix}${Date.now()}`,
    fullName: "Playwright E2E",
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      ...options,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited via signal ${signal}`));
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
    });
  });
}

const envFilePath = process.env.E2E_ENV_FILE || DEFAULT_ENV_FILE;
const fileEnv = await loadEnvFile(envFilePath);

const baseUrl = requireValue(
  "production base URL",
  process.env.E2E_PRODUCTION_BASE_URL,
  process.env.LIVE_PROBE_BASE_URL,
  fileEnv.E2E_PRODUCTION_BASE_URL,
  fileEnv.LIVE_PROBE_BASE_URL,
  DEFAULT_BASE_URL,
);
const clerkSecretKey = requireValue("CLERK_SECRET_KEY", process.env.CLERK_SECRET_KEY, fileEnv.CLERK_SECRET_KEY);
const clerkPublishableKey = requireValue(
  "CLERK_PUBLISHABLE_KEY",
  process.env.CLERK_PUBLISHABLE_KEY,
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  fileEnv.CLERK_PUBLISHABLE_KEY,
  fileEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);
const databaseUrl = requireValue("DATABASE_URL", process.env.DATABASE_URL, fileEnv.DATABASE_URL);
const directUrl = pickString(process.env.DIRECT_URL, fileEnv.DIRECT_URL);
const providedEmail = pickString(
  process.env.E2E_PRODUCTION_EMAIL,
  process.env.E2E_EMAIL,
  fileEnv.E2E_PRODUCTION_EMAIL,
  fileEnv.E2E_EMAIL,
);
const providedPassword = pickString(
  process.env.E2E_PRODUCTION_PASSWORD,
  process.env.E2E_PASSWORD,
  fileEnv.E2E_PRODUCTION_PASSWORD,
  fileEnv.E2E_PASSWORD,
);

process.env.DATABASE_URL = databaseUrl;
if (directUrl) {
  process.env.DIRECT_URL = directUrl;
}

const clerk = createClerkClient({
  secretKey: clerkSecretKey,
  publishableKey: clerkPublishableKey,
});
const prisma = new PrismaClient();
const disposable = buildDisposableUser();

let createdUserId = null;

try {
  let email = providedEmail;
  let password = providedPassword;

  if (!email || !password) {
    const createdUser = await clerk.users.createUser({
      emailAddress: [disposable.email],
      password: disposable.password,
      skipPasswordChecks: true,
      skipPasswordRequirement: false,
      skipLegalChecks: true,
      firstName: "Playwright",
      lastName: "E2E",
      publicMetadata: {
        role: "Admin",
      },
    });

    createdUserId = createdUser.id;
    email = disposable.email;
    password = disposable.password;

    await prisma.users.upsert({
      where: { id: createdUser.id },
      update: {
        email: disposable.email,
        full_name: disposable.fullName,
        role: "Admin",
      },
      create: {
        id: createdUser.id,
        email: disposable.email,
        full_name: disposable.fullName,
        role: "Admin",
      },
    });
  }

  await run(process.execPath, [
    path.join(projectRoot, "scripts", "run-playwright-test.mjs"),
    "test",
    "--project",
    "chromium-production",
  ], {
    env: {
      ...process.env,
      E2E_TARGET: "production",
      E2E_PRODUCTION_BASE_URL: baseUrl,
      E2E_PRODUCTION_EMAIL: email,
      E2E_PRODUCTION_PASSWORD: password,
    },
  });
} finally {
  if (createdUserId) {
    try {
      await clerk.users.deleteUser(createdUserId);
    } catch (error) {
      console.error("[playwright-prod-e2e] failed to delete Clerk user", error);
    }

    try {
      await prisma.users.delete({
        where: { id: createdUserId },
      });
    } catch (error) {
      console.error("[playwright-prod-e2e] failed to delete DB user", error);
    }
  }

  await prisma.$disconnect();
}
