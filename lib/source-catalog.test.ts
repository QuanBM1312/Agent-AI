import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSourceCatalogFromRecords,
  classifyPriceSourceKind,
  classifySourceDomains,
  isProbeOrTestSourceName,
} from "./source-catalog.ts";

test("classifies business source domains from names and paths", () => {
  assert.deepEqual(
    classifySourceDomains({ name: "Bảng giá sản phẩm Toshiba 2026.xlsx" }),
    ["price"],
  );
  assert.ok(classifySourceDomains({ name: "Nhập xuất tồn kho tháng 6.xlsx" }).includes("inventory"));
  assert.ok(classifySourceDomains({ name: "TLE-BC BP SALEADMINS 2026.xlsx" }).includes("finance"));
  assert.ok(classifySourceDomains({ name: "Báo cáo tiến độ dự án tuần này.xlsx" }).includes("project"));
  assert.ok(classifySourceDomains({ name: "Hợp đồng nghiệm thu và quyết toán.xlsx" }).includes("contract"));
});

test("classifies real Drive technical, sales, and company folders", () => {
  assert.deepEqual(
    classifySourceDomains({
      name: "KỸ THUẬT/Bảng tra cứu mã lỗi/SMMSi Error Code Quick Reference.pdf",
      pathHint: "KỸ THUẬT/Bảng tra cứu mã lỗi/SMMSi Error Code Quick Reference.pdf",
    }),
    ["technical", "error_code"],
  );
  assert.ok(
    classifySourceDomains({
      name: "KỸ THUẬT/Hướng dẫn lắp đặt và vận hành/TLE-LAP ĐẶT.xlsx",
      pathHint: "KỸ THUẬT/Hướng dẫn lắp đặt và vận hành/TLE-LAP ĐẶT.xlsx",
    }).includes("installation"),
  );
  assert.ok(
    classifySourceDomains({
      name: "KỸ THUẬT/Quy trình BT định kỳ/D5. QUY TRÌNH BẢO TRÌ , BẢO DƯỠNG ĐIỀU HÒA CỤC BỘ ĐỊNH KỲ.docx",
      pathHint: "KỸ THUẬT/Quy trình BT định kỳ/D5. QUY TRÌNH BẢO TRÌ , BẢO DƯỠNG ĐIỀU HÒA CỤC BỘ ĐỊNH KỲ.docx",
    }).includes("maintenance"),
  );
  assert.ok(
    classifySourceDomains({
      name: "SALE/QT.SA.01-Quy trình bán hàng Kinh doanh.docx",
      pathHint: "SALE/QT.SA.01-Quy trình bán hàng Kinh doanh.docx",
    }).includes("sales_process"),
  );
  assert.ok(
    classifySourceDomains({
      name: "HCNS/HỒ SƠ NĂNG LỰC THĂNG LONG MỚI NHẤT T4.2025.pdf",
      pathHint: "HCNS/HỒ SƠ NĂNG LỰC THĂNG LONG MỚI NHẤT T4.2025.pdf",
    }).includes("company_profile"),
  );
});

test("distinguishes product price files from service price files", () => {
  assert.equal(
    classifyPriceSourceKind({ name: "Phiếu tính giá điều hòa Toshiba.xlsx" }),
    "product_price",
  );
  assert.equal(
    classifyPriceSourceKind({ name: "materials and services - giá dịch vụ.xlsx" }),
    "service_price",
  );
  assert.equal(
    classifyPriceSourceKind({ name: "050924_BẢNG GIÁ NIÊM YẾT SỬA CHỮA, BẢO DƯỠNG, LẮP ĐẶT NHỎ LẺ.xlsx" }),
    "service_price",
  );
});

test("filters probe and test files unless prompt explicitly names them", () => {
  assert.equal(isProbeOrTestSourceName("upload-probe-live-smoke.xlsx"), true);

  const hidden = buildSourceCatalogFromRecords([
    {
      driveFileId: "probe-1",
      driveName: "upload-probe-live-smoke.xlsx",
      source: "drive_fallback",
    },
  ], {
    prompt: "Giá Toshiba nội bộ là bao nhiêu?",
  });
  assert.equal(hidden.length, 0);

  const explicit = buildSourceCatalogFromRecords([
    {
      driveFileId: "probe-1",
      driveName: "upload-probe-live-smoke.xlsx",
      source: "drive_fallback",
    },
  ], {
    prompt: "Đọc file upload-probe-live-smoke",
  });
  assert.equal(explicit.length, 1);
});

test("drive fallback rows are candidates but not treated as indexed", () => {
  const [item] = buildSourceCatalogFromRecords([
    {
      driveFileId: "drive-1",
      driveName: "Bảng giá Toshiba.xlsx",
      mimeType: "application/vnd.google-apps.spreadsheet",
      source: "drive_fallback",
    },
  ]);

  assert.equal(item.sourceState.status, "drive_only");
  assert.equal(item.sourceState.usableForRag, false);
  assert.equal(item.sourceState.usableForCalculation, false);
  assert.deepEqual(item.likelyDomains, ["price"]);
});

test("file search storage rows expose indexed source state", () => {
  const [item] = buildSourceCatalogFromRecords([
    {
      driveFileId: "drive-2",
      driveName: "Báo cáo tài chính.xlsx",
      fileSearchName: "fileSearchStores/abc/documents/xyz",
      source: "file_search_storage",
    },
  ]);

  assert.equal(item.sourceState.vectorIndexed, true);
  assert.ok(["rag_ready", "calculation_unverified"].includes(item.sourceState.status));
  assert.ok(item.likelyDomains.includes("finance"));
});
