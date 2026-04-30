export type E2EMode = "local" | "production";

const MODE_PREFIX: Record<E2EMode, string> = {
  local: "LOCAL",
  production: "PRODUCTION",
};

const AUTH_STATE_PATH: Record<E2EMode, string> = {
  local: "playwright/.auth/local-user.json",
  production: "playwright/.auth/production-user.json",
};

export function inferModeFromProject(projectName: string): E2EMode {
  return projectName.includes("production") ? "production" : "local";
}

export function getAuthStatePath(mode: E2EMode) {
  return AUTH_STATE_PATH[mode];
}

export function readE2EEnv(name: "EMAIL" | "PASSWORD", mode: E2EMode) {
  const modeSpecific = process.env[`E2E_${MODE_PREFIX[mode]}_${name}`];
  const shared = process.env[`E2E_${name}`];
  return modeSpecific || shared || null;
}

export function requireE2EEnv(name: "EMAIL" | "PASSWORD", mode: E2EMode) {
  const value = readE2EEnv(name, mode);
  if (value) {
    return value;
  }

  throw new Error(
    `Missing E2E credential: set E2E_${MODE_PREFIX[mode]}_${name} or E2E_${name} before running the ${mode} Playwright project.`,
  );
}
