export const AGENT0_API_KEY_ENV_NAMES = ['AGENT0_API_KEY', 'AGENT0_MCP_SERVER_TOKEN'];

export function resolveAgent0ApiKey(env = process.env) {
  for (const envName of AGENT0_API_KEY_ENV_NAMES) {
    const value = env[envName];
    if (value) {
      return { value, envName };
    }
  }

  return { value: '', envName: null };
}
