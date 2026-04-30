import { test as setup } from "playwright/test";
import {
  authenticateWithClerk,
  ensureAuthStateDirectory,
} from "./support/auth";
import {
  getAuthStatePath,
  requireE2EEnv,
} from "./support/env";

setup("authenticate local user", async ({ page, baseURL }) => {
  if (!baseURL) {
    throw new Error("Missing baseURL for setup-local Playwright project.");
  }

  const authStatePath = getAuthStatePath("local");
  await ensureAuthStateDirectory(authStatePath);

  await authenticateWithClerk(page, {
    baseURL,
    email: requireE2EEnv("EMAIL", "local"),
    password: requireE2EEnv("PASSWORD", "local"),
  });

  await page.context().storageState({ path: authStatePath });
});
