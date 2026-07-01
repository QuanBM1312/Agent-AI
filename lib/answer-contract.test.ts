import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAnswerContractMetadata } from "./answer-contract.ts";
import { buildQueryPlan } from "./query-planner.ts";

test("missing cost blocks verified profit conclusion", () => {
  const queryPlan = buildQueryPlan("Quý gần nhất công ty đang lời hay lỗ?");
  const metadata = buildAnswerContractMetadata({
    queryPlan,
    routeHint: "calculation_drive_source_not_found",
    output: "Chưa đủ dữ liệu chi phí để kết luận lãi/lỗ.",
    calculationDriveSearched: true,
    candidateFileCount: 0,
    sourcePlanPresent: true,
    answerContractPresent: true,
  });

  assert.equal(metadata.verificationStatus, "missing");
  assert.ok(metadata.missingData.some((item) => item.sourceRequirement === "cost"));
  assert.ok(metadata.warnings.some((warning) => warning.includes("Không dùng web")));
  assert.ok(metadata.executionTrace.some((event) => event.step === "evidence_verifier"));
});

test("missing warehouse dimension marks inventory answer partial", () => {
  const queryPlan = buildQueryPlan("Hàng RBC còn tồn bao nhiêu ở từng kho?");
  const metadata = buildAnswerContractMetadata({
    queryPlan,
    routeHint: "local_inventory_filtered",
    output: "Schema tồn kho hiện tại chưa có chiều kho/vị trí kho.",
    sourcePlanPresent: false,
    answerContractPresent: false,
  });

  assert.equal(metadata.verificationStatus, "partial");
  assert.ok(metadata.evidence.some((item) => item.kind === "db"));
  assert.ok(metadata.missingData.some((item) => item.sourceRequirement === "warehouse_dimension"));
});

test("internal price unavailable is missing source and never verified", () => {
  const queryPlan = buildQueryPlan("Giá nội bộ hàng Toshiba là bao nhiêu? Không dùng web.");
  const metadata = buildAnswerContractMetadata({
    queryPlan,
    routeHint: "local_internal_price_unavailable",
    output: "Tôi chưa đọc được giá sản phẩm từ dữ liệu nội bộ.",
    calculationDriveSearched: true,
    candidateFileCount: 0,
    sourcePlanPresent: true,
    answerContractPresent: true,
  });

  assert.equal(metadata.verificationStatus, "missing");
  assert.ok(metadata.missingData.some((item) => item.sourceRequirement === "internal_price_file"));
  assert.ok(metadata.warnings.some((warning) => warning.includes("Không dùng web")));
});

test("n8n failure is explicit tool unavailable", () => {
  const queryPlan = buildQueryPlan("Tạo báo cáo ngắn gồm: tài chính, tồn kho, tiến độ, rủi ro.");
  const metadata = buildAnswerContractMetadata({
    queryPlan,
    routeHint: "calculation_drive_candidates_upstream_unavailable",
    output: "Luồng n8n/Agent0 hiện không phản hồi.",
    degradedFrom: "n8n_timeout",
    calculationDriveSearched: true,
    candidateFileCount: 2,
    sourcePlanPresent: true,
    answerContractPresent: true,
  });

  assert.equal(metadata.verificationStatus, "tool_unavailable");
  assert.ok(metadata.warnings.some((warning) => warning.includes("n8n_timeout")));
  assert.ok(metadata.warnings.some((warning) => warning.includes("không phải bằng chứng rằng nghiệp vụ không có dữ liệu")));
  assert.ok(metadata.executionTrace.some((event) => event.status === "tool_unavailable"));
});

test("Agent0 credential errors are tool unavailable, not verified evidence", () => {
  const queryPlan = buildQueryPlan("Giá nội bộ hàng Toshiba là bao nhiêu? Không dùng web.");
  const metadata = buildAnswerContractMetadata({
    queryPlan,
    routeHint: "agent0_deep",
    output: "Tôi gặp lỗi quyền truy cập invalid_grant nên không thể truy xuất file nội bộ.",
    toolProvider: "n8n",
    toolExecutionProof: true,
    sourcePlanPresent: true,
    answerContractPresent: true,
    candidateFileCount: 3,
  });

  assert.equal(metadata.verificationStatus, "tool_unavailable");
  assert.ok(metadata.evidence.some((item) => item.kind === "agent0"));
  assert.ok(metadata.missingData.some((item) => item.reason.includes("Đã tìm thấy file nội bộ")));
  assert.ok(metadata.warnings.some((warning) => warning.includes("lỗi truy cập/công cụ")));
  assert.ok(metadata.executionTrace.some((event) => event.status === "tool_unavailable"));
});

test("generic n8n transport without source proof is not verified", () => {
  const metadata = buildAnswerContractMetadata({
    queryPlan: null,
    routeHint: "general",
    output: "Xin chào",
    toolProvider: "n8n",
  });

  assert.equal(metadata.verificationStatus, "unverified");
  assert.equal(metadata.evidence.length, 0);
});

test("Agent0 missing-source route is missing, not verified Agent0 evidence", () => {
  const queryPlan = buildQueryPlan("Hàng RBC còn tồn bao nhiêu ở từng kho?");
  const metadata = buildAnswerContractMetadata({
    queryPlan,
    routeHint: "agent0_deep_missing_source",
    output: "Tôi chưa tìm được file nội bộ phù hợp để chuyển sang Agent0 đọc và phân tích.",
    toolProvider: "n8n",
    calculationDriveSearched: true,
    candidateFileCount: 0,
    sourcePlanPresent: false,
    answerContractPresent: false,
  });

  assert.equal(metadata.verificationStatus, "missing");
  assert.equal(metadata.evidence.length, 0);
  assert.ok(metadata.missingData.some((item) => item.sourceRequirement === "inventory_current_stock"));
  assert.ok(metadata.executionTrace.some((event) => event.status === "missing_source"));
});

test("n8n sourced response needs citation or evidence proof", () => {
  const metadata = buildAnswerContractMetadata({
    queryPlan: null,
    routeHint: "general",
    output: "Đã tìm thấy trong tài liệu.",
    toolProvider: "n8n",
    citations: ["Bao cao Q1.xlsx / Sheet1"],
  });

  assert.equal(metadata.verificationStatus, "verified");
  assert.ok(metadata.evidence.some((item) => item.kind === "n8n"));
});
