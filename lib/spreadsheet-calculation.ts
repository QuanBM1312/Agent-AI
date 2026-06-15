import * as XLSX from "xlsx";

type CellValue = string | number | boolean | Date | null;

interface SheetData {
  name: string;
  rows: CellValue[][];
}

interface ParsedSpreadsheet {
  fileName: string;
  sheets: SheetData[];
}

interface ColumnProfile {
  index: number;
  name: string;
  normalizedName: string;
  numericCount: number;
  sum: number;
}

interface TableProfile {
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  dataRows: CellValue[][];
  columns: ColumnProfile[];
}

interface RowFilter {
  column: ColumnProfile;
  operator: "gt" | "gte" | "lt" | "lte";
  threshold: number;
  description: string;
}

export interface SpreadsheetCalculationResolution {
  output: string;
  routeHint: "spreadsheet_calculation" | "spreadsheet_calculation_needs_columns";
  citations: string[];
  meta: Record<string, unknown>;
}

const MAX_SPREADSHEET_BYTES = 8 * 1024 * 1024;
const MAX_SHEETS = 8;
const MAX_ROWS_PER_SHEET = 2500;
const MAX_COLUMNS_PER_SHEET = 180;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // NFD does not decompose \u0111/\u0110 (U+0111), so map it explicitly. Without this,
    // "\u0111\u01a1n gi\u00e1" \u2192 "\u0111on gia" and "\u0111\u1ebfm" \u2192 "\u0111em", and every \u0111-keyword regex
    // (don gia, dem, dong, \u2026) silently misses.
    .replace(/\u0111/g, "d")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse a spreadsheet cell into a number, handling the number formats that
// actually show up in Vietnamese business spreadsheets:
//   "12.000.000"      → 12000000   (dot = thousands separator, the VN default)
//   "12,000,000"      → 12000000   (US thousands)
//   "1.234.567,89"    → 1234567.89 (VN: dot thousands, comma decimal)
//   "1,234,567.89"    → 1234567.89 (US: comma thousands, dot decimal)
//   "8.000.000 ₫"     → 8000000    (currency + spaces stripped)
//   "(1.000)"         → -1000      (accounting negative)
// The previous implementation ran Number("12.000.000") → NaN, so every
// dot-grouped Vietnamese price silently dropped out of the calculation.
export function parseNumber(value: CellValue): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  let text = value.trim();
  if (!text) {
    return null;
  }

  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1);
  }

  text = text
    .replace(/\s/g, "")
    .replace(/[₫%]/g, "")
    .replace(/đ/gi, "");

  if (text.startsWith("-")) {
    sign = -sign;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  if (!/[0-9]/.test(text) || !/^[0-9.,]+$/.test(text)) {
    return null;
  }

  const hasDot = text.includes(".");
  const hasComma = text.includes(",");
  let normalized: string;

  if (hasDot && hasComma) {
    // Right-most separator is the decimal point; the other groups thousands.
    const decimalSep = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    normalized = text.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (hasComma) {
    const parts = text.split(",");
    // "12,5" / "12,50" → decimal comma; "12,500" / "1,234,567" → thousands.
    normalized =
      parts.length === 2 && parts[1].length !== 3
        ? `${parts[0]}.${parts[1]}`
        : parts.join("");
  } else if (hasDot) {
    const parts = text.split(".");
    // "12.5" → decimal; "12.000" / "12.000.000" → VN thousands grouping.
    normalized =
      parts.length === 2 && parts[1].length !== 3 ? text : parts.join("");
  } else {
    normalized = text;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? sign * parsed : null;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function parsePromptAmount(valueText: string, unitText?: string) {
  const amount = Number.parseFloat(valueText.replace(",", "."));
  if (!Number.isFinite(amount)) {
    return null;
  }

  const unit = normalizeText(unitText ?? "");
  if (/\b(ty|ti|billion)\b/.test(unit)) {
    return amount * 1_000_000_000;
  }
  if (/\b(tr|trieu|m|million)\b/.test(unit)) {
    return amount * 1_000_000;
  }
  if (/\b(k|nghin|ngan|thousand)\b/.test(unit)) {
    return amount * 1_000;
  }

  return amount;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"" && line[index + 1] === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCsv(buffer: Buffer, fileName: string): ParsedSpreadsheet {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const rows = text
    .split(/\r?\n/)
    .map(parseCsvLine)
    .filter((row) => row.some((cell) => cell.trim() !== ""));

  return {
    fileName,
    sheets: rows.length > 0 ? [{ name: "CSV", rows }] : [],
  };
}

function parseSpreadsheet(buffer: Buffer, fileName: string): ParsedSpreadsheet | null {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension || !["csv", "xls", "xlsx"].includes(extension)) {
    return null;
  }

  if (buffer.byteLength > MAX_SPREADSHEET_BYTES) {
    throw new Error(`Spreadsheet is too large for inline calculation (${buffer.byteLength} bytes)`);
  }

  if (extension === "csv") {
    return parseCsv(buffer, fileName);
  }

  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellNF: false,
    cellText: false,
    WTF: false,
  });

  const sheets = workbook.SheetNames.slice(0, MAX_SHEETS)
    .map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        return null;
      }

      const rows = XLSX.utils
        .sheet_to_json<CellValue[]>(sheet, {
          header: 1,
          raw: true,
          blankrows: false,
          defval: null,
        })
        .slice(0, MAX_ROWS_PER_SHEET)
        .map((row) => row.slice(0, MAX_COLUMNS_PER_SHEET))
        .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));

      return rows.length > 0 ? { name: sheetName, rows } : null;
    })
    .filter((sheet): sheet is SheetData => Boolean(sheet));

  return { fileName, sheets };
}

