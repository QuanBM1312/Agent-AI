#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  addEquivalentGroupAssertions,
  evaluateChatEvalCase,
} from "../lib/chat-eval-invariants.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const DEFAULT_EVAL_SET_PATH = path.join(projectRoot, "docs", "chat-evaluation-set.json");
const DEFAULT_OUTPUT_PATH = path.join(os.tmpdir(), "agent-ai-chat-eval-latest.json");
const DEFAULT_FILE_FIXTURE = path.join(
  projectRoot,
  "docs",
  "artifacts",
  "chat-eval",
  "sample-file-backed.txt",
);

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);

function readOption(name) {
  const equalsPrefix = `${name}=`;
  const equalsValue = rawArgs.find((arg) => arg.startsWith(equalsPrefix));
  if (equalsValue) {
    return equalsValue.slice(equalsPrefix.length);
  }

  const index = rawArgs.indexOf(name);
  if (index === -1) {
    return null;
  }

  const value = rawArgs[index + 1];
  return value && !value.startsWith("--") ? value : "";
}

const explicitCasesMode = readOption("--cases");
const casesMode =
  explicitCasesMode === null
    ? process.env.CHAT_EVAL_BUSINESS === "0"
      ? "canonical"
      : "all"
    : explicitCasesMode;

if (!["canonical", "business", "all"].includes(casesMode)) {
  console.error(
    `Invalid --cases value "${casesMode || "(missing)"}". Expected canonical, business, or all.`,
  );
  process.exit(1);
}

if (args.has("--help")) {
  console.log(`Usage:
  CHAT_EVAL_BASE_URL=https://example.com \\
  CHAT_EVAL_COOKIE='__session=...' \\
  npm run eval:chat

Environment variables:
  CHAT_EVAL_BASE_URL    Base app URL. Default: http://localhost:3000
  CHAT_EVAL_COOKIE      Raw Cookie header for an authenticated user session.
  CHAT_EVAL_EMAIL       Optional Clerk sign-in email used when CHAT_EVAL_COOKIE is absent.
  CHAT_EVAL_PASSWORD    Optional Clerk sign-in password used when CHAT_EVAL_COOKIE is absent.
  CHAT_EVAL_SET         Path to evaluation-set JSON. Default: docs/chat-evaluation-set.json
  CHAT_EVAL_OUTPUT      Output artifact path. Default: /tmp/agent-ai-chat-eval-latest.json
  CHAT_EVAL_FILE_PATH   File fixture for file-backed case. Default: docs/artifacts/chat-eval/sample-file-backed.txt
  CHAT_EVAL_SESSION_ID  Reuse an existing chat session instead of creating a fresh one
  CHAT_EVAL_BUSINESS    Backward-compatible: 0 means --cases canonical when --cases is omitted.

Options:
  --list-cases         Print the resolved evaluation case ids without calling the app.
  --cases <mode>       canonical | business | all. Default: all.
`);
  process.exit(0);
}

const INTERNAL_FORBIDDEN_ROUTES = [
  "gemini_web_search",
  "gemini_web_offer",
  "local_external_limit",
];
const INTERNAL_FILE_ROUTES = [
  "agent0_deep",
  "calculation_needs_data",
  "calculation_drive_candidates_need_selection",
  "calculation_drive_source_not_found",
  "calculation_drive_source_not_found_upstream_unavailable",
  "drive_spreadsheet_price_filter",
  "gemini_file_search_calculation",
  "gemini_spreadsheet_calculation",
  "local_business_data_boundary",
  "local_internal_unavailable",
  "spreadsheet_calculation",
  "spreadsheet_calculation_needs_columns",
];
const INVENTORY_ROUTES = [
  "agent0_deep",
  "local_business_data_boundary",
  "local_inventory_filtered",
  "local_inventory_filter_not_found",
  "local_inventory_summary",
  "local_internal_unavailable",
  "local_missing_data",
];
const PROJECT_CONTRACT_ROUTES = [
  "agent0_deep",
  "calculation_drive_candidates_need_selection",
  "calculation_drive_source_not_found",
  "calculation_drive_source_not_found_upstream_unavailable",
  "gemini_file_search_calculation",
  "local_business_data_boundary",
  "local_internal_unavailable",
  "local_missing_data",
];
const MISSING_SOURCE_WARNING_GROUPS = [
  [
    "chưa thấy bảng phù hợp",
    "chưa đủ",
    "không đủ nguồn",
    "không đủ dữ liệu",
    "thiếu nguồn",
    "thiếu dữ liệu",
    "không tìm thấy",
  ],
  ["nguồn", "dữ liệu", "file", "bảng", "hồ sơ"],
];

