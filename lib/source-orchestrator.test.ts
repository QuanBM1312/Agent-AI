import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildN8nSourcePlanPayload,
  buildQueryPlan,
  buildQueryRoutingPolicy,
} from "./query-planner.ts";
import { buildSourceCatalogFromRecords } from "./source-catalog.ts";
import {
  buildSourceDecision,
  buildSourceLookupTerms,
  buildSourceRoutePolicy,
} from "./source-orchestrator.ts";

function buildRouteProbe(prompt: string, records: Parameters<typeof buildSourceCatalogFromRecords>[0]) {
  const plan = buildQueryPlan(prompt);
  const catalog = buildSourceCatalogFromRecords(records, { prompt });
  const decision = buildSourceDecision({ prompt, plan, catalog });
  const routePolicy = buildSourceRoutePolicy({ plan, decision });
  const payload = buildN8nSourcePlanPayload({
    queryPlan: plan,
    routingPolicy: {
      ...buildQueryRoutingPolicy(plan),
      useAgent0DeepLane: routePolicy.shouldUseAgent0DeepLane,
    },
    candidateFiles: decision.candidateFiles,
    calculationFileSearchStoreNames: [],
    needsInternalFileAnalysis: plan.intent !== "general" && plan.intent !== "external_web",
    calculationDriveSearched: true,
    geminiWebSearchEnabled: true,
  });

  return {
    plan,
    decision,
    routePolicy,
    outgoingCandidates: JSON.parse(payload.candidateFiles),
    sourcePlan: JSON.parse(payload.sourcePlan),
  };
}

test("source lookup terms exclude no-web instruction text", () => {
  const plan = buildQueryPlan("Giá nội bộ Toshiba không dùng web/google/internet hay giá thị trường.");
  const terms = buildSourceLookupTerms({
    prompt: "Giá nội bộ Toshiba không dùng web/google/internet hay giá thị trường.",
    plan,
  });

  assert.ok(terms.includes("toshiba"));
  assert.ok(terms.includes("gia"));
  assert.doesNotMatch(terms.join(" "), /\b(web|google|internet|thi truong)\b/);
});

test("Toshiba internal price chooses Agent0 with product price candidates", () => {
  const prompt = "Phiếu tính giá của điều hòa Toshiba có những loại nào? Không dùng web.";
  const plan = buildQueryPlan(prompt);
  const catalog = buildSourceCatalogFromRecords([
    {
      driveFileId: "price-1",
      driveName: "Phiếu tính giá điều hòa Toshiba 2026.xlsx",
      fileSearchName: "fileSearchStores/prices/documents/1",
      source: "file_search_storage",
    },
    {
      driveFileId: "service-1",
      driveName: "materials and services - giá dịch vụ.xlsx",
      fileSearchName: "fileSearchStores/services/documents/1",
      source: "file_search_storage",
    },
  ], { prompt });
  const decision = buildSourceDecision({ prompt, plan, catalog });

  assert.equal(decision.recommendedLane, "agent0_deep");
  assert.equal(decision.candidateFiles[0].driveFileId, "price-1");
  assert.equal(decision.candidateFiles[0].expectedUse, "price_lookup");
  assert.ok(decision.candidateFiles[0].matchedTerms.includes("toshiba"));
  assert.ok(decision.candidateFiles[0].reason.includes("product_price_source"));
});

test("RBC per-warehouse inventory routes Agent0 when inventory Drive candidates exist", () => {
  const prompt = "Hàng RBC còn tồn bao nhiêu ở từng kho?";
  const plan = buildQueryPlan(prompt);
  const catalog = buildSourceCatalogFromRecords([
    {
      driveFileId: "inv-1",
      driveName: "Nhập xuất tồn kho RBC tháng 6.xlsx",
      source: "drive_fallback",
      mimeType: "application/vnd.google-apps.spreadsheet",
    },
  ], { prompt });
  const decision = buildSourceDecision({ prompt, plan, catalog });

  assert.equal(plan.intent, "inventory_analysis");
  assert.equal(decision.recommendedLane, "agent0_deep");
  assert.equal(decision.candidateFiles[0].expectedUse, "inventory_lookup");
  assert.equal(decision.candidateFiles[0].sourceStateStatus, "drive_only");
});