function detectTables(spreadsheet: ParsedSpreadsheet) {
  const tables: TableProfile[] = [];

  for (const sheet of spreadsheet.sheets) {
    const rows = sheet.rows;
    let bestHeaderIndex = -1;
    let bestScore = 0;

    rows.slice(0, 100).forEach((row, index) => {
      const nonEmpty = row.filter((cell) => String(cell ?? "").trim() !== "");
      const textCount = nonEmpty.filter((cell) => typeof cell === "string").length;
      const numberCount = nonEmpty.filter((cell) => parseNumber(cell) !== null).length;
      const score = textCount * 2 + nonEmpty.length - numberCount;

      if (nonEmpty.length >= 2 && textCount >= 2 && score > bestScore) {
        bestHeaderIndex = index;
        bestScore = score;
      }
    });

    if (bestHeaderIndex < 0) {
      continue;
    }

    const headers = rows[bestHeaderIndex].map((cell, index) => {
      const text = String(cell ?? "").replace(/\s+/g, " ").trim();
      return text || `Cột ${index + 1}`;
    });
    const dataRows = rows
      .slice(bestHeaderIndex + 1)
      .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
    const columns = headers.map((header, index) => {
      const values = dataRows.map((row) => parseNumber(row[index])).filter((value) => value !== null);
      return {
        index,
        name: header,
        normalizedName: normalizeText(header),
        numericCount: values.length,
        sum: values.reduce((total, value) => total + (value ?? 0), 0),
      };
    });

    tables.push({
      sheetName: sheet.name,
      headerRowIndex: bestHeaderIndex,
      headers,
      dataRows,
      columns,
    });
  }

  return tables;
}

function scoreColumn(column: ColumnProfile, patterns: RegExp[]) {
  if (column.numericCount === 0) {
    return 0;
  }

  return patterns.reduce(
    (score, pattern) => score + (pattern.test(column.normalizedName) ? 1 : 0),
    0,
  );
}

function pickColumns(table: TableProfile, patterns: RegExp[], minScore = 1) {
  return table.columns
    .map((column) => ({ column, score: scoreColumn(column, patterns) }))
    .filter((entry) => entry.score >= minScore)
    .sort((a, b) => b.score - a.score || b.column.numericCount - a.column.numericCount)
    .map((entry) => entry.column);
}

