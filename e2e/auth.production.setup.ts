import { test as setup } from "playwright/test";
import {
  authenticateWithClerk,
  ensureAuthStateDirectory,
} from "./support/auth";
import {
  getAuthStatePath,
  requireE2EEnv,
} from "./support/env";

setup("authenticate production user", async ({ page, baseURL }) => {
  if (!baseURL) {
    throw new Error("Missing baseURL for setup-production Playwright project.");
  }

  const authStatePath = getAuthStatePath("production");
  await ensureAuthStateDirectory(authStatePath);

  await authenticateWithClerk(page, {
    baseURL,
    email: requireE2EEnv("EMAIL", "production"),
    password: requireE2EEnv("PASSWORD", "production"),
  });

  await page.context().storageState({ path: authStatePath });
});
