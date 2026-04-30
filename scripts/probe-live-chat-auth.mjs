#!/usr/bin/env node

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(`Usage:
  LIVE_PROBE_BASE_URL=https://your-app.example.com \\
  LIVE_PROBE_COOKIE='__session=...' \\
  npm run probe:live:chat-auth

Environment variables:
  LIVE_PROBE_BASE_URL   Base app URL. Default: https://aioperation.dieuhoathanglong.com.vn
  LIVE_PROBE_COOKIE     Raw Cookie header for an authenticated live session. Required.
`);
  process.exit(0);
}

const baseUrl = (process.env.LIVE_PROBE_BASE_URL ||
  "https://aioperation.dieuhoathanglong.com.vn").replace(/\/$/, "");
const cookie = process.env.LIVE_PROBE_COOKIE;

if (!cookie) {
  console.error("Missing required environment variable: LIVE_PROBE_COOKIE");
  process.exit(1);
}

async function probe(endpoint) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: {
      cookie,
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

  return {
    endpoint,
    status: response.status,
    ok: response.ok,
    headers: {
      "x-clerk-auth-status": response.headers.get("x-clerk-auth-status"),
      "x-clerk-auth-reason": response.headers.get("x-clerk-auth-reason"),
      "x-vercel-id": response.headers.get("x-vercel-id"),
      "content-type": response.headers.get("content-type"),
    },
    body,
  };
}

async function main() {
  const results = [];

  for (const endpoint of ["/api/test-auth", "/api/chat/sessions"]) {
    console.log(`Probing ${endpoint}...`);
    results.push(await probe(endpoint));
  }

  console.log(JSON.stringify({ baseUrl, results }, null, 2));

  const failed = results.find((result) => !result.ok);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