function chooseBestTable(tables: TableProfile[], prompt: string) {
  const normalizedPrompt = normalizeText(prompt);
  const terms = normalizedPrompt
    .split(" ")
    .filter((term) => term.length >= 3)
    .slice(0, 12);

  return [...tables].sort((a, b) => {
    const score = (table: TableProfile) => {
      const names = normalizeText(`${table.sheetName} ${table.headers.join(" ")}`);
      return terms.reduce((total, term) => total + (names.includes(term) ? 1 : 0), 0) +
        table.columns.filter((column) => column.numericCount > 0).length;
    };
    return score(b) - score(a);
  })[0];
}

function compareNumber(value: number, operator: RowFilter["operator"], threshold: number) {
  if (operator === "gt") return value > threshold;
  if (operator === "gte") return value >= threshold;
  if (operator === "lt") return value < threshold;
  return value <= threshold;
}

function formatOperator(operator: RowFilter["operator"]) {
  if (operator === "gt") return ">";
  if (operator === "gte") return ">=";
  if (operator === "lt") return "<";
  return "<=";
}

function detectPromptThreshold(prompt: string) {
  const normalized = normalizeText(prompt);
  const patterns: Array<{ operator: RowFilter["operator"]; regex: RegExp }> = [
    { operator: "gte", regex: /\b(?:tu|toi thieu|it nhat|>=)\s*(\d+(?:[.,]\d+)?)\s*(ty|ti|trieu|tr|m|million|nghin|ngan|k)?\b/ },
    { operator: "gt", regex: /\b(?:tren|hon|lon hon|cao hon|vuot qua|>)\s*(\d+(?:[.,]\d+)?)\s*(ty|ti|trieu|tr|m|million|nghin|ngan|k)?\b/ },
    { operator: "lte", regex: /\b(?:khong qua|toi da|<=)\s*(\d+(?:[.,]\d+)?)\s*(ty|ti|trieu|tr|m|million|nghin|ngan|k)?\b/ },
    { operator: "lt", regex: /\b(?:duoi|nho hon|thap hon|<)\s*(\d+(?:[.,]\d+)?)\s*(ty|ti|trieu|tr|m|million|nghin|ngan|k)?\b/ },
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (!match) {
      continue;
    }

    const threshold = parsePromptAmount(match[1], match[2]);
    if (threshold !== null) {
      return {
        operator: pattern.operator,
        threshold,
      };
    }
  }

  return null;
}

function pickFilterColumns(table: TableProfile, prompt: string) {
  const normalizedPrompt = normalizeText(prompt);

  if (/\b(don gia|gia ban|gia niem yet|price|unit price)\b/.test(normalizedPrompt)) {
    return pickColumns(table, [
      /\bdon gia\b/,
      /\bgia ban\b/,
      /\bgia niem yet\b/,
      /\bprice\b/,
      /\bunit price\b/,
      /\bunit cost\b/,
    ]);
  }

  if (/\b(gia|bao gia)\b/.test(normalizedPrompt)) {
    return pickColumns(table, [
      /\bdon gia\b/,
      /\bgia ban\b/,
      /\bgia niem yet\b/,
      /\bgia\b/,
      /\bprice\b/,
    ]);
  }

  if (/\b(so luong|ton kho|sl|quantity|qty)\b/.test(normalizedPrompt)) {
    return pickColumns(table, [
      /\bso luong\b/,
      /\bton kho\b/,
      /\bsl\b/,
      /\bquantity\b/,
      /\bqty\b/,
    ]);
  }

  if (/\b(doanh thu|thanh tien|so tien|gia tri|amount|total)\b/.test(normalizedPrompt)) {
    return pickColumns(table, [
      /\bdoanh thu\b/,
      /\bthanh tien\b/,
      /\bso tien\b/,
      /\bgia tri\b/,
      /\bamount\b/,
      /\btotal\b/,
    ]);
  }

  return [];
}

