import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildBusinessAnalysisContext,
  detectBusinessAnalysisPlan,
} from "./business-analysis-planner.ts";

test("profit/loss questions require multiple source categories", () => {
  const plan = detectBusinessAnalysisPlan("Quý gần nhất công ty đang lời hay lỗ? Nêu công thức và nguồn dữ liệu.");

  assert.ok(plan);
  assert.equal(plan.intent, "profit_loss");
  assert.equal(plan.requiresMultipleSources, true);
  assert.ok(plan.rawFileLimit >= 5);
  assert.ok(plan.retrievalTerms.includes("doanh thu"));
  assert.ok(plan.retrievalTerms.includes("chi phi"));
  assert.match(buildBusinessAnalysisContext(plan), /Không kết luận lãi nếu thiếu chi phí/);
});

test("project progress questions require project/deadline/assignee sources", () => {
  const plan = detectBusinessAnalysisPlan("Dự án X trễ deadline bao nhiêu ngày và ai đang phụ trách hạng mục chưa xong?");

  assert.ok(plan);
  assert.equal(plan.intent, "project_progress");
  assert.ok(plan.retrievalTerms.includes("deadline"));
  assert.ok(plan.retrievalTerms.includes("phu trach"));
  assert.ok(plan.requiredSources.some((source) => source.includes("Người phụ trách")));
});

test("simple price lookup is not forced into multi-source business analysis", () => {
  const plan = detectBusinessAnalysisPlan("Mã hàng H2AT321I08 giá bao nhiêu?");

  assert.equal(plan, null);
});

test("simple inventory lookup is not forced into multi-source business analysis", () => {
  const plan = detectBusinessAnalysisPlan("Trong tồn kho điều khiển RBC có bao nhiêu loại?");

  assert.equal(plan, null);
});

test("per-warehouse inventory questions require multi-source analysis", () => {
  const plan = detectBusinessAnalysisPlan("Hàng điều khiển RBC còn tồn bao nhiêu ở từng kho?");

  assert.ok(plan);
  assert.equal(plan.intent, "inventory_analysis");
  assert.equal(plan.requiresMultipleSources, true);
  assert.ok(plan.retrievalTerms.includes("nhap xuat ton"));
  assert.ok(plan.requiredSources.some((source) => source.includes("Vị trí kho")));
});

test("inventory reconciliation questions require stock movement sources", () => {
  const plan = detectBusinessAnalysisPlan("Có mặt hàng nào âm kho hoặc dưới ngưỡng tối thiểu không?");

  assert.ok(plan);
  assert.equal(plan.intent, "inventory_analysis");
  assert.ok(plan.answerContract.some((rule) => rule.includes("tồn tổng")));
});

test("warehouse reports use multi-source inventory analysis", () => {
  const plan = detectBusinessAnalysisPlan("Tạo báo cáo kho hàng: tồn kho, nhập xuất tồn và rủi ro thiếu hàng.");

  assert.ok(plan);
  assert.equal(plan.intent, "inventory_analysis");
  assert.ok(plan.retrievalTerms.includes("kiem ke"));
  assert.ok(plan.requiredSources.some((source) => source.includes("Nhập/xuất")));
});
