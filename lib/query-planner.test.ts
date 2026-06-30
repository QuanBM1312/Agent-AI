import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildN8nSourcePlanPayload,
  buildQueryPlan,
  buildQueryRoutingPolicy,
} from "./query-planner.ts";

test("panasonic and pananonic produce equivalent inventory plans", () => {
  const correct = buildQueryPlan("hàng panasonic trong kho có bao nhiêu loại?");
  const typo = buildQueryPlan("hàng pananonic trong kho có bao nhiêu loại?");

  assert.equal(correct.intent, "inventory_lookup");
  assert.equal(typo.intent, "inventory_lookup");
  assert.deepEqual(correct.sourceRequirements, typo.sourceRequirements);
  assert.deepEqual(correct.allowedTools, typo.allowedTools);
  assert.deepEqual(correct.blockedFallbacks, typo.blockedFallbacks);
  assert.deepEqual(
    correct.entities.map((entity) => [entity.kind, entity.normalized]),
    typo.entities.map((entity) => [entity.kind, entity.normalized]),
  );
  assert.deepEqual(buildQueryRoutingPolicy(correct), buildQueryRoutingPolicy(typo));
  assert.equal(buildQueryRoutingPolicy(correct).useLocalInventoryLookup, true);
});

test("multi-domain short report routes to risk summary before single-domain routes", () => {
  const plan = buildQueryPlan("Tạo báo cáo ngắn gồm: tài chính, tồn kho, tiến độ, rủi ro.");

  assert.equal(plan.intent, "risk_summary");
  assert.equal(plan.requiresMultipleSources, true);
  assert.ok(plan.sourceRequirements.includes("revenue"));
  assert.ok(plan.sourceRequirements.includes("cost"));
  assert.ok(plan.sourceRequirements.includes("inventory_current_stock"));
  assert.ok(plan.sourceRequirements.includes("project_progress"));
  assert.ok(plan.blockedFallbacks.includes("web_search"));
  assert.deepEqual(buildQueryRoutingPolicy(plan), {
    useLocalInventoryLookup: false,
    needsInternalFileAnalysis: true,
    blockInternalPriceWebFallback: false,
    useInventoryBusinessFallback: false,
  });
});

test("toshiba and tosiba normalize into the same internal price plan", () => {
  const correct = buildQueryPlan("phiếu tính giá của điều hòa toshiba");
  const typo = buildQueryPlan("phiếu tính giá của điều hòa tosiba");

  assert.equal(correct.intent, "internal_price_lookup");
  assert.equal(typo.intent, "internal_price_lookup");
  assert.deepEqual(
    correct.entities.map((entity) => [entity.kind, entity.normalized]),
    typo.entities.map((entity) => [entity.kind, entity.normalized]),
  );
});

test("profit/loss with revenue, cost, and cost basis routes before price lookup", () => {
  const plan = buildQueryPlan("Tính lãi/lỗ theo doanh thu, chi phí, giá vốn của hợp đồng X");

  assert.equal(plan.intent, "profit_loss");
  assert.notEqual(plan.intent, "internal_price_lookup");
  assert.ok(plan.sourceRequirements.includes("revenue"));
  assert.ok(plan.sourceRequirements.includes("cost"));
  assert.equal(buildQueryRoutingPolicy(plan).needsInternalFileAnalysis, true);
  assert.equal(buildQueryRoutingPolicy(plan).blockInternalPriceWebFallback, false);
});

test("RBC stock question produces inventory lookup with model entity", () => {
  const plan = buildQueryPlan("Trong tồn kho điều khiển RBC có bao nhiêu loại?");

  assert.equal(plan.intent, "inventory_lookup");
  assert.ok(plan.allowedTools.includes("inventory_db"));
  assert.ok(plan.blockedFallbacks.includes("web_search"));
  assert.ok(plan.entities.some((entity) => entity.kind === "model" && entity.normalized === "rbc"));
});