function buildRowFilter(table: TableProfile, prompt: string): RowFilter | null {
  const threshold = detectPromptThreshold(prompt);
  if (!threshold) {
    return null;
  }

  const column = pickFilterColumns(table, prompt)[0];
  if (!column) {
    return null;
  }

  return {
    column,
    operator: threshold.operator,
    threshold: threshold.threshold,
    description: `${column.name} ${formatOperator(threshold.operator)} ${formatNumber(threshold.threshold)}`,
  };
}

function applyRowFilter(table: TableProfile, filter: RowFilter): TableProfile {
  const dataRows = table.dataRows.filter((row) => {
    const value = parseNumber(row[filter.column.index]);
    return value !== null && compareNumber(value, filter.operator, filter.threshold);
  });

  const columns = table.headers.map((header, index) => {
    const values = dataRows.map((row) => parseNumber(row[index])).filter((value) => value !== null);
    return {
      index,
      name: header,
      normalizedName: normalizeText(header),
      numericCount: values.length,
      sum: values.reduce((total, value) => total + (value ?? 0), 0),
    };
  });

  return {
    ...table,
    dataRows,
    columns,
  };
}

function buildNeedsColumnsResolution(params: {
  spreadsheet: ParsedSpreadsheet;
  tables: TableProfile[];
}): SpreadsheetCalculationResolution {
  const tableLines = params.tables.slice(0, 6).map((table) => {
    const numericHeaders = table.columns
      .filter((column) => column.numericCount > 0)
      .slice(0, 8)
      .map((column) => column.name)
      .join(", ");
    return `- Sheet "${table.sheetName}" dòng header ${table.headerRowIndex + 1}: ${numericHeaders || "chưa thấy cột số rõ"}`;
  });

  return {
    output: [
      `Tôi đã đọc được file "${params.spreadsheet.fileName}", nhưng chưa xác định chắc cột nào phải dùng để tính.`,
      "Hãy hỏi lại bằng tên cột cụ thể, ví dụ: `tính tổng cột Thành tiền` hoặc `lãi/lỗ = Doanh thu - Giá vốn`.",
      tableLines.length ? "Các bảng/cột số tôi thấy:" : "",
      ...tableLines,
    ].filter(Boolean).join("\n"),
    routeHint: "spreadsheet_calculation_needs_columns",
    citations: [params.spreadsheet.fileName],
    meta: {
      spreadsheetFile: params.spreadsheet.fileName,
      sheetCount: params.spreadsheet.sheets.length,
      tableCount: params.tables.length,
    },
  };
}

function buildAggregateResolution(params: {
  spreadsheet: ParsedSpreadsheet;
  table: TableProfile;
  columns: ColumnProfile[];
  prompt: string;
  operationLabel: string;
  rowFilter: RowFilter | null;
  originalRowCount: number;
}): SpreadsheetCalculationResolution {
  const lines = params.columns.slice(0, 6).map((column) => {
    return `- ${column.name}: ${formatNumber(column.sum)} (${column.numericCount} dòng số)`;
  });
  const total = params.columns.reduce((sum, column) => sum + column.sum, 0);
  const shouldShowGrandTotal = params.columns.length === 1 || /\b(cong cac cot|tong cac cot|grand total)\b/.test(
    normalizeText(params.prompt),
  );

  return {
    output: [
      `Tôi đã tính từ file "${params.spreadsheet.fileName}", sheet "${params.table.sheetName}".`,
      params.rowFilter
        ? `Điều kiện lọc: ${params.rowFilter.description}. Giữ ${params.table.dataRows.length}/${params.originalRowCount} dòng dữ liệu.`
        : "",
      shouldShowGrandTotal
        ? `${params.operationLabel}: ${formatNumber(total)}`
        : `${params.operationLabel} theo từng cột liên quan (không cộng chéo vì có thể là các chỉ tiêu khác nhau):`,
      "Chi tiết cột:",
      ...lines,
      `Nguồn: header dòng ${params.table.headerRowIndex + 1}, ${params.table.dataRows.length} dòng dữ liệu có nội dung.`,
    ].filter(Boolean).join("\n"),
    routeHint: "spreadsheet_calculation",
    citations: [`${params.spreadsheet.fileName} / ${params.table.sheetName}`],
    meta: {
      spreadsheetFile: params.spreadsheet.fileName,
      sheet: params.table.sheetName,
      headerRow: params.table.headerRowIndex + 1,
      columns: params.columns.map((column) => column.name),
      operation: "aggregate",
      rowFilter: params.rowFilter?.description ?? null,
      originalRowCount: params.originalRowCount,
      filteredRowCount: params.table.dataRows.length,
    },
  };
}