test("complete inventory total stays local DB even with inventory files", () => {
  const prompt = "Hàng Panasonic trong kho có bao nhiêu loại?";
  const plan = buildQueryPlan(prompt);
  const catalog = buildSourceCatalogFromRecords([
    {
      driveFileId: "inv-2",
      driveName: "Tồn kho Panasonic.xlsx",
      source: "drive_fallback",
    },
  ], { prompt });
  const decision = buildSourceDecision({ prompt, plan, catalog });

  assert.equal(plan.intent, "inventory_lookup");
  assert.equal(decision.recommendedLane, "local_db");
});

test("risk summary ranks multiple business source domains for Agent0", () => {
  const prompt = "Tạo báo cáo ngắn gồm: tài chính, tồn kho, tiến độ, rủi ro.";
  const plan = buildQueryPlan(prompt);
  const catalog = buildSourceCatalogFromRecords([
    { driveFileId: "finance-1", driveName: "Báo cáo tài chính doanh thu chi phí.xlsx", source: "file_search_storage" },
    { driveFileId: "inv-1", driveName: "Nhập xuất tồn kho.xlsx", source: "drive_fallback" },
    { driveFileId: "project-1", driveName: "Báo cáo tiến độ dự án.xlsx", source: "drive_fallback" },
  ], { prompt });
  const decision = buildSourceDecision({ prompt, plan, catalog });

  assert.equal(decision.recommendedLane, "agent0_deep");
  assert.ok(decision.candidateFiles.length >= 3);
  assert.ok(decision.candidateFiles.some((candidate) => candidate.likelyDomains.includes("finance")));
  assert.ok(decision.candidateFiles.some((candidate) => candidate.likelyDomains.includes("inventory")));
  assert.ok(decision.candidateFiles.some((candidate) => candidate.likelyDomains.includes("project")));
});

test("internal price returns missing source instead of web when no candidates exist", () => {
  const prompt = "Giá nội bộ Toshiba là bao nhiêu? Không dùng web.";
  const plan = buildQueryPlan(prompt);
  const decision = buildSourceDecision({ prompt, plan, catalog: [] });

  assert.equal(decision.recommendedLane, "missing_source");
  assert.ok(decision.missingSources.includes("internal_price_file"));
  assert.equal(decision.candidateFiles.length, 0);
});

test("route policy sends RBC per-warehouse inventory candidates to Agent0", () => {
  const probe = buildRouteProbe("Hàng RBC còn tồn bao nhiêu ở từng kho?", [
    {
      driveFileId: "inv-rbc",
      driveName: "Nhập xuất tồn kho RBC tháng 6.xlsx",
      source: "drive_fallback",
      mimeType: "application/vnd.google-apps.spreadsheet",
    },
  ]);

  assert.equal(probe.plan.intent, "inventory_analysis");
  assert.equal(probe.decision.recommendedLane, "agent0_deep");
  assert.equal(probe.routePolicy.shouldUseAgent0DeepLane, true);
  assert.equal(probe.routePolicy.shouldUseInventoryFallback, false);
  assert.equal(probe.outgoingCandidates.length, 1);
  assert.equal(probe.outgoingCandidates[0].driveFileId, "inv-rbc");
  assert.equal(probe.outgoingCandidates[0].expectedUse, "inventory_lookup");
  assert.equal(probe.sourcePlan.routingPolicy.useAgent0DeepLane, true);
});

test("route policy keeps simple Panasonic inventory totals on local DB", () => {
  const probe = buildRouteProbe("Hàng Panasonic trong kho có bao nhiêu loại?", [
    {
      driveFileId: "inv-panasonic",
      driveName: "Tồn kho Panasonic.xlsx",
      source: "drive_fallback",
    },
  ]);

  assert.equal(probe.plan.intent, "inventory_lookup");
  assert.equal(probe.decision.recommendedLane, "local_db");
  assert.equal(probe.routePolicy.shouldUseLocalInventoryDb, true);
  assert.equal(probe.routePolicy.shouldUseAgent0DeepLane, false);
});