function internalCase(overrides) {
  return {
    forbiddenRoutes: INTERNAL_FORBIDDEN_ROUTES,
    forbiddenWeb: true,
    ...overrides,
  };
}

function answerOrMissingSource({ name, requiredSignals = [], requiredFormula = false }) {
  return {
    name,
    class: "source-state",
    message:
      "Expected either a grounded answer with required signals/evidence, or an explicit missing-source warning",
    any: [
      {
        requiredSignals,
        requiredEvidence: true,
        ...(requiredFormula ? { requiredFormula: true } : {}),
      },
      {
        requiredWarningsAny: MISSING_SOURCE_WARNING_GROUPS,
      },
    ],
  };
}

const BUSINESS_EVAL_CASES = [
  {
    id: "business-source-missing-index-pending",
    category: "business_finance",
    input: "Quý gần nhất công ty đang lời hay lỗ? Nêu công thức và nguồn dữ liệu.",
    expectedIntent: "profit_loss",
    allowedRoutes: INTERNAL_FILE_ROUTES,
    requiredFormula: true,
    alternativeAssertionGroups: [
      answerOrMissingSource({
        name: "profit_loss_formula_with_source_or_missing_source",
        requiredSignals: [/\b(lai|loi)\b/, /\blo\b/],
        requiredFormula: true,
      }),
    ],
    ...internalCase({}),
  },
  {
    id: "business-finance-q1-profit-loss-by-contract",
    category: "business_finance",
    input: "Tính lãi/lỗ Quý 1 theo từng hợp đồng.",
    expectedIntent: "profit_loss",
    allowedRoutes: INTERNAL_FILE_ROUTES,
    requiredFormula: true,
    alternativeAssertionGroups: [
      answerOrMissingSource({
        name: "contract_profit_loss_formula_with_source_or_missing_source",
        requiredSignals: ["hợp đồng", "quý 1"],
        requiredFormula: true,
      }),
    ],
    ...internalCase({}),
  },
  {
    id: "business-finance-worst-loss-contract",
    category: "business_finance",
    input: "Hợp đồng nào đang lỗ nhất và vì sao?",
    expectedIntent: "profit_loss",
    allowedRoutes: INTERNAL_FILE_ROUTES,
    alternativeAssertionGroups: [
      answerOrMissingSource({
        name: "worst_loss_contract_with_reason_or_missing_source",
        requiredSignals: ["hợp đồng", "lỗ", /\b(vi|ly do|nguyen nhan)\b/],
      }),
    ],
    ...internalCase({}),
  },
  {
    id: "business-profit-loss-missing-cost",
    category: "business_finance",
    input: "Nếu thiếu dữ liệu chi phí, bạn có được kết luận hợp đồng đang lãi không?",
    expectedIntent: "profit_loss",
    allowedRoutes: ["local_business_data_boundary"],
    requiredWarningsAny: [
      ["thiếu dữ liệu chi phí", "thiếu chi phí", "thiếu dữ liệu giá vốn", "thiếu giá vốn"],
      ["không được kết luận", "không thể kết luận", "chưa được kết luận", "không kết luận"],
    ],
    requiredFormula: true,
    mustNotContainAny: [
      /ket luan\s+(la|rang)\b.*\b(co lai|dang lai)\b/,
      /\bdang co lai\b/,
    ],
    ...internalCase({}),
  },
  {
    id: "business-inventory-rbc-per-warehouse",
    category: "business_inventory",
    input: "Hàng RBC còn tồn bao nhiêu ở từng kho?",
    expectedIntent: "inventory_analysis",
    allowedRoutes: INVENTORY_ROUTES,
    requiredSignals: ["RBC"],
    requiredWarningsAny: [["kho", "vị trí kho", "warehouse", "chiều kho"]],
    ...internalCase({}),
  },
  {
    id: "business-inventory-panasonic",
    category: "business_inventory",
    input: "Hàng panasonic trong kho có bao nhiêu loại?",
    expectedIntent: "inventory_lookup",
    equivalentGroup: "panasonic-brand-lookup",
    allowedRoutes: ["local_inventory_filtered", "local_inventory_filter_not_found"],
    requiredSignals: ["panasonic"],
    ...internalCase({}),
  },
  {
    id: "business-inventory-pananonic-typo",
    category: "business_inventory",
    input: "Hàng pananonic trong kho có bao nhiêu loại?",
    expectedIntent: "inventory_lookup",
    equivalentGroup: "panasonic-brand-lookup",
    allowedRoutes: ["local_inventory_filtered", "local_inventory_filter_not_found"],
    requiredSignals: ["panasonic"],
    ...internalCase({}),
  },
  {
    id: "business-inventory-negative-or-below-minimum",
    category: "business_inventory",
    input: "Có mặt hàng nào âm kho hoặc dưới ngưỡng tối thiểu không?",
    expectedIntent: "inventory_analysis",
    allowedRoutes: INVENTORY_ROUTES,
    alternativeAssertionGroups: [
      answerOrMissingSource({
        name: "inventory_risk_answer_or_missing_source",
        requiredSignals: [/am kho|ton am/, /nguong toi thieu|duoi nguong|min/],
      }),
    ],
    ...internalCase({}),
  },
  {
    id: "business-inventory-stale-stock-warning",
    category: "business_inventory",
    input: "Nếu tồn kho chưa cập nhật hôm nay, bạn phải cảnh báo gì?",
    expectedIntent: "inventory_analysis",
    allowedRoutes: INVENTORY_ROUTES,
    requiredWarningsAny: [
      ["chưa cập nhật hôm nay", "không phải dữ liệu mới nhất", "dữ liệu tồn kho chưa cập nhật"],
      ["cảnh báo", "không kết luận", "cần xác nhận", "kiểm tra lại"],
    ],
    ...internalCase({}),
  },
  {
    id: "business-project-x-completion-status",
    category: "business_project",
    input: "Dự án X đã xong chưa?",
    expectedIntent: "project_progress",
    allowedRoutes: PROJECT_CONTRACT_ROUTES,
    alternativeAssertionGroups: [
      answerOrMissingSource({
        name: "project_status_with_evidence_or_missing_source",
        requiredSignals: ["dự án x"],
      }),
    ],
    ...internalCase({}),
  },
  {
    id: "business-project-x-deadline-delay-days",
    category: "business_project",
    input: "Dự án X trễ deadline bao nhiêu ngày?",
    expectedIntent: "project_progress",
    allowedRoutes: PROJECT_CONTRACT_ROUTES,
    alternativeAssertionGroups: [
      answerOrMissingSource({
        name: "project_delay_days_with_evidence_or_missing_source",
        requiredSignals: ["dự án x", "ngày"],
      }),
    ],
    ...internalCase({}),
  },
  {
    id: "business-project-x-unfinished-owner",
    category: "business_project",
    input: "Ai phụ trách hạng mục chưa xong của dự án X?",
    expectedIntent: "project_progress",
    allowedRoutes: PROJECT_CONTRACT_ROUTES,
    alternativeAssertionGroups: [
      answerOrMissingSource({
        name: "unfinished_owner_with_evidence_or_missing_source",
        requiredSignals: ["phụ trách", "chưa xong"],
      }),
    ],
    ...internalCase({}),
  },
  {
    id: "business-contract-complete-not-settled",
    category: "business_contract",
    input: "Hợp đồng nào đã hoàn thành nhưng chưa quyết toán?",
    expectedIntent: "contract_status",
    allowedRoutes: PROJECT_CONTRACT_ROUTES,
    alternativeAssertionGroups: [
      answerOrMissingSource({
        name: "complete_unsettled_contracts_with_evidence_or_missing_source",
        requiredSignals: ["hợp đồng", "chưa quyết toán"],
      }),
    ],
    ...internalCase({}),
  },
  {
    id: "business-cross-domain-brief-report",
    category: "business_cross_domain",
    input: "Tạo báo cáo ngắn gồm tài chính, tồn kho, tiến độ, rủi ro.",
    expectedIntent: "risk_summary",
    allowedRoutes: [...INTERNAL_FILE_ROUTES, ...INVENTORY_ROUTES, ...PROJECT_CONTRACT_ROUTES],
    alternativeAssertionGroups: [
      answerOrMissingSource({
        name: "cross_domain_report_with_evidence_or_missing_source",
        requiredSignals: ["tài chính", "tồn kho", "tiến độ", "rủi ro"],
      }),
    ],
    ...internalCase({}),
  },
  {
    id: "business-cross-domain-separate-known-missing-inferred",
    category: "business_cross_domain",
    input: "Hãy tách rõ dữ liệu chắc chắn, dữ liệu thiếu và suy luận.",
    expectedIntent: "risk_summary",
    allowedRoutes: [...INTERNAL_FILE_ROUTES, ...INVENTORY_ROUTES, ...PROJECT_CONTRACT_ROUTES],
    requiredSignals: ["chắc chắn", "thiếu", "suy luận"],
    ...internalCase({}),
  },
  {
    id: "business-cross-domain-ask-max-three-profit-questions",
    category: "business_cross_domain",
    input: "Hỏi lại tôi tối đa 3 câu nếu chưa đủ dữ liệu tính lãi/lỗ.",
    expectedIntent: "profit_loss",
    allowedRoutes: INTERNAL_FILE_ROUTES,
    requiredWarningsAny: [["thiếu", "chưa đủ", "cần"], ["lãi/lỗ", "lợi nhuận", "doanh thu"]],
    maxQuestions: 3,
    ...internalCase({}),
  },
  {
    id: "business-internal-toshiba-price-no-web",
    category: "business_price",
    input: "Giá nội bộ hàng Toshiba là bao nhiêu? Không dùng giá thị trường.",
    expectedIntent: "internal_price_lookup",
    allowedRoutes: [
      "agent0_deep",
      "local_internal_price_unavailable",
      "spreadsheet_calculation",
      "drive_spreadsheet_price_filter",
      "gemini_file_search_calculation",
      "gemini_spreadsheet_calculation",
    ],
    // If the app finds an internal spreadsheet/file, the proof is the cited file/sheet
    // and no-web route. Do not require a refusal phrase unless no source is found.
    requiredWarningsAny: [["file", "sheet", "dữ liệu nội bộ", "không trả giá lấy từ web", "không dùng giá thị trường", "không trả giá web"]],
    ...internalCase({}),
  },
];

function assertEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

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
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${commandArgs.join(" ")} failed with code ${code}\n${stderr || stdout}`,
        ),
      );
    });
  });
}

async function installPlaywright(tmpDir) {
  await fs.writeFile(
    path.join(tmpDir, "package.json"),
    JSON.stringify({ private: true, name: "chat-eval-auth" }, null, 2),
  );
  await run("npm", ["install", "playwright", "--no-save"], { cwd: tmpDir });
}

async function acquireSessionCookie({ baseUrl, email, password }) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chat-eval-auth-"));

  try {
    await installPlaywright(tmpDir);

    const runnerPath = path.join(tmpDir, "runner.mjs");
    await fs.writeFile(
      runnerPath,
      `
import { chromium } from "playwright";

const baseUrl = ${JSON.stringify(baseUrl)};
const email = process.env.CHAT_EVAL_EMAIL;
const password = process.env.CHAT_EVAL_PASSWORD;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

try {
  await page.goto(\`\${baseUrl}/sign-in\`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[name="identifier"]').waitFor({ timeout: 30000 });
  await page.locator('input[name="identifier"]').fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('input[name="password"]').waitFor({ timeout: 30000 });
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const cookies = await context.cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === "__session");

  if (!sessionCookie) {
    throw new Error("Missing __session cookie after live sign-in");
  }

  console.log(cookies.map((cookie) => \`\${cookie.name}=\${cookie.value}\`).join("; "));
  await browser.close();
} catch (error) {
  await browser.close();
  throw error;
}
`,
    );

    const { stdout } = await run("node", [runnerPath], {
      cwd: tmpDir,
      env: {
        ...process.env,
        CHAT_EVAL_EMAIL: email,
        CHAT_EVAL_PASSWORD: password,
      },
    });

    const cookie = stdout.trim();

    if (!cookie.includes("__session=")) {
      throw new Error("Failed to acquire authenticated chat evaluation cookie");
    }

    return cookie;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function buildHeaders(cookie) {
  return {
    cookie,
    accept: "application/json",
    "x-chat-eval-debug": "1",
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function createSession({ baseUrl, cookie }) {
  const response = await fetch(`${baseUrl}/api/chat/sessions`, {
    method: "POST",
    headers: {
      ...buildHeaders(cookie),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      summary: `Chat evaluation ${new Date().toISOString()}`,
    }),
  });

  const body = await parseJsonResponse(response);

  if (!response.ok || !body?.id) {
    throw new Error(
      `Failed to create chat session (${response.status}): ${JSON.stringify(body)}`,
    );
  }

  return body.id;
}

function summarizeBody(body) {
  if (body == null) {
    return null;
  }

  if (typeof body === "string") {
    return body.slice(0, 400);
  }

  if (typeof body === "object") {
    if (typeof body.output === "string") {
      return body.output.slice(0, 400);
    }

    if (typeof body.message === "string") {
      return body.message.slice(0, 400);
    }
  }

  return JSON.stringify(body).slice(0, 400);
}

async function runCase({ baseUrl, cookie, sessionId, fileFixture, testCase, caseIndex }) {
  const input = testCase.input || testCase.prompt;
  const formData = new FormData();
  formData.set("sessionId", sessionId);
  formData.set("type", "chat");
  formData.set("chatInput", input);
  formData.set("clientMessageId", `eval-${testCase.id}-${Date.now()}-${caseIndex}`);

  if (testCase.category === "file_attachment") {
    const fileBuffer = await fs.readFile(fileFixture);
    const file = new File([fileBuffer], path.basename(fileFixture), {
      type: "text/plain",
    });
    formData.set("file", file);
  }

  const startedAtMs = Date.now();
  const response = await fetch(`${baseUrl}/api/chat/n8n`, {
    method: "POST",
    headers: buildHeaders(cookie),
    body: formData,
  });
  const completedAtMs = Date.now();
  const durationMs = completedAtMs - startedAtMs;
  const body = await parseJsonResponse(response);

  const routeHint =
    response.headers.get("x-chat-route-hint") ||
    (typeof body === "object" && body?._meta?.routeHint) ||
    null;
  const requestId =
    response.headers.get("x-chat-request-id") ||
    (typeof body === "object" && body?._meta?.requestId) ||
    null;
  const serverDurationMs =
    response.headers.get("x-chat-duration-ms") ||
    (typeof body === "object" && body?._meta?.durationMs) ||
    null;

  return {
    id: testCase.id,
    category: testCase.category,
    input,
    expectedIntent: testCase.expectedIntent || null,
    expectedBehavior: testCase.expectedBehavior,
    status: response.status,
    httpOk: response.ok,
    ok: response.ok,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs,
    serverDurationMs,
    routeHint,
    requestId,
    bodySummary: summarizeBody(body),
    responseBody: body,
  };
}

async function runCaseWithAuthRetry({
  baseUrl,
  cookie,
  sessionId,
  fileFixture,
  testCase,
  caseIndex,
  refreshCookie,
}) {
  let currentCookie = cookie;
  let result = await runCase({
    baseUrl,
    cookie: currentCookie,
    sessionId,
    fileFixture,
    testCase,
    caseIndex,
  });

  if (result.status !== 401 || !refreshCookie) {
    return { result, cookie: currentCookie };
  }

  currentCookie = await refreshCookie();
  result = await runCase({
    baseUrl,
    cookie: currentCookie,
    sessionId,
    fileFixture,
    testCase,
    caseIndex,
  });

  return { result, cookie: currentCookie };
}

function resolveEvaluationCases(evaluationSet) {
  const canonicalCases = Array.isArray(evaluationSet?.cases) ? [...evaluationSet.cases] : [];

  if (casesMode === "canonical") {
    return canonicalCases;
  }

  if (casesMode === "business") {
    return [...BUSINESS_EVAL_CASES];
  }

  return [...canonicalCases, ...BUSINESS_EVAL_CASES];
}

function buildSummary(results) {
  const total = results.length;
  const successCount = results.filter((result) => result.ok).length;
  const failureCount = total - successCount;
  const averageDurationMs =
    total > 0
      ? Math.round(
          results.reduce((sum, result) => sum + result.durationMs, 0) / total,
        )
      : 0;

  return {
    total,
    successCount,
    failureCount,
    averageDurationMs,
    routeHints: results.reduce((acc, result) => {
      const key = result.routeHint || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    failureClasses: results.reduce((acc, result) => {
      for (const failureClass of result.failureClasses || []) {
        acc[failureClass] = (acc[failureClass] || 0) + 1;
      }
      return acc;
    }, {}),
  };
}

async function writeArtifact(outputPath, artifact) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(artifact, null, 2));
}

function displayPath(filePath) {
  const relative = path.relative(projectRoot, filePath);

  return relative.startsWith("..") ? filePath : relative;
}

async function main() {
  const baseUrl = normalizeBaseUrl(
    process.env.CHAT_EVAL_BASE_URL || "http://localhost:3000",
  );
  const evaluationSetPath = process.env.CHAT_EVAL_SET || DEFAULT_EVAL_SET_PATH;
  const outputPath = process.env.CHAT_EVAL_OUTPUT || DEFAULT_OUTPUT_PATH;
  const fileFixture = process.env.CHAT_EVAL_FILE_PATH || DEFAULT_FILE_FIXTURE;

  const evaluationSet = JSON.parse(await fs.readFile(evaluationSetPath, "utf8"));
  const evaluationCases = resolveEvaluationCases(evaluationSet);

  if (args.has("--list-cases")) {
    for (const testCase of evaluationCases) {
      console.log(`${testCase.id}\t${testCase.category || "uncategorized"}`);
    }
    return;
  }

  const canRefreshCookie = Boolean(
    !process.env.CHAT_EVAL_COOKIE &&
      process.env.CHAT_EVAL_EMAIL &&
      process.env.CHAT_EVAL_PASSWORD,
  );
  const refreshCookie = async () =>
    await acquireSessionCookie({
      baseUrl,
      email: assertEnv("CHAT_EVAL_EMAIL", process.env.CHAT_EVAL_EMAIL),
      password: assertEnv("CHAT_EVAL_PASSWORD", process.env.CHAT_EVAL_PASSWORD),
    });
  let cookie =
    process.env.CHAT_EVAL_COOKIE ||
    (canRefreshCookie
      ? await refreshCookie()
      : assertEnv("CHAT_EVAL_COOKIE", process.env.CHAT_EVAL_COOKIE));

  const artifactBase = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    evaluationSetPath: displayPath(evaluationSetPath),
    businessCasesIncluded: process.env.CHAT_EVAL_BUSINESS !== "0",
    fileFixture: displayPath(fileFixture),
  };

  let sessionId = process.env.CHAT_EVAL_SESSION_ID;

  if (!sessionId) {
    try {
      sessionId = await createSession({ baseUrl, cookie });
    } catch (error) {
      const artifact = {
        ...artifactBase,
        sessionId: null,
        summary: buildSummary([]),
        setupError: error instanceof Error ? error.message : String(error),
        setupStage: "create_session",
        results: [],
      };

      await writeArtifact(outputPath, artifact);
      console.log(`Saved failure artifact to ${displayPath(outputPath)}`);
      throw error;
    }
  }

  const results = [];

  try {
    for (const [index, testCase] of evaluationCases.entries()) {
      console.log(`Running ${testCase.id}...`);
      const execution = await runCaseWithAuthRetry({
        baseUrl,
        cookie,
        sessionId,
        fileFixture,
        testCase,
        caseIndex: index,
        refreshCookie: canRefreshCookie ? refreshCookie : null,
      });
      cookie = execution.cookie;
      const result = evaluateChatEvalCase(execution.result, testCase);
      results.push(result);
      console.log(
        `  -> ${result.ok ? "PASS" : "FAIL"} ${result.status} in ${result.durationMs}ms (${result.routeHint || "no-route"})`,
      );
    }
  } catch (error) {
    addEquivalentGroupAssertions(results, evaluationCases);
    const artifact = {
      ...artifactBase,
      baseUrl,
      sessionId,
      summary: buildSummary(results),
      runError: error instanceof Error ? error.message : String(error),
      setupStage: "run_cases",
      results,
    };

    await writeArtifact(outputPath, artifact);
    console.log(`Saved partial failure artifact to ${displayPath(outputPath)}`);
    throw error;
  }

  addEquivalentGroupAssertions(results, evaluationCases);

  const artifact = {
    ...artifactBase,
    baseUrl,
    sessionId,
    summary: buildSummary(results),
    results,
  };

  await writeArtifact(outputPath, artifact);

  console.log(`Saved artifact to ${displayPath(outputPath)}`);

  if (artifact.summary.failureCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
