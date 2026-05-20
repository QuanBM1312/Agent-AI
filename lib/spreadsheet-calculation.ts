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
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value: CellValue) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value
    .replace(/\s/g, "")
    .replace(/[₫đ,%]/gi, "")
    .replace(/\(([-+]?\d)/, "-$1")
    .replace(/\)$/g, "");

  if (!cleaned || !/[0-9]/.test(cleaned)) {
    return null;
  }

  const normalized =
    cleaned.includes(",") && cleaned.includes(".")
      ? cleaned.replace(/,/g, "")
      : cleaned.replace(/,/g, ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
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
      shouldShowGrandTotal
        ? `${params.operationLabel}: ${formatNumber(total)}`
        : `${params.operationLabel} theo từng cột liên quan (không cộng chéo vì có thể là các chỉ tiêu khác nhau):`,
      "Chi tiết cột:",
      ...lines,
      `Nguồn: header dòng ${params.table.headerRowIndex + 1}, ${params.table.dataRows.length} dòng dữ liệu có nội dung.`,
    ].join("\n"),
    routeHint: "spreadsheet_calculation",
    citations: [`${params.spreadsheet.fileName} / ${params.table.sheetName}`],
    meta: {
      spreadsheetFile: params.spreadsheet.fileName,
      sheet: params.table.sheetName,
      headerRow: params.table.headerRowIndex + 1,
      columns: params.columns.map((column) => column.name),
      operation: "aggregate",
    },
  };
}

function buildProfitResolution(params: {
  spreadsheet: ParsedSpreadsheet;
  table: TableProfile;
  revenue: ColumnProfile;
  cost: ColumnProfile;
}): SpreadsheetCalculationResolution {
  const profit = params.revenue.sum - params.cost.sum;
  const margin = params.revenue.sum !== 0 ? profit / params.revenue.sum : null;

  return {
    output: [
      `Tôi đã tính lãi/lỗ từ file "${params.spreadsheet.fileName}", sheet "${params.table.sheetName}".`,
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

  const revenueColumns = pickColumns(table, [
    /\bdoanh thu\b/,
    /\bthanh tien\b/,
    /\btien ban\b/,
    /\bgia ban\b/,
    /\bban ra\b/,
    /\bamount\b/,
    /\brevenue\b/,
  ]);
  const costColumns = pickColumns(table, [
    /\bchi phi\b/,
    /\bgia von\b/,
    /\bgia nhap\b/,
    /\btien nhap\b/,
    /\bcost\b/,
    /\bexpense\b/,
  ]);
  const inventoryColumns = pickColumns(table, [
    /\bton cuoi\b/,
    /\bton kho\b/,
    /\bsl con lai\b/,
    /\bso luong\b/,
    /\bkhoi luong\b/,
    /\bquantity\b/,
    /\bqty\b/,
  ]);
  const amountColumns = pickColumns(table, [
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
      return buildProfitResolution({ spreadsheet, table, revenue, cost });
    }
    return buildNeedsColumnsResolution({ spreadsheet, tables });
  }

  if (/\b(ton kho|nhap xuat ton|sl con lai|so luong|khoi luong|quantity|qty)\b/.test(prompt)) {
    if (inventoryColumns.length > 0) {
      return buildAggregateResolution({
        spreadsheet,
        table,
        columns: inventoryColumns,
        prompt: params.prompt,
        operationLabel: "Tổng số lượng/tồn kho",
      });
    }
  }

  if (/\b(tong|doanh thu|thanh tien|so tien|gia tri|amount|total)\b/.test(prompt)) {
    const columns = amountColumns.length > 0 ? amountColumns : revenueColumns;
    if (columns.length > 0) {
      return buildAggregateResolution({
        spreadsheet,
        table,
        columns,
        prompt: params.prompt,
        operationLabel: "Tổng",
      });
    }
  }

  return buildNeedsColumnsResolution({ spreadsheet, tables });
}
