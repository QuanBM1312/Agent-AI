import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addEquivalentGroupAssertions,
  evaluateChatEvalCase,
  normalizeForEvalMatch,
} from "./chat-eval-invariants.mjs";

function result(output: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "case",
    status: 200,
    routeHint: "local_business_data_boundary",
    responseBody: { output },
    bodySummary: output,
    ...overrides,
  };
}

test("normalized matching tolerates accents, case, and whitespace", () => {
  assert.equal(normalizeForEvalMatch("  Thiếu dữ liệu Chi Phí  "), "thieu du lieu chi phi");
});

test("warning groups accept equivalent wording instead of brittle exact prose", () => {
  const evaluated = evaluateChatEvalCase(
    result("Không thể kết luận hợp đồng có lãi vì hiện thiếu chi phí/giá vốn."),
    {
      id: "missing-cost",
      expectedIntent: "profit_loss",
      requiredWarningsAny: [
        ["thiếu dữ liệu chi phí", "thiếu chi phí", "thiếu chi phí/giá vốn"],
        ["không được kết luận", "không thể kết luận", "không kết luận"],
      ],
      requiredFormula: false,
    },
  );

  assert.equal(evaluated.ok, true);
  assert.deepEqual(evaluated.pendingIntent, {
    expected: "profit_loss",
    reason: "Response metadata does not expose planner intent yet",
  });
});

test("expected intent is only pass/fail when response metadata exposes it", () => {
  const pending = evaluateChatEvalCase(result("Có dữ liệu nội bộ."), {
    id: "pending-intent",
    expectedIntent: "internal_price_lookup",
  });
  assert.equal(pending.ok, true);
  assert.equal(pending.pendingIntent?.expected, "internal_price_lookup");

  const mismatch = evaluateChatEvalCase(
    result("Có dữ liệu nội bộ.", {
      responseBody: {
        output: "Có dữ liệu nội bộ.",
        _meta: { queryPlan: { intent: "external_web" } },
      },
    }),
    {
      id: "intent-mismatch",
      expectedIntent: "internal_price_lookup",
    },
  );
  assert.equal(mismatch.ok, false);
  assert.deepEqual(mismatch.failureClasses, ["routing"]);
});

test("alternative assertion groups allow missing-source refusal instead of formula", () => {
  const evaluated = evaluateChatEvalCase(
    result(
      "Tôi đã tìm trong dữ liệu nội bộ nhưng chưa thấy bảng phù hợp. Cần kiểm tra lại nguồn dữ liệu hoặc file Drive trước khi tính.",
      { routeHint: "calculation_needs_data" },
    ),
    {
      id: "source-missing",
      allowedRoutes: ["calculation_needs_data"],
      alternativeAssertionGroups: [
        {
          name: "formula_or_missing_source",
          class: "source-state",
          any: [
            { requiredFormula: true },
            {
              requiredWarningsAny: [
                ["chưa thấy bảng phù hợp", "không đủ dữ liệu", "thiếu nguồn"],
                ["nguồn", "dữ liệu", "file"],
              ],
            },
          ],
        },
      ],
    },
  );

  assert.equal(evaluated.ok, true);
});

test("business evidence requires a real source signal, not only HTTP success", () => {
  const missingEvidence = evaluateChatEvalCase(
    result("Hợp đồng A đang lỗ 20 triệu."),
    {
      id: "verified-business-answer",
      requiredEvidence: true,
    },
  );

  assert.equal(missingEvidence.ok, false);
  assert.deepEqual(missingEvidence.failureClasses, ["evidence"]);

  const sourced = evaluateChatEvalCase(
    result("Hợp đồng A đang lỗ 20 triệu.", {
      responseBody: {
        output: "Hợp đồng A đang lỗ 20 triệu.",
        citations: [{ title: "Bao cao hop dong Q1.xlsx", sheet: "Q1" }],
      },
    }),
    {
      id: "verified-business-answer",
      requiredEvidence: true,
    },
  );

  assert.equal(sourced.ok, true);
});

test("route assertions use response metadata when the runner did not receive a header", () => {
  const evaluated = evaluateChatEvalCase(
    result("Panasonic có 1 mã.", {
      routeHint: null,
      responseBody: {
        output: "Panasonic có 1 mã.",
        _meta: { routeHint: "local_inventory_filtered" },
      },
    }),
    {
      id: "route-from-meta",
      allowedRoutes: ["local_inventory_filtered"],
      forbiddenWeb: true,
    },
  );

  assert.equal(evaluated.ok, true);
});

test("verification status and question-count invariants are classified for production gating", () => {
  const passing = evaluateChatEvalCase(
    result("1. Bạn có file doanh thu không? 2. Bạn có file chi phí không?", {
      responseBody: {
        output: "1. Bạn có file doanh thu không? 2. Bạn có file chi phí không?",
        _meta: { verificationStatus: "needs_more_data" },
      },
    }),
    {
      id: "ask-max-three",
      maxQuestions: 3,
      requiredVerificationStatus: ["needs_more_data", "verified"],
    },
  );

  assert.equal(passing.ok, true);
  assert.equal(passing.exposedVerificationStatus, "needs_more_data");

  const failing = evaluateChatEvalCase(
    result("Câu 1? Câu 2? Câu 3? Câu 4?", {
      responseBody: {
        output: "Câu 1? Câu 2? Câu 3? Câu 4?",
        _meta: { verificationStatus: "unverified" },
      },
    }),
    {
      id: "ask-max-three",
      maxQuestions: 3,
      requiredVerificationStatus: "needs_more_data",
    },
  );

  assert.equal(failing.ok, false);
  assert.deepEqual(failing.failureClasses, ["ui", "evidence"]);
});

test("equivalent group assertion requires same route and same no-web behavior", () => {
  const baseCase = {
    equivalentGroup: "panasonic-brand-lookup",
    requiredSignals: ["panasonic"],
  };
  const panasonic = evaluateChatEvalCase(
    result("Panasonic có 1 mã.", {
      id: "business-inventory-panasonic",
      routeHint: "local_inventory_filtered",
    }),
    { ...baseCase, id: "business-inventory-panasonic" },
  );
  const typo = evaluateChatEvalCase(
    result("Panasonic có 1 mã.", {
      id: "business-inventory-pananonic-typo",
      routeHint: "local_inventory_filtered",
    }),
    { ...baseCase, id: "business-inventory-pananonic-typo" },
  );

  const passing = addEquivalentGroupAssertions([panasonic, typo], [
    { ...baseCase, id: "business-inventory-panasonic" },
    { ...baseCase, id: "business-inventory-pananonic-typo" },
  ]);
  assert.equal(passing.every((item) => item.ok), true);

  const webTypo = evaluateChatEvalCase(
    result("Panasonic có 1 mã.", {
      id: "business-inventory-pananonic-typo",
      routeHint: "local_inventory_filtered",
      responseBody: {
        output: "Panasonic có 1 mã.",
        _meta: { webSearchUsed: true },
      },
    }),
    { ...baseCase, id: "business-inventory-pananonic-typo" },
  );
  const failing = addEquivalentGroupAssertions([panasonic, webTypo], [
    { ...baseCase, id: "business-inventory-panasonic" },
    { ...baseCase, id: "business-inventory-pananonic-typo" },
  ]);

  assert.equal(failing.every((item) => item.ok), false);
  assert.ok(failing.every((item) => item.failureClasses.includes("routing")));
});
