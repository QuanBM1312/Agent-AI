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

test("price lookup: 'giá bao nhiêu' for a product code returns row details, not a row count", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "Mã hàng H2AT321I08 là gì và giá bao nhiêu trong bảng giá nội bộ?",
    fileName: "bang-gia.csv",
    buffer: csv(`Mã hàng,Tên sản phẩm,Đơn giá
H2AT321I08,Điều hòa Toshiba RAS-18J2AVG-V,42.500.000
H8BTDK0032,Điều khiển RBC-AXU31-E,210000`),
  });

  assert.ok(res);
  assert.equal(res.routeHint, "spreadsheet_calculation");
  assert.equal(res.meta.operation, "price_lookup");
  assert.match(res.output, /H2AT321I08/);
  assert.match(res.output, /Điều hòa Toshiba RAS-18J2AVG-V/);
  assert.match(res.output, /42\.500\.000/);
  assert.doesNotMatch(res.output, /Tổng số dòng dữ liệu/);
});

test("price lookup: a code absent from the sheet must not match unrelated rows", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "Mã hàng H2AT411I05 giá bao nhiêu?",
    fileName: "service.csv",
    buffer: csv(`Tên hàng,Đơn giá
Vệ sinh đường ống nước ngưng,7000
Tháo bộ điều hòa treo tường,300000`),
  });

  // Code not in this service sheet — must NOT confidently return unrelated service
  // rows (the junk-term / weak-match bug). Honest no-match instead.
  assert.ok(res);
  assert.notEqual(res.meta.operation, "price_lookup");
  assert.doesNotMatch(res.output, /Vệ sinh đường ống/);
});

test("internal Toshiba price ignores no-web market-price instructions and prefers product rows", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "Giá nội bộ hàng Toshiba là bao nhiêu? Không dùng giá thị trường.",
    fileName: "bang-gia-noi-bo.csv",
    buffer: csv(`Mặt hàng,Đơn giá
Điều hòa Toshiba RAS-18J2AVG-V,42.500.000
* Không dùng giá thị trường/web cho bảng giá nội bộ Toshiba,0`),
  });

  assert.ok(res);
  assert.equal(res.routeHint, "spreadsheet_calculation");
  assert.equal(res.meta.operation, "price_lookup");
  assert.deepEqual(res.meta.lookupTerms, ["toshiba"]);
  assert.equal(res.meta.matchedRowCount, 1);
  assert.match(res.output, /Điều hòa Toshiba RAS-18J2AVG-V/);
  assert.match(res.output, /42\.500\.000/);
  assert.doesNotMatch(res.output, /Không dùng giá thị trường/);
  assert.doesNotMatch(res.output, /web cho bảng giá nội bộ/);
});

test("price lookup demotes policy rows when a product row also matches", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "Giá Toshiba nội bộ là bao nhiêu? Không dùng web.",
    fileName: "bang-gia-noi-bo.csv",
    buffer: csv(`Tên hàng,Đơn giá
* Giá Toshiba trên web chỉ để tham khảo,0
Máy lạnh Toshiba RAS-H10,12.500.000`),
  });

  assert.ok(res);
  assert.equal(res.meta.operation, "price_lookup");
  assert.deepEqual(res.meta.lookupTerms, ["toshiba"]);
  assert.equal(res.meta.matchedRowCount, 1);
  assert.match(res.output, /Máy lạnh Toshiba RAS-H10/);
  assert.doesNotMatch(res.output, /chỉ để tham khảo/);
});

test("price lookup keeps service rows such as installation as primary matches", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "Giá lắp đặt điều hòa Toshiba là bao nhiêu?",
    fileName: "bang-gia-dich-vu.csv",
    buffer: csv(`Tên dịch vụ,Đơn giá
Lắp đặt điều hòa Toshiba treo tường,1.200.000
* Điều kiện bảo hành áp dụng cho lắp đặt Toshiba,0`),
  });

  assert.ok(res);
  assert.equal(res.meta.operation, "price_lookup");
  assert.match(res.output, /Lắp đặt điều hòa Toshiba treo tường/);
  assert.match(res.output, /1\.200\.000/);
  assert.doesNotMatch(res.output, /Điều kiện bảo hành/);
});

test("price lookup strips no-web instruction terms without dropping public-price planner coverage", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "Giá nội bộ Toshiba không dùng web/google/internet hay giá thị trường.",
    fileName: "bang-gia-noi-bo.csv",
    buffer: csv(`Tên hàng,Đơn giá
Điều hòa Toshiba RAS-H13,13.500.000`),
  });

  assert.ok(res);
  assert.equal(res.meta.operation, "price_lookup");
  assert.deepEqual(res.meta.lookupTerms, ["toshiba"]);
  assert.match(res.output, /Điều hòa Toshiba RAS-H13/);
});

test("price lookup does not match unrelated policy rows when model/code/name is absent", () => {
  const res = resolveSpreadsheetCalculation({
    prompt: "Mã hàng H2AT411I05 giá nội bộ là bao nhiêu? Không dùng web.",
    fileName: "bang-gia-noi-bo.csv",
    buffer: csv(`Tên hàng,Đơn giá
* Không dùng web hoặc giá thị trường cho bảng giá nội bộ,0
Điều hòa Toshiba RAS-H10,12.500.000`),
  });

  assert.ok(res);
  assert.notEqual(res.meta.operation, "price_lookup");
  assert.doesNotMatch(res.output, /Không dùng web/);
  assert.doesNotMatch(res.output, /Điều hòa Toshiba RAS-H10/);
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