test("per-warehouse stock question includes warehouse dimension requirement", () => {
  const plan = buildQueryPlan("Hàng điều khiển RBC còn tồn bao nhiêu ở từng kho?");

  assert.equal(plan.intent, "inventory_analysis");
  assert.ok(plan.sourceRequirements.includes("warehouse_dimension"));
  assert.ok(plan.answerContract.includes("state_missing_warehouse_dimension"));
  assert.ok(plan.blockedFallbacks.includes("web_search"));
});

test("per-warehouse RBC stock question includes warehouse dimension requirement", () => {
  const plan = buildQueryPlan("Hàng RBC còn tồn bao nhiêu ở từng kho?");

  assert.equal(plan.intent, "inventory_analysis");
  assert.ok(plan.sourceRequirements.includes("warehouse_dimension"));
  assert.ok(plan.blockedFallbacks.includes("web_search"));
  assert.equal(buildQueryRoutingPolicy(plan).useInventoryBusinessFallback, true);
});

test("internal Toshiba price blocks web", () => {
  const plan = buildQueryPlan("Báo giá điều hòa Toshiba trong file nội bộ là bao nhiêu?");

  assert.equal(plan.intent, "internal_price_lookup");
  assert.ok(plan.sourceRequirements.includes("internal_price_file"));
  assert.ok(plan.allowedTools.includes("drive_file_search"));
  assert.ok(!plan.allowedTools.includes("gemini_web_search"));
  assert.ok(plan.blockedFallbacks.includes("web_search"));
  assert.ok(plan.answerContract.includes("do_not_use_web_prices"));
});

test("internal Toshiba price remains a price lookup", () => {
  const plan = buildQueryPlan("Giá nội bộ Toshiba là bao nhiêu?");

  assert.equal(plan.intent, "internal_price_lookup");
  assert.ok(plan.blockedFallbacks.includes("web_search"));
  assert.equal(buildQueryRoutingPolicy(plan).needsInternalFileAnalysis, true);
  assert.equal(buildQueryRoutingPolicy(plan).blockInternalPriceWebFallback, true);
});

test("internal Toshiba price with market-price ban stays internal and no-web", () => {
  const plan = buildQueryPlan("Giá nội bộ hàng Toshiba là bao nhiêu? Không dùng giá thị trường.");

  assert.equal(plan.intent, "internal_price_lookup");
  assert.ok(plan.sourceRequirements.includes("internal_price_file"));
  assert.ok(plan.allowedTools.includes("drive_file_search"));
  assert.ok(!plan.allowedTools.includes("gemini_web_search"));
  assert.ok(plan.blockedFallbacks.includes("web_search"));
  assert.ok(plan.answerContract.includes("do_not_use_web_prices"));
  assert.deepEqual(plan.retrievalTerms, ["gia", "bang gia", "bao gia", "niem yet", "toshiba"]);
});

test("profit/loss requires revenue and cost", () => {
  const plan = buildQueryPlan("Quý gần nhất công ty đang lời hay lỗ?");

  assert.equal(plan.intent, "profit_loss");
  assert.ok(plan.sourceRequirements.includes("revenue"));
  assert.ok(plan.sourceRequirements.includes("cost"));
  assert.ok(plan.answerContract.includes("do_not_conclude_profit_without_cost"));
  assert.ok(plan.blockedFallbacks.includes("web_search"));
});

test("public market question allows web", () => {
  const plan = buildQueryPlan("Giá thị trường điều hòa Toshiba trên web hiện nay?");

  assert.equal(plan.intent, "external_web");
  assert.deepEqual(plan.allowedTools, ["gemini_web_search"]);
  assert.ok(!plan.blockedFallbacks.includes("web_search"));
});

