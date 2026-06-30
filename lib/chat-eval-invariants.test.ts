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
