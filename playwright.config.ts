import path from "node:path";
import { defineConfig, devices } from "playwright/test";

const target = process.env.E2E_TARGET || "local";
const includeLocal = target === "local" || target === "all";
const includeProduction = target === "production" || target === "all";

const localBaseURL = process.env.E2E_LOCAL_BASE_URL || "http://127.0.0.1:3000";
const productionBaseURL =
  process.env.E2E_PRODUCTION_BASE_URL ||
  process.env.LIVE_PROBE_BASE_URL ||
  "https://aioperation.dieuhoathanglong.com.vn";

const authDir = path.join(__dirname, "playwright", ".auth");

const projects = [];

if (includeLocal) {
  projects.push(
    {
      name: "setup-local",
      testMatch: /auth\.local\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        baseURL: localBaseURL,
      },
    },
    {
      name: "chromium-local",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        baseURL: localBaseURL,
        storageState: path.join(authDir, "local-user.json"),
      },
      dependencies: ["setup-local"],
    },
  );
}

if (includeProduction) {
  projects.push(
    {
      name: "setup-production",
      testMatch: /auth\.production\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        baseURL: productionBaseURL,
      },
    },
    {
      name: "chromium-production",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        baseURL: productionBaseURL,
        storageState: path.join(authDir, "production-user.json"),
      },
      dependencies: ["setup-production"],
    },
  );
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 180_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results/playwright",
  use: {
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "vi-VN",
  },
  projects,
  webServer: includeLocal
    ? {
        command:
          process.env.E2E_LOCAL_WEBSERVER_COMMAND ||
          "npm run dev -- --hostname 127.0.0.1 --port 3000",
        url: localBaseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,
});