test("n8n source-plan payload emits risk summary multi-source contract", () => {
  const queryPlan = buildQueryPlan("Tạo báo cáo ngắn gồm: tài chính, tồn kho, tiến độ, rủi ro.");
  const payload = buildN8nSourcePlanPayload({
    queryPlan,
    routingPolicy: buildQueryRoutingPolicy(queryPlan),
    candidateFiles: [],
    calculationFileSearchStoreNames: ["store-a"],
    needsInternalFileAnalysis: true,
    calculationDriveSearched: true,
    geminiWebSearchEnabled: true,
  });
  const sourcePlan = JSON.parse(payload.sourcePlan);
  const answerContract = JSON.parse(payload.answerContract);

  assert.equal(sourcePlan.intent, "risk_summary");
  assert.equal(sourcePlan.requiresMultipleSources, true);
  assert.equal(sourcePlan.needsInternalFileAnalysis, true);
  assert.equal(sourcePlan.calculationDriveSearched, true);
  assert.ok(sourcePlan.sourceRequirements.includes("revenue"));
  assert.ok(sourcePlan.sourceRequirements.includes("cost"));
  assert.ok(sourcePlan.sourceRequirements.includes("inventory_current_stock"));
  assert.ok(sourcePlan.sourceRequirements.includes("project_progress"));
  assert.ok(sourcePlan.blockedFallbacks.includes("web_search"));
  assert.ok(answerContract.includes("separate_verified_missing_inferred"));
  assert.ok(answerContract.includes("cite_internal_sources"));
});

test("n8n source-plan payload keeps internal price no-web rule", () => {
  const queryPlan = buildQueryPlan("Giá nội bộ Toshiba là bao nhiêu? Không dùng web.");
  const payload = buildN8nSourcePlanPayload({
    queryPlan,
    routingPolicy: buildQueryRoutingPolicy(queryPlan),
    needsInternalFileAnalysis: true,
    calculationDriveSearched: true,
    geminiWebSearchEnabled: false,
  });
  const sourcePlan = JSON.parse(payload.sourcePlan);
  const answerContract = JSON.parse(payload.answerContract);

  assert.equal(sourcePlan.intent, "internal_price_lookup");
  assert.ok(sourcePlan.blockedFallbacks.includes("web_search"));
  assert.ok(answerContract.includes("do_not_use_web_prices"));
});

test("n8n source-plan payload keeps profit/loss formula and cost rules", () => {
  const queryPlan = buildQueryPlan("Tính lãi/lỗ theo doanh thu, chi phí, giá vốn.");
  const payload = buildN8nSourcePlanPayload({
    queryPlan,
    routingPolicy: buildQueryRoutingPolicy(queryPlan),
    needsInternalFileAnalysis: true,
    calculationDriveSearched: true,
    geminiWebSearchEnabled: true,
  });
  const answerContract = JSON.parse(payload.answerContract);

  assert.ok(answerContract.includes("do_not_conclude_profit_without_cost"));
  assert.ok(answerContract.includes("state_formula"));
  assert.ok(answerContract.includes("separate_verified_missing_inferred"));
  assert.ok(answerContract.includes("cite_internal_sources"));
});

test("n8n candidate file serialization excludes raw content", () => {
  const queryPlan = buildQueryPlan("Tính lãi/lỗ theo doanh thu, chi phí, giá vốn.");
  const payload = buildN8nSourcePlanPayload({
    queryPlan,
    routingPolicy: buildQueryRoutingPolicy(queryPlan),
    candidateFiles: [
      {
        driveFileId: "drive-123",
        driveName: "BANG GIA.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sheetName: "Sheet1",
        rawContent: "SECRET RAW SPREADSHEET TEXT",
        text: "FULL FILE TEXT",
        rows: [["do not serialize"]],
        apiKey: "not-a-real-key",
      },
    ],
    needsInternalFileAnalysis: true,
    calculationDriveSearched: true,
    geminiWebSearchEnabled: true,
  });
  const serialized = payload.candidateFiles;
  const candidates = JSON.parse(serialized);

  assert.deepEqual(candidates, [
    {
      driveFileId: "drive-123",
      driveName: "BANG GIA.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sheetName: "Sheet1",
      source: "agent_ai_candidate_resolution",
      reason: "resolved_for_internal_file_analysis",
    },
  ]);
  assert.doesNotMatch(serialized, /SECRET RAW SPREADSHEET TEXT/);
  assert.doesNotMatch(serialized, /FULL FILE TEXT/);
  assert.doesNotMatch(serialized, /not-a-real-key/);
});
