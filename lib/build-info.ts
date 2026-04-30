export const AUTH_HYDRATION_FINGERPRINT = "2026-04-22-auth-clerk-first-v1";
export const AGENT0_WARM_CONTEXT_FINGERPRINT = "2026-04-22-agent0-warm-context-v1";

export function getBuildInfo() {
  return {
    authHydrationFingerprint: AUTH_HYDRATION_FINGERPRINT,
    agent0WarmContextFingerprint: AGENT0_WARM_CONTEXT_FINGERPRINT,
    agent0WarmContextForwarding: true,
    commitSha:
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT_SHA ||
      null,
    branch:
      process.env.VERCEL_GIT_COMMIT_REF ||
      process.env.RAILWAY_GIT_BRANCH ||
      process.env.GIT_BRANCH ||
      null,
    deploymentPlatform: process.env.VERCEL
      ? "vercel"
      : process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID
        ? "railway"
        : null,
    deploymentEnvironment:
      process.env.VERCEL_ENV ||
      process.env.RAILWAY_ENVIRONMENT_NAME ||
      process.env.NODE_ENV ||
      null,
  };
}