function buildCountResolution(params: {
  spreadsheet: ParsedSpreadsheet;
  table: TableProfile;
  rowFilter: RowFilter | null;
  originalRowCount: number;
}): SpreadsheetCalculationResolution {
  const count = params.table.dataRows.length;

  return {
    output: [
      `Tôi đã đếm từ file "${params.spreadsheet.fileName}", sheet "${params.table.sheetName}".`,
      params.rowFilter ? `Điều kiện lọc: ${params.rowFilter.description}.` : "",
      params.rowFilter
        ? `Số dòng thỏa điều kiện: ${formatNumber(count)}/${params.originalRowCount}`
        : `Tổng số dòng dữ liệu: ${formatNumber(count)}`,
      `Nguồn: header dòng ${params.table.headerRowIndex + 1}, ${params.originalRowCount} dòng dữ liệu có nội dung.`,
    ]
      .filter(Boolean)
      .join("\n"),
    routeHint: "spreadsheet_calculation",
    citations: [`${params.spreadsheet.fileName} / ${params.table.sheetName}`],
    meta: {
      spreadsheetFile: params.spreadsheet.fileName,
      sheet: params.table.sheetName,
      headerRow: params.table.headerRowIndex + 1,
      operation: "count",
      rowFilter: params.rowFilter?.description ?? null,
      originalRowCount: params.originalRowCount,
      matchedRowCount: count,
    },
  };
}

function buildProfitResolution(params: {
  spreadsheet: ParsedSpreadsheet;
  table: TableProfile;
  revenue: ColumnProfile;
  cost: ColumnProfile;
  rowFilter: RowFilter | null;
  originalRowCount: number;
}): SpreadsheetCalculationResolution {
  const profit = params.revenue.sum - params.cost.sum;
  const margin = params.revenue.sum !== 0 ? profit / params.revenue.sum : null;

  return {
    output: [
      `Tôi đã tính lãi/lỗ từ file "${params.spreadsheet.fileName}", sheet "${params.table.sheetName}".`,
      params.rowFilter
        ? `Điều kiện lọc: ${params.rowFilter.description}. Giữ ${params.table.dataRows.length}/${params.originalRowCount} dòng dữ liệu.`
        : "",
      `Doanh thu (${params.revenue.name}): ${formatNumber(params.revenue.sum)}`,
      `Chi phí/giá vốn (${params.cost.name}): ${formatNumber(params.cost.sum)}`,
      `Lãi/lỗ = Doanh thu - Chi phí = ${formatNumber(profit)}`,
      margin !== null ? `Biên lợi nhuận: ${formatNumber(margin * 100)}%` : "",
      `Nguồn: header dòng ${params.table.headerRowIndex + 1}, ${params.table.dataRows.length} dòng dữ liệu có nội dung.`,
    ].filter(Boolean).join("\n"),
    routeHint: "spreadsheet_calculation",
    citations: [`${params.spreadsheet.fileName} / ${params.table.sheetName}`],
    meta: {
      spreadsheetFile: params.spreadsheet.fileName,
      sheet: params.table.sheetName,
      headerRow: params.table.headerRowIndex + 1,
      revenueColumn: params.revenue.name,
      costColumn: params.cost.name,
      operation: "profit",
      rowFilter: params.rowFilter?.description ?? null,
      originalRowCount: params.originalRowCount,
      filteredRowCount: params.table.dataRows.length,
    },
  };
}