test("route policy sends internal Toshiba price candidate to Agent0", () => {
  const probe = buildRouteProbe("Phiếu tính giá của điều hòa Toshiba có những loại nào? Không dùng web.", [
    {
      driveFileId: "price-toshiba",
      driveName: "Phiếu tính giá điều hòa Toshiba 2026.xlsx",
      fileSearchName: "fileSearchStores/prices/documents/1",
      source: "file_search_storage",
    },
  ]);

  assert.equal(probe.plan.intent, "internal_price_lookup");
  assert.equal(probe.decision.recommendedLane, "agent0_deep");
  assert.equal(probe.routePolicy.shouldUseAgent0DeepLane, true);
  assert.equal(probe.outgoingCandidates.length, 1);
  assert.equal(probe.outgoingCandidates[0].driveFileId, "price-toshiba");
  assert.equal(probe.outgoingCandidates[0].expectedUse, "price_lookup");
});

test("route policy sends risk summary multi-domain candidates to Agent0", () => {
  const probe = buildRouteProbe("Tạo báo cáo ngắn gồm: tài chính, tồn kho, tiến độ, rủi ro.", [
    { driveFileId: "finance-1", driveName: "Báo cáo tài chính doanh thu chi phí.xlsx", source: "file_search_storage" },
    { driveFileId: "inv-1", driveName: "Nhập xuất tồn kho.xlsx", source: "drive_fallback" },
    { driveFileId: "project-1", driveName: "Báo cáo tiến độ dự án.xlsx", source: "drive_fallback" },
  ]);

  assert.equal(probe.plan.intent, "risk_summary");
  assert.equal(probe.decision.recommendedLane, "agent0_deep");
  assert.equal(probe.routePolicy.shouldUseAgent0DeepLane, true);
  assert.equal(probe.outgoingCandidates.length, 3);
  assert.ok(probe.outgoingCandidates.some((candidate: { expectedUse?: string }) => candidate.expectedUse === "risk_summary"));
});

test("route policy sends technical error-code candidates to Agent0", () => {
  const probe = buildRouteProbe("Mã lỗi SMMSi E19 xử lý thế nào?", [
    {
      driveFileId: "err-smms",
      driveName: "KỸ THUẬT/Bảng tra cứu mã lỗi/SMMSi Error Code Quick Reference.pdf",
      source: "drive_fallback",
    },
  ]);

  assert.equal(probe.plan.intent, "technical_support");
  assert.equal(probe.decision.recommendedLane, "agent0_deep");
  assert.equal(probe.routePolicy.shouldUseAgent0DeepLane, true);
  assert.equal(probe.outgoingCandidates[0].expectedUse, "technical_support");
  assert.ok(probe.outgoingCandidates[0].likelyDomains.includes("error_code"));
});

test("route policy sends sales process documents to Agent0", () => {
  const probe = buildRouteProbe("Quy trình xử lý đơn hàng và kịch bản chăm sóc khách hàng là gì?", [
    {
      driveFileId: "sale-process",
      driveName: "SALE/QT.SA.01-Quy trình xử lý đơn hàng.docx",
      source: "drive_fallback",
    },
    {
      driveFileId: "care-script",
      driveName: "SALE/Kịch bản chăm sóc và liên hệ khách hàng- Nguyễn Hà.xlsx",
      source: "drive_fallback",
    },
  ]);

  assert.equal(probe.plan.intent, "sales_process");
  assert.equal(probe.decision.recommendedLane, "agent0_deep");
  assert.ok(probe.outgoingCandidates.some((candidate: { expectedUse?: string }) => candidate.expectedUse === "sales_process"));
  assert.ok(probe.outgoingCandidates.some((candidate: { likelyDomains?: string[] }) => candidate.likelyDomains?.includes("customer")));
});

test("route policy sends company policy/profile documents to Agent0", () => {
  const probe = buildRouteProbe("Hồ sơ năng lực và sơ đồ tổ chức công ty gồm những gì?", [
    {
      driveFileId: "profile",
      driveName: "HCNS/HỒ SƠ NĂNG LỰC THĂNG LONG MỚI NHẤT T4.2025.pdf",
      source: "drive_fallback",
    },
    {
      driveFileId: "org",
      driveName: "HCNS/Sơ đồ tổ chức Công ty.docx",
      source: "drive_fallback",
    },
  ]);

  assert.equal(probe.plan.intent, "company_policy");
  assert.equal(probe.decision.recommendedLane, "agent0_deep");
  assert.ok(probe.outgoingCandidates.every((candidate: { expectedUse?: string }) => candidate.expectedUse === "company_policy"));
});
