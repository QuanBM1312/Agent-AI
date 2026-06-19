import { test } from "node:test";
import assert from "node:assert/strict";

import { parseNumber, resolveSpreadsheetCalculation } from "./spreadsheet-calculation.ts";

// Golden-answer tests for the deterministic spreadsheet calculation engine.
// Every expected number below is computed by hand so a green run is real proof
// of correctness — not just "HTTP 200 / pipeline alive". Run: `npm run test:unit`.

function csv(content: string): Buffer {
  return Buffer.from(`${content.trim()}\n`, "utf8");
}

const PRICE_LIST = csv(`Mặt hàng,Đơn giá,Số lượng,Thành tiền
Máy lạnh A,12.000.000,2,24.000.000
Tủ lạnh B,8.000.000,5,40.000.000
Máy giặt C,15.000.000,1,15.000.000`);

test("parseNumber handles Vietnamese and international number formats", () => {
  assert.equal(parseNumber("12.000.000"), 12_000_000); // VN dot thousands (was NaN before)
  assert.equal(parseNumber("12,000,000"), 12_000_000); // US comma thousands
  assert.equal(parseNumber("1.234.567,89"), 1_234_567.89); // VN dot thousands + comma decimal
  assert.equal(parseNumber("1,234,567.89"), 1_234_567.89); // US comma thousands + dot decimal
  assert.equal(parseNumber("12,5"), 12.5); // VN comma decimal
  assert.equal(parseNumber("12.5"), 12.5); // plain dot decimal
  assert.equal(parseNumber("8.000.000 ₫"), 8_000_000); // currency + space stripped
  assert.equal(parseNumber("15000000đ"), 15_000_000); // trailing đ stripped
  assert.equal(parseNumber("(1.000)"), -1_000); // accounting negative
  assert.equal(parseNumber(42), 42); // already numeric
  assert.equal(parseNumber("abc"), null);
  assert.equal(parseNumber("12 cái"), null); // text contamination → not a number
  assert.equal(parseNumber(""), null);
});

test("profit/loss sums revenue minus cost (e2e regression: 1.800.000)", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "tính lãi lỗ trong file Excel này",
    fileName: "lai-lo.csv",
    buffer: csv(`Khách hàng,Doanh thu,Giá vốn
A,1000000,700000
B,2500000,1000000`),
  });

  assert.ok(res, "resolution should not be null");
  assert.equal(res.routeHint, "spreadsheet_calculation");
  assert.equal(res.meta.operation, "profit");
  // (1.000.000 + 2.500.000) - (700.000 + 1.000.000) = 1.800.000
  assert.match(res.output, /Lãi\/lỗ = Doanh thu - Chi phí/);
  assert.match(res.output, /1\.800\.000/);
});

test("price filter + sum: tổng Thành tiền của các mặt hàng có đơn giá > 10tr", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "tính tổng giá trị các mặt hàng có đơn giá trên 10 triệu",
    fileName: "bang-gia.csv",
    buffer: PRICE_LIST,
  });

  assert.ok(res);
  assert.equal(res.routeHint, "spreadsheet_calculation");
  assert.equal(res.meta.operation, "aggregate");
  assert.equal(res.meta.originalRowCount, 3);
  assert.equal(res.meta.filteredRowCount, 2); // B (đơn giá 8tr) excluded
  // Thành tiền of A + C = 24.000.000 + 15.000.000 = 39.000.000
  assert.match(res.output, /39\.000\.000/);
});

test("price filter + sum requires amount column instead of summing unit prices", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "tính tổng giá trị các mặt hàng có đơn giá trên 10 triệu",
    fileName: "bang-gia-thieu-thanh-tien.csv",
    buffer: csv(`Mặt hàng,Đơn giá,Số lượng
Máy lạnh A,12.000.000,2
Tủ lạnh B,8.000.000,5
Máy giặt C,15.000.000,1`),
  });

  assert.ok(res);
  assert.equal(res.routeHint, "spreadsheet_calculation_needs_columns");
});

test("count: đếm số mặt hàng có đơn giá > 10tr → 2", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "đếm số mặt hàng có đơn giá trên 10 triệu",
    fileName: "bang-gia.csv",
    buffer: PRICE_LIST,
  });

  assert.ok(res);
  assert.equal(res.routeHint, "spreadsheet_calculation");
  assert.equal(res.meta.operation, "count");
  assert.equal(res.meta.matchedRowCount, 2);
});

test("aggregate without filter sums the amount column", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "tính tổng thành tiền",
    fileName: "tong.csv",
    buffer: csv(`SP,Thành tiền
X,1.000
Y,2.000`),
  });

  assert.ok(res);
  assert.equal(res.meta.operation, "aggregate");
  assert.equal(res.meta.rowFilter, null);
  assert.match(res.output, /3\.000/); // 1.000 + 2.000
});

test("inventory: tổng tồn kho", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "tính tổng tồn kho",
    fileName: "kho.csv",
    buffer: csv(`Mặt hàng,Tồn kho
A,10
B,25`),
  });

  assert.ok(res);
  assert.equal(res.routeHint, "spreadsheet_calculation");
  assert.match(res.output, /35/); // 10 + 25
  assert.ok(
    Array.isArray(res.meta.columns) && (res.meta.columns as string[]).includes("Tồn kho"),
  );
});

test("inventory: 'bao nhiêu tồn kho' means aggregate quantity, not row count", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "còn bao nhiêu hàng tồn kho",
    fileName: "kho.csv",
    buffer: csv(`Mặt hàng,Tồn kho
A,10
B,25`),
  });

  assert.ok(res);
  assert.equal(res.meta.operation, "aggregate");
  assert.match(res.output, /35/);
});

test("inventory: explicit 'đếm số mặt hàng' counts rows, not stock quantity", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "đếm số mặt hàng tồn kho",
    fileName: "kho.csv",
    buffer: csv(`Mặt hàng,Tồn kho
A,10
B,25`),
  });

  assert.ok(res);
  assert.equal(res.meta.operation, "count");
  assert.equal(res.meta.matchedRowCount, 2);
});

test("needs columns when there is no usable numeric column", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "tính tổng doanh thu",
    fileName: "notes.csv",
    buffer: csv(`Tên,Ghi chú
A,tốt
B,ổn`),
  });

  assert.ok(res);
  assert.equal(res.routeHint, "spreadsheet_calculation_needs_columns");
});