export function resolveSpreadsheetCalculation(params: {
  prompt: string;
  fileName: string;
  buffer: Buffer;
}): SpreadsheetCalculationResolution | null {
  const spreadsheet = parseSpreadsheet(params.buffer, params.fileName);
  if (!spreadsheet) {
    return null;
  }

  const tables = detectTables(spreadsheet);
  if (tables.length === 0) {
    return buildNeedsColumnsResolution({ spreadsheet, tables });
  }

  const prompt = normalizeText(params.prompt);
  const table = chooseBestTable(tables, prompt);
  if (!table) {
    return buildNeedsColumnsResolution({ spreadsheet, tables });
  }

  const rowFilter = buildRowFilter(table, params.prompt);
  const originalRowCount = table.dataRows.length;
  const calculationTable = rowFilter ? applyRowFilter(table, rowFilter) : table;

  const revenueColumns = pickColumns(calculationTable, [
    /\bdoanh thu\b/,
    /\bthanh tien\b/,
    /\btien ban\b/,
    /\bgia ban\b/,
    /\bban ra\b/,
    /\bamount\b/,
    /\brevenue\b/,
  ]);
  const costColumns = pickColumns(calculationTable, [
    /\bchi phi\b/,
    /\bgia von\b/,
    /\bgia nhap\b/,
    /\btien nhap\b/,
    /\bcost\b/,
    /\bexpense\b/,
  ]);
  const inventoryColumns = pickColumns(calculationTable, [
    /\bton cuoi\b/,
    /\bton kho\b/,
    /\bsl con lai\b/,
    /\bso luong\b/,
    /\bkhoi luong\b/,
    /\bquantity\b/,
    /\bqty\b/,
  ]);
  const amountColumns = pickColumns(calculationTable, [
    /\btong\b/,
    /\bthanh tien\b/,
    /\bso tien\b/,
    /\bgia tri\b/,
    /\bamount\b/,
    /\btotal\b/,
  ]);

  if (/\b(lai lo|loi nhuan|profit|margin)\b/.test(prompt)) {
    const revenue = revenueColumns[0];
    const cost = costColumns[0];
    if (revenue && cost) {
      return buildProfitResolution({
        spreadsheet,
        table: calculationTable,
        revenue,
        cost,
        rowFilter,
        originalRowCount,
      });
    }
    return buildNeedsColumnsResolution({ spreadsheet, tables });
  }

  if (/\b(dem|bao nhieu|co bao nhieu|co may|may mat hang|how many|count)\b/.test(prompt)) {
    return buildCountResolution({
      spreadsheet,
      table: calculationTable,
      rowFilter,
      originalRowCount,
    });
  }

  if (/\b(ton kho|nhap xuat ton|sl con lai|so luong|khoi luong|quantity|qty)\b/.test(prompt)) {
    if (inventoryColumns.length > 0) {
      return buildAggregateResolution({
        spreadsheet,
        table: calculationTable,
        columns: inventoryColumns,
        prompt: params.prompt,
        operationLabel: "Tổng số lượng/tồn kho",
        rowFilter,
        originalRowCount,
      });
    }
  }

  if (/\b(tong|doanh thu|thanh tien|so tien|gia tri|amount|total)\b/.test(prompt)) {
    const columns = amountColumns.length > 0 ? amountColumns : revenueColumns;
    if (columns.length > 0) {
      return buildAggregateResolution({
        spreadsheet,
        table: calculationTable,
        columns,
        prompt: params.prompt,
        operationLabel: "Tổng",
        rowFilter,
        originalRowCount,
      });
    }
  }

  return buildNeedsColumnsResolution({ spreadsheet, tables });
}
