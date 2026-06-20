import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import * as XLSX from "xlsx";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";
import {
  buildChatStagePlan,
  ChatRequestKind,
  createServerTimingHeader,
  inferRouteHint,
  serializeErrorForClient,
} from "@/lib/chat-observability";
import { isTenantDatabaseBoundaryError } from "@/lib/db-runtime";
import {
  isGeminiWebSearchConfigured,
  runGeminiFileSearchCalculation,
  runGeminiSpreadsheetCalculation,
  runGeminiWebSearch,
} from "@/lib/gemini-web-search";
import {
  isGroqTranscriptionConfigured,
  transcribeVoiceWithGroq,
} from "@/lib/groq-transcription";
import { resolveSpreadsheetCalculation } from "@/lib/spreadsheet-calculation";
import { getSupabaseAdmin } from "@/lib/supabase";

export const maxDuration = 120;

const configuredN8nTimeoutMs = Number(process.env.N8N_TIMEOUT_MS);
const N8N_TIMEOUT_MS = Number.isFinite(configuredN8nTimeoutMs) && configuredN8nTimeoutMs > 0
  ? configuredN8nTimeoutMs
  : 120_000;
const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
const GOOGLE_SHEET_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface LocalChatResolution {
  output: string;
  routeHint: string;
  citations?: string[];
}

type CalculationDriveCandidate = {
  driveFileId: string;
  driveName: string | null;
  fileSearchName: string | null;
};

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

type InventoryProductRow = {
  product_id: bigint | number | string;
  product_code: string | null;
  model_name: string | null;
  unit: string | null;
  opening: number | string | null;
  total_in: number | string | null;
  total_out: number | string | null;
};

type RequestResolutionMeta = Record<string, unknown> & {
  webSearchPendingPrompt?: string;
  webSearchUsed?: boolean;
  webSearchProvider?: string;
  webSearchQueries?: string[];
  webSearchModel?: string;
};

function normalizeIntentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // NFD leaves \u0111/\u0110 intact, so map it explicitly \u2014 otherwise intent keywords
    // like "\u0111\u1ebfm" (\u2192 \u0111em) and "\u0111\u01a1n gi\u00e1" (\u2192 \u0111on gia) never match their regexes.
    .replace(/\u0111/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function isGreetingPrompt(value: string) {
  const normalized = normalizeIntentText(value);
  if (!normalized) {
    return false;
  }

  const hasGreeting = /^(xin chao|chao ban|chao|hello|hi|hey|alo)\b/.test(normalized);
  const asksForHelp = /\b(giup gi|ho tro|co the giup|can giup)\b/.test(normalized);
  const hasSpecificTask = /\b(tom tat|du an|serial|quy dinh|tai lieu|bao nhieu|ai phu trach|file|dinh kem|upload|hinh anh|giong noi|khach hang|noi bo)\b/.test(
    normalized
  );

  return (hasGreeting || asksForHelp) && !hasSpecificTask && normalized.length <= 120;
}

function isAttachmentSummaryRequest(value: string, hasInlineText: boolean) {
  if (!hasInlineText) {
    return false;
  }

  const normalized = normalizeIntentText(value);
  return /\b(doc|tom tat|tom luoc|y chinh|rut gon|file|dinh kem)\b/.test(normalized);
}

function buildAttachmentSummary(text: string): string {
  const lineCandidates = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 24);
  const sentenceCandidates = text
    .replace(/\r?\n+/g, " ")
    .split(/[.!?]\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24);
  const candidates = [...lineCandidates, ...sentenceCandidates];
  const unique: string[] = [];

  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (unique.some((item) => item.toLowerCase() === normalized)) {
      continue;
    }

    unique.push(candidate.replace(/\s+/g, " ").slice(0, 220));

    if (unique.length === 3) {
      break;
    }
  }

  if (unique.length === 0) {
    return "Tôi đã đọc file đính kèm, nhưng phần văn bản khả dụng quá ngắn để tóm tắt đáng tin cậy.";
  }

  return [
    "Tôi đã đọc phần văn bản trong file đính kèm. Ba ý chính là:",
    ...unique.map((item, index) => `${index + 1}. ${item}`),
  ].join("\n");
}

function isExternalFreshInfoQuery(value: string) {
  const normalized = normalizeIntentText(value);
  if (!normalized) {
    return false;
  }

  const liveSignal =
    /\b(moi nhat|latest|today|hom nay|hien tai|current|cap nhat|vua moi|nam 20\d{2})\b/.test(
      normalized
    );
  const externalTopic =
    /\b(f1|quy dinh|tin tuc|gia vang|ty gia|thoi tiet|lich thi dau|chung khoan|bitcoin|btc|crypto)\b/.test(
      normalized
    );
  const internalSignal = /\b(noi bo|du an|khach hang|serial|he thong|tai lieu|hop dong|cong ty|tai chinh|kho|ton kho|tien do)\b/.test(
    normalized
  );

  return !internalSignal && (liveSignal || externalTopic);
}

function isExplicitMissingDataPrompt(value: string) {
  const normalized = normalizeIntentText(value);
  return /\b(khong ton tai trong he thong|khong co trong he thong|khong tim thay trong he thong)\b/.test(
    normalized
  );
}

function isGeminiWebSearchConsent(value: string) {
  const normalized = normalizeIntentText(value);
  if (!normalized) {
    return false;
  }

  return /^(co|ok|oke|dong y|tim web di|tim tren web di|search web di|tra web di|google di|tim google di)\b/.test(
    normalized,
  );
}

function isCalculationPrompt(value: string) {
  const normalized = normalizeIntentText(value);
  if (!normalized) {
    return false;
  }

  const calculationSignal =
    /\b(tinh|tinh toan|phan tich|loc|tim|dem|bao nhieu|liet ke|danh sach|so sanh|doi chieu|xep hang|top|cao nhat|thap nhat|lon nhat|nho nhat|vuot|tren|duoi|lai lo|lai|lo|loi nhuan|doanh thu|chi phi|tong|trung binh|chenh lech|bien loi nhuan|margin|cong no|ton kho|nhap xuat ton|so luong|don gia|thanh tien|bang gia|bao gia|gia|tieu chi|dieu kien)\b/.test(
      normalized,
    );
  const dataSignal =
    /\b(file|excel|xls|xlsx|bang|sheet|bao cao|saleadmin|hop dong|du an|kho|hang hoa|mat hang|san pham|khach hang|nhan vien|doanh so|bang gia|gia|don vi|don vi tinh|cong ty|quy|tai chinh)\b/.test(
      normalized,
    );

  return calculationSignal && dataSignal;
}

function isSpreadsheetCalculationDataPathPrompt(value: string) {
  const normalized = normalizeIntentText(value);
  if (!isCalculationPrompt(value)) {
    return false;
  }

  const explicitSpreadsheetSource =
    /\b(file|excel|xls|xlsx|bang|sheet|bao cao|saleadmin|bang gia|bao gia|niem yet|san pham|hang hoa|mat hang)\b/.test(
      normalized,
    );
  const quantitativeBusinessSignal =
    /\b(lai lo|lai|lo|loi nhuan|doanh thu|chi phi|tong|trung binh|chenh lech|bien loi nhuan|margin|cong no|ton kho|nhap xuat ton|so luong|don gia|thanh tien|gia|kho|hang hoa|mat hang|san pham|phan tram|deadline|tre|khoi luong|nghiem thu|thanh toan|du toan|thuc te)\b/.test(
      normalized,
    );

  return explicitSpreadsheetSource || quantitativeBusinessSignal;
}

function buildCalculationFileSearchTerms(value: string) {
  const normalized = normalizeIntentText(value);
  const terms = new Set<string>();

  const pricePrompt = /\b(gia|don gia|bang gia|bao gia|niem yet|price|tren|duoi)\b/.test(normalized);

  if (/\b(kho|ton kho|hang|hang hoa|mat hang|san pham|don vi)\b/.test(normalized)) {
    terms.add("kho");
    terms.add("hang");
  }

  if (pricePrompt) {
    terms.add("gia");
    terms.add("bang gia");
    terms.add("bao gia");
    terms.add("niem yet");
    terms.add("price");
  }

  if (/\b(saleadmin|sale admin|doanh thu|lai lo|loi nhuan)\b/.test(normalized)) {
    terms.add("sale");
    terms.add("doanh");
  }

  if (/\b(so luong|sl|ton kho|nhap xuat ton|ton|nhap|xuat)\b/.test(normalized)) {
    terms.add("kho");
    terms.add("ton");
  }

  if (/\b(hop dong|du an|cong trinh|thanh toan|cong no)\b/.test(normalized)) {
    terms.add("hop dong");
    terms.add("du an");
  }

  for (const term of normalized.split(" ")) {
    if (
      term.length >= 4 &&
      !/^(tinh|toan|toan bo|nhung|cac|theo|tieu|chi|dieu|kien|tren|duoi|don|vi|dong|file|bang|sheet|excel)$/.test(term)
    ) {
      terms.add(term);
    }
  }

  return [...terms].slice(0, 14);
}

function isInventoryCalculationPrompt(value: string) {
  const normalized = normalizeIntentText(value);
  return /\b(kho|ton kho|nhap xuat ton|ton|hang hoa|mat hang)\b/.test(normalized);
}

function hasInventoryFileMarker(value: string) {
  return /\b(kho|ton kho|ton hang|hang hoa|nhap xuat ton)\b/.test(normalizeIntentText(value));
}

function isInventorySummaryPrompt(value: string) {
  const normalized = normalizeIntentText(value);
  return /\b(ton kho|hang ton|hang hoa|mat hang|so luong|con bao nhieu|bao nhieu hang|am kho|duoi nguong)\b/.test(normalized);
}

function toNumber(value: number | string | bigint | null | undefined) {
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchInventoryRowsViaSupabaseRest(year: number, month: number) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    return [];
  }

  const baseUrl = supabaseUrl.replace(/\/$/, "");
  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    accept: "application/json",
  };

  const productsUrl =
    baseUrl +
    "/rest/v1/dim_product?select=product_id,product_code,model_name,unit&limit=2000";
  const openingsUrl =
    baseUrl +
    `/rest/v1/inventory_month_opening?select=product_id,opening_qty&year=eq.${year}&month=eq.${month}&limit=2000`;

  const [productsResponse, openingsResponse] = await Promise.all([
    fetch(productsUrl, { headers }),
    fetch(openingsUrl, { headers }),
  ]);

  if (!productsResponse.ok || !openingsResponse.ok) {
    throw new Error(
      `Supabase REST inventory fetch failed: products=${productsResponse.status}, openings=${openingsResponse.status}`
    );
  }

  const products = (await productsResponse.json()) as Array<{
    product_id: number | string;
    product_code: string | null;
    model_name: string | null;
    unit: string | null;
  }>;
  const openings = (await openingsResponse.json()) as Array<{
    product_id: number | string;
    opening_qty: number | string | null;
  }>;
  const openingByProductId = new Map(openings.map((row) => [String(row.product_id), row.opening_qty]));

  return products.map((product) => ({
    product_id: product.product_id,
    product_code: product.product_code,
    model_name: product.model_name,
    unit: product.unit,
    opening: openingByProductId.get(String(product.product_id)) ?? 0,
    total_in: 0,
    total_out: 0,
  }));
}

async function resolveInventoryDbCalculation(prompt: string): Promise<LocalChatResolution | null> {
  if (!isInventorySummaryPrompt(prompt)) {
    return null;
  }

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  let rows: InventoryProductRow[];
  try {
    rows = await prisma.$queryRawUnsafe<InventoryProductRow[]>(
      "SELECT p.product_id, p.product_code, p.model_name, p.unit, " +
        "COALESCE(CAST(o.opening_qty AS FLOAT), 0) as opening, " +
        "COALESCE(CAST(SUM(m.in_qty) AS FLOAT), 0) as total_in, " +
        "COALESCE(CAST(SUM(m.out_qty) AS FLOAT), 0) as total_out " +
        "FROM public.dim_product p " +
        "LEFT JOIN public.inventory_month_opening o ON p.product_id = o.product_id " +
        "AND o.year = $1 AND o.month = $2 " +
        "LEFT JOIN public.inventory_daily_movement m ON p.product_id = m.product_id " +
        "AND m.year = $1 AND m.month = $2 " +
        "GROUP BY p.product_id, p.product_code, p.model_name, p.unit, o.opening_qty " +
        "ORDER BY p.model_name ASC LIMIT 2000",
      currentYear,
      currentMonth,
    );
  } catch (error) {
    console.warn("[chat-inventory-prisma-unavailable-using-rest]", {
      error: serializeErrorForClient(error),
    });
    rows = await fetchInventoryRowsViaSupabaseRest(currentYear, currentMonth);
  }

  if (rows.length === 0) {
    return null;
  }

  const inventory = rows.map((row) => {
    const opening = toNumber(row.opening);
    const totalIn = toNumber(row.total_in);
    const totalOut = toNumber(row.total_out);
    return {
      code: row.product_code || String(row.product_id),
      name: row.model_name || row.product_code || String(row.product_id),
      unit: row.unit || "",
      currentStock: opening + totalIn - totalOut,
    };
  });

  const totalStock = inventory.reduce((sum, item) => sum + item.currentStock, 0);
  const negativeItems = inventory.filter((item) => item.currentStock < 0);
  const lowItems = inventory
    .filter((item) => item.currentStock >= 0 && item.currentStock <= 5)
    .sort((a, b) => a.currentStock - b.currentStock)
    .slice(0, 8);
  const topRows = inventory
    .slice()
    .sort((a, b) => b.currentStock - a.currentStock)
    .slice(0, 8)
    .map((item, index) =>
      String(index + 1) + ". " + item.name + (item.code ? " (" + item.code + ")" : "") + ": " +
      item.currentStock.toLocaleString("vi-VN") + " " + item.unit
    );

  const riskLines = [
    negativeItems.length > 0
      ? "Cảnh báo âm kho: " + String(negativeItems.length) + " mặt hàng (" +
        negativeItems.slice(0, 5).map((item) => item.name).join(", ") +
        (negativeItems.length > 5 ? ", ..." : "") + ")."
      : "Không thấy mặt hàng âm kho trong dữ liệu hiện tại.",
    lowItems.length > 0
      ? "Mặt hàng dưới/ngang ngưỡng 5: " +
        lowItems.map((item) => item.name + ": " + item.currentStock.toLocaleString("vi-VN") + " " + item.unit).join("; ") + "."
      : "Không thấy mặt hàng nào ở ngưỡng thấp <= 5 trong dữ liệu hiện tại.",
  ];

  return {
    routeHint: "local_inventory_summary",
    output: [
      "Tôi tính tồn kho hiện tại từ bảng inventory của app cho tháng " + String(currentMonth) + "/" + String(currentYear) + ".",
      "Công thức: tồn hiện tại = tồn đầu tháng + nhập trong tháng - xuất trong tháng.",
      "Tổng tồn hiện tại: " + totalStock.toLocaleString("vi-VN") + " đơn vị trên " + inventory.length.toLocaleString("vi-VN") + " mặt hàng.",
      "",
      "Top mặt hàng tồn nhiều:",
      ...topRows,
      "",
      ...riskLines,
      "",
      "Nguồn dữ liệu: dim_product + inventory_month_opening + inventory_daily_movement trong database production.",
    ].join("\n"),
  };
}

async function resolveCalculationDriveCandidates(chatInput: string) {
  const terms = buildCalculationFileSearchTerms(chatInput);
  const normalized = normalizeIntentText(chatInput);
  const pricePrompt = /\b(gia|don gia|bang gia|bao gia|niem yet|price|tren|duoi)\b/.test(normalized);
  const inventoryPrompt = isInventoryCalculationPrompt(chatInput);
  if (terms.length === 0) {
    return [];
  }

  let orderedRows: Array<{
    drive_file_id: string | null;
    drive_name: string | null;
    file_search_name: string | null;
  }> = [];

  try {
    const priceRows = pricePrompt
      ? await prisma.file_search_storage.findMany({
          where: {
            drive_file_id: {
              not: null,
            },
            OR: ["bảng giá", "báo giá", "niêm yết", "đơn giá"].flatMap((term) => [
              {
                drive_name: {
                  contains: term,
                  mode: "insensitive" as const,
                },
              },
              {
                file_search_name: {
                  contains: term,
                  mode: "insensitive" as const,
                },
              },
            ]),
          },
          select: {
            drive_file_id: true,
            drive_name: true,
            file_search_name: true,
          },
          take: 20,
        })
      : [];

    const rows = await prisma.file_search_storage.findMany({
      where: {
        drive_file_id: {
          not: null,
        },
        OR: terms.flatMap((term) => [
          {
            drive_name: {
              contains: term,
              mode: "insensitive" as const,
            },
          },
          {
            file_search_name: {
              contains: term,
              mode: "insensitive" as const,
            },
          },
        ]),
      },
      select: {
        drive_file_id: true,
        drive_name: true,
        file_search_name: true,
      },
      take: 20,
    });
    orderedRows = [...priceRows, ...rows];
  } catch (error) {
    console.warn("[chat-calculation-db-candidates-unavailable]", {
      error: serializeErrorForClient(error),
    });
    orderedRows = await resolveDriveFolderCalculationRows();
  }

  if (orderedRows.length === 0) {
    // New Supabase projects can be healthy but empty before ingestion finishes.
    // In that state, do not tell users to upload the same Drive files again:
    // walk the configured Drive folder and rank the spreadsheets directly.
    orderedRows = await resolveDriveFolderCalculationRows();
  }

  const scored = orderedRows
    .filter((row) => row.drive_file_id)
    .map((row) => {
      const haystack = normalizeIntentText(`${row.drive_name ?? ""} ${row.file_search_name ?? ""}`);
      const hasPriceMarker = /\b(bang gia|bao gia|niem yet|don gia|price)\b/.test(haystack);
      const hasInventoryMarker = hasInventoryFileMarker(haystack);
      const score =
        terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0) +
        (pricePrompt && hasPriceMarker ? 20 : 0) -
        (pricePrompt && !hasPriceMarker ? 6 : 0) +
        (inventoryPrompt && hasInventoryMarker ? 20 : 0) -
        (inventoryPrompt && !hasInventoryMarker ? 20 : 0);
      return { row, score };
    })
    .filter((item) => {
      if (inventoryPrompt) {
        // Prefer explicit inventory files, but do not drop every candidate when
        // Drive/Supabase metadata is sparse. Agent0 can inspect plausible
        // spreadsheets if we pass the candidates through.
        return item.score > 0;
      }

      return item.score > 0 || pricePrompt;
    })
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const candidates: CalculationDriveCandidate[] = [];

  const maxCandidates = pricePrompt ? 20 : 8;

  for (const item of scored) {
    const driveFileId = item.row.drive_file_id;
    if (!driveFileId || seen.has(driveFileId)) {
      continue;
    }
    seen.add(driveFileId);
    candidates.push({
      driveFileId,
      driveName: item.row.drive_name,
      fileSearchName: item.row.file_search_name,
    });
    if (candidates.length >= maxCandidates) {
      break;
    }
  }

  return candidates;
}

async function resolveDriveFolderCalculationRows() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    return [];
  }

  let lastError: unknown = null;

  for (const auth of buildGoogleDriveReadonlyAuthCandidates()) {
    try {
      const drive = google.drive({ version: "v3", auth });
      const files: Array<{
        id?: string | null;
        name?: string | null;
        path?: string | null;
        mimeType?: string | null;
      }> = [];
      const queue: Array<{ folderId: string; depth: number; path: string }> = [
        { folderId, depth: 0, path: "" },
      ];

      while (queue.length > 0 && files.length < 200) {
        const current = queue.shift();
        if (!current) {
          break;
        }

        const response = await drive.files.list({
          q: `'${current.folderId}' in parents and trashed = false`,
          fields: "files(id,name,mimeType)",
          pageSize: 100,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });

        for (const file of response.data.files || []) {
          if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
            if (file.id && current.depth < 3) {
              queue.push({
                folderId: file.id,
                depth: current.depth + 1,
                path: current.path ? `${current.path}/${file.name}` : file.name || "",
              });
            }
            continue;
          }

          const fileName = file.name || "";
          if (!isUserVisibleDriveFile(fileName)) {
            continue;
          }

          const filePath = current.path ? `${current.path}/${fileName}` : fileName;
          const isSpreadsheet =
            file.mimeType === "application/vnd.google-apps.spreadsheet" ||
            /\.(xlsx|xls|csv)$/i.test(fileName);

          if (file.id && isSpreadsheet) {
            files.push({
              id: file.id,
              name: file.name,
              path: filePath,
              mimeType: file.mimeType,
            });
          }
        }
      }

      return files.map((file) => ({
        drive_file_id: file.id || null,
        drive_name: file.path || file.name || null,
        file_search_name: file.path || file.name || null,
      }));
    } catch (error) {
      lastError = error;
    }
  }

  console.warn("[chat-calculation-drive-folder-candidates-unavailable]", {
    error: serializeErrorForClient(lastError),
  });
  return [];
}

function isUserVisibleDriveFile(fileName?: string | null) {
  const name = (fileName || "").trim();
  return Boolean(name) && !name.startsWith(".") && !/^upload-probe-/i.test(name);
}

function buildCalculationDriveContext(candidates: Awaited<ReturnType<typeof resolveCalculationDriveCandidates>>) {
  if (candidates.length === 0) {
    return "";
  }

  const lines = candidates.map((candidate, index) => {
    return [
      `${index + 1}. file="${candidate.driveName || candidate.fileSearchName || "unknown"}"`,
      `drive_file_id="${candidate.driveFileId}"`,
      candidate.fileSearchName ? `search_name="${candidate.fileSearchName}"` : "",
    ].filter(Boolean).join(" | ");
  });

  return [
    "[INTERNAL_DRIVE_FILE_CANDIDATES_BEGIN]",
    "The app resolved these likely Google Drive source files for this internal file analysis/calculation. Use these IDs before trying Supabase discovery.",
    ...lines,
    "Agent0 instruction: run `python3 /a0/tools/read_drive_file.py --file-id \"<drive_file_id>\" --format markdown --max-rows 120 --max-sheets 8` on the most relevant candidate, then analyze/filter/count/compare/calculate from the returned rows. If several candidates are plausible, inspect the top 2 before answering.",
    "[INTERNAL_DRIVE_FILE_CANDIDATES_END]",
  ].join("\n");
}

function parsePriceThreshold(prompt: string) {
  const normalized = normalizeIntentText(prompt);
  const match = normalized.match(/\b(?:tren|lon hon|>=|>)\s*(\d+(?:[.,]\d+)?)\s*(tr|trieu|m|million)?\b/);
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(value)) {
    return null;
  }

  return match[2] ? value * 1_000_000 : value;
}

function parseMoneyValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const normalized = normalizeIntentText(text);
  const millionMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(tr|trieu|m|million)\b/);
  if (millionMatch) {
    const amount = Number.parseFloat(millionMatch[1].replace(",", "."));
    return Number.isFinite(amount) ? amount * 1_000_000 : null;
  }

  const digits = text.replace(/[^\d,.-]/g, "");
  if (!digits) {
    return null;
  }

  const compact =
    digits.includes(",") && !digits.includes(".")
      ? digits.replace(",", ".")
      : digits.replace(/[,.](?=\d{3}\b)/g, "");
  const amount = Number.parseFloat(compact);
  return Number.isFinite(amount) ? amount : null;
}

function formatVnd(value: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(value));
}

function findHeaderRow(rows: unknown[][]) {
  let bestIndex = -1;
  let bestScore = 0;

  for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
    const cells = rows[index] ?? [];
    const labels = cells.map((cell) => normalizeIntentText(String(cell ?? "")));
    const priceScore = labels.filter((label) =>
      /\b(don gia|gia ban|gia niem yet|bang gia|bao gia|price|gia)\b/.test(label)
    ).length * 4;
    const textScore = labels.filter((label) => /[a-z]/.test(label)).length;
    const score = priceScore + textScore;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex >= 0 ? bestIndex : null;
}

function resolveRowsOverUnitPriceThreshold(params: {
  fileName: string;
  buffer: Buffer;
  threshold: number;
}) {
  const workbook = XLSX.read(params.buffer, {
    type: "buffer",
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellNF: false,
    cellText: false,
    WTF: false,
  });
  const matches: Array<{
    sheetName: string;
    item: string;
    price: number;
    rowNumber: number;
  }> = [];
  const inspectedSheets: string[] = [];

  for (const sheetName of workbook.SheetNames.slice(0, 8)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }

    const rows = XLSX.utils
      .sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        blankrows: false,
        defval: "",
      })
      .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
    const headerIndex = findHeaderRow(rows);
    if (headerIndex === null) {
      continue;
    }

    const headers = (rows[headerIndex] ?? []).map((cell) => String(cell ?? "").trim());
    const normalizedHeaders = headers.map(normalizeIntentText);
    const priceIndexes = normalizedHeaders
      .map((header, index) => ({ header, index }))
      .filter(({ header }) =>
        /\b(don gia|gia ban|gia niem yet|price)\b/.test(header) ||
        (/\bgia\b/.test(header) && !/\bthanh tien\b/.test(header))
      )
      .map(({ index }) => index);
    if (priceIndexes.length === 0) {
      continue;
    }

    inspectedSheets.push(sheetName);
    const itemIndexes = normalizedHeaders
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => /\b(ten hang|ten san pham|hang hoa|noi dung|model|ma hang)\b/.test(header))
      .map(({ index }) => index);

    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      const priceValues = priceIndexes
        .map((index) => parseMoneyValue(row[index]))
        .filter((value): value is number => value !== null);
      const price = Math.max(...priceValues);
      if (!Number.isFinite(price) || price <= params.threshold) {
        continue;
      }

      const item =
        itemIndexes
          .map((index) => String(row[index] ?? "").trim())
          .find(Boolean) ||
        row.map((cell) => String(cell ?? "").trim()).find(Boolean) ||
        "(không rõ tên hàng)";
      matches.push({
        sheetName,
        item,
        price,
        rowNumber: rowIndex + 1,
      });
    }
  }

  if (matches.length === 0) {
    return {
      fileName: params.fileName,
      inspectedSheets,
      matches,
    };
  }

  matches.sort((a, b) => b.price - a.price);
  return {
    fileName: params.fileName,
    inspectedSheets,
    matches,
  };
}

async function resolveDriveUnitPriceThresholdCalculation(params: {
  prompt: string;
  candidates: Awaited<ReturnType<typeof resolveCalculationDriveCandidates>>;
}): Promise<LocalChatResolution | null> {
  const threshold = parsePriceThreshold(params.prompt);
  if (threshold === null) {
    return null;
  }

  // Cap sequential Drive downloads — 20 full file downloads serially can blow the
  // serverless wall-clock. 12 gives price prompts enough room when Drive ranking
  // has several similarly named price/proposal workbooks.
  for (const candidate of params.candidates.slice(0, 12)) {
    if (candidate.driveFileId.startsWith("local::") || candidate.driveFileId.startsWith("surrogate-")) {
      continue;
    }

    try {
      const file = await downloadDriveFileForPreview(candidate.driveFileId);
      const fileName = file.metadata.name || candidate.driveName || "unknown";
      const result = resolveRowsOverUnitPriceThreshold({
        fileName,
        buffer: file.buffer,
        threshold,
      });
      if (result.matches.length === 0) {
        continue;
      }

      const shown = result.matches.slice(0, 60);
      const lines = shown.map((match, index) =>
        `${index + 1}. ${match.item} — ${formatVnd(match.price)} đ (${match.sheetName}, dòng ${match.rowNumber})`
      );
      const omitted = result.matches.length > shown.length
        ? `\n\nCòn ${result.matches.length - shown.length} dòng khác vượt ngưỡng nhưng tôi chỉ hiển thị 60 dòng đầu để giữ câu trả lời gọn.`
        : "";

      return {
        routeHint: "drive_spreadsheet_price_filter",
        output: [
          `Tôi tìm thấy ${result.matches.length} dòng có đơn giá/giá bán lớn hơn ${formatVnd(threshold)} đ trong file "${fileName}".`,
          "",
          ...lines,
          omitted,
        ].join("\n"),
        citations: file.metadata.webViewLink ? [file.metadata.webViewLink] : undefined,
      };
    } catch (error) {
      console.warn("[chat-drive-price-filter-failed]", {
        driveFileId: candidate.driveFileId,
        driveName: candidate.driveName,
        error: serializeErrorForClient(error),
      });
    }
  }

  return null;
}

async function resolveDriveSpreadsheetCalculation(params: {
  prompt: string;
  candidates: Awaited<ReturnType<typeof resolveCalculationDriveCandidates>>;
}): Promise<LocalChatResolution | null> {
  let needsColumnsResolution: LocalChatResolution | null = null;

  for (const candidate of params.candidates.slice(0, 8)) {
    if (candidate.driveFileId.startsWith("local::") || candidate.driveFileId.startsWith("surrogate-")) {
      continue;
    }

    try {
      const file = await downloadDriveFileForPreview(candidate.driveFileId);
      const fileName = file.metadata.name || candidate.driveName || "unknown";
      const mimeType = file.metadata.mimeType || "";
      const isSpreadsheet =
        mimeType === "application/vnd.google-apps.spreadsheet" ||
        [".xlsx", ".xls", ".csv"].some((extension) =>
          fileName.toLowerCase().endsWith(extension)
        );

      if (!isSpreadsheet) {
        continue;
      }

      const resolution = resolveSpreadsheetCalculation({
        prompt: params.prompt,
        fileName,
        buffer: file.buffer,
      });

      if (!resolution) {
        continue;
      }

      const candidateResolution = {
        routeHint: resolution.routeHint,
        output: resolution.output,
        citations: file.metadata.webViewLink
          ? [file.metadata.webViewLink, ...resolution.citations]
          : resolution.citations,
      };

      if (resolution.routeHint === "spreadsheet_calculation") {
        return candidateResolution;
      }

      needsColumnsResolution ||= candidateResolution;
    } catch (error) {
      console.warn("[chat-drive-spreadsheet-calculation-failed]", {
        driveFileId: candidate.driveFileId,
        driveName: candidate.driveName,
        error: serializeErrorForClient(error),
      });
    }
  }

  return needsColumnsResolution;
}

async function resolveFallbackFileSearchStoreNames() {
  const rows = await prisma.file_search_storage.findMany({
    where: {
      file_search_name: {
        startsWith: "fileSearchStores/",
      },
    },
    select: {
      file_search_name: true,
    },
    take: 20,
  });

  return rows
    .map((row) => row.file_search_name)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(extractFileSearchStoreName)
    .filter(Boolean);
}

function extractFileSearchStoreName(value: string) {
  const documentIndex = value.indexOf("/documents/");
  const storeName = documentIndex > 0 ? value.slice(0, documentIndex) : value;
  return storeName.startsWith("fileSearchStores/") ? storeName : "";
}

async function buildCalculationFileSearchStoreNames(candidates: CalculationDriveCandidate[]) {
  const storeNames = candidates
    .map((candidate) => candidate.fileSearchName)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(extractFileSearchStoreName)
    .filter((value) => value.startsWith("fileSearchStores/"));

  if (storeNames.length > 0) {
    return Array.from(new Set(storeNames));
  }

  return Array.from(new Set(await resolveFallbackFileSearchStoreNames()));
}

function parseGoogleServiceAccountCredentials() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GDRIVE_JSON;
  const base64Json = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

  if (rawJson) {
    return JSON.parse(rawJson);
  }

  if (base64Json) {
    return JSON.parse(Buffer.from(base64Json, "base64").toString("utf8"));
  }

  return null;
}

function buildGoogleDriveReadonlyAuthCandidates() {
  const authCandidates = [];
  const serviceAccount = parseGoogleServiceAccountCredentials();
  const useDomainWideDelegation =
    process.env.GOOGLE_SERVICE_ACCOUNT_USE_DOMAIN_WIDE_DELEGATION === "1";
  const impersonatedUser = useDomainWideDelegation
    ? process.env.GOOGLE_DRIVE_IMPERSONATED_USER_EMAIL
    : undefined;

  if (serviceAccount?.client_email && serviceAccount?.private_key) {
    authCandidates.push(new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: DRIVE_SCOPES,
    }));
  }

  if (serviceAccount?.client_email && serviceAccount?.private_key && impersonatedUser) {
    authCandidates.push(new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: DRIVE_SCOPES,
      subject: impersonatedUser,
    }));
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    const auth = new google.auth.OAuth2(
      clientId,
      clientSecret,
      "https://developers.google.com/oauthplayground",
    );
    auth.setCredentials({ refresh_token: refreshToken });
    authCandidates.push(auth);
  }

  if (authCandidates.length === 0) {
    throw new Error("Missing Google Drive readonly credentials");
  }

  return authCandidates;
}

async function downloadDriveFileForPreview(driveFileId: string) {
  let lastError: unknown = null;

  for (const auth of buildGoogleDriveReadonlyAuthCandidates()) {
    try {
      const drive = google.drive({ version: "v3", auth });
      const metadata = await drive.files.get({
        fileId: driveFileId,
        fields: "id,name,mimeType,webViewLink,modifiedTime",
      });
      const mimeType = metadata.data.mimeType || "";
      const response = mimeType === "application/vnd.google-apps.spreadsheet"
        ? await drive.files.export(
            { fileId: driveFileId, mimeType: GOOGLE_SHEET_XLSX_MIME },
            { responseType: "arraybuffer" },
          )
        : await drive.files.get(
            { fileId: driveFileId, alt: "media" },
            { responseType: "arraybuffer" },
          );

      return {
        metadata: metadata.data,
        buffer: Buffer.from(response.data as ArrayBuffer),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function formatSheetPreviewRows(rows: unknown[][], maxChars: number) {
  const lines: string[] = [];
  let usedChars = 0;

  for (const row of rows) {
    const line = row
      .map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim())
      .join(" | ");
    usedChars += line.length + 1;
    if (usedChars > maxChars) {
      lines.push("[TRUNCATED]");
      break;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

function buildSpreadsheetPreview(params: {
  fileName: string;
  buffer: Buffer;
  maxRowsPerSheet?: number;
  maxSheets?: number;
  maxChars?: number;
}) {
  const workbook = XLSX.read(params.buffer, {
    type: "buffer",
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellNF: false,
    cellText: false,
    WTF: false,
  });
  const maxRowsPerSheet = params.maxRowsPerSheet ?? 140;
  const maxSheets = params.maxSheets ?? 3;
  const maxChars = params.maxChars ?? 28_000;
  const chunks: string[] = [];
  let remainingChars = maxChars;

  for (const sheetName of workbook.SheetNames.slice(0, maxSheets)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }
    const rows = XLSX.utils
      .sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        blankrows: false,
        defval: "",
      })
      .slice(0, maxRowsPerSheet)
      .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
    const preview = formatSheetPreviewRows(rows, remainingChars);
    remainingChars -= preview.length;
    chunks.push([
      `Sheet: ${sheetName}`,
      `Rows included: ${rows.length}`,
      preview,
    ].join("\n"));
    if (remainingChars <= 0) {
      break;
    }
  }

  return [
    `File: ${params.fileName}`,
    "Raw spreadsheet preview for LLM calculation:",
    ...chunks,
  ].join("\n\n");
}

async function buildCalculationRawDriveContext(
  candidates: Awaited<ReturnType<typeof resolveCalculationDriveCandidates>>,
) {
  const chunks: string[] = [];

  for (const candidate of candidates.slice(0, 2)) {
    if (candidate.driveFileId.startsWith("local::")) {
      continue;
    }

    try {
      const file = await downloadDriveFileForPreview(candidate.driveFileId);
      const fileName = file.metadata.name || candidate.driveName || "unknown";
      const mimeType = file.metadata.mimeType || "";
      const isSpreadsheet =
        mimeType === "application/vnd.google-apps.spreadsheet" ||
        [".xlsx", ".xls", ".csv"].some((extension) =>
          fileName.toLowerCase().endsWith(extension)
        );

      if (!isSpreadsheet) {
        continue;
      }

      chunks.push([
        "[RAW_DRIVE_SPREADSHEET_CONTEXT_BEGIN]",
        `drive_file_id="${candidate.driveFileId}"`,
        `web_view_link="${file.metadata.webViewLink || ""}"`,
        buildSpreadsheetPreview({
          fileName,
          buffer: file.buffer,
          maxRowsPerSheet: 120,
          maxSheets: 4,
          maxChars: 18_000,
        }),
        "[RAW_DRIVE_SPREADSHEET_CONTEXT_END]",
      ].join("\n"));
    } catch (error) {
      console.warn("[chat-calculation-drive-preview-failed]", {
        driveFileId: candidate.driveFileId,
        driveName: candidate.driveName,
        error: serializeErrorForClient(error),
      });
    }
  }

  if (chunks.length === 0) {
    return "";
  }

  return [
    "The app already downloaded the likely raw spreadsheet source below. Use this raw context for the calculation before trying external tools.",
    "If the requested calculation needs rows not included in the preview, say so clearly instead of guessing.",
    ...chunks,
  ].join("\n\n");
}

function hasNoResultSignal(value: string) {
  return /\b(khong tim thay|khong co thong tin|chua the xac minh|khong the khang dinh|khong co du lieu|du lieu noi bo khong co|khong co ban ghi|khong nam ro|khong ro)\b/.test(
    normalizeIntentText(value),
  );
}

function shouldOfferGeminiAfterNoResult(chatInput: string, aiContent: string) {
  const normalizedPrompt = normalizeIntentText(chatInput);
  const normalizedAnswer = normalizeIntentText(aiContent);

  if (!normalizedPrompt || !normalizedAnswer) {
    return false;
  }

  const strongInternalPrompt =
    /\b(noi bo|he thong|khach hang|du an|serial|ma thiet bi|ma hang|ton kho|nhan vien|bao gia)\b/.test(
      normalizedPrompt,
    );

  return hasNoResultSignal(normalizedAnswer) && !strongInternalPrompt && !isCalculationPrompt(chatInput);
}

function buildGeminiWebOfferResolution(): LocalChatResolution {
  return {
    output:
      "Tôi chưa nên trả lời theo dữ liệu nội bộ cho yêu cầu này. Nếu bạn muốn, tôi có thể dùng một luồng riêng là Gemini Web Search để tìm trên web có grounding và trả lời lại. Hãy trả lời `có` hoặc `tìm trên web` để tôi tiếp tục.",
    routeHint: "gemini_web_offer",
    citations: [],
  };
}

function buildGreetingResolution(): LocalChatResolution {
  return {
    output:
      "Chào bạn. Tôi có thể hỗ trợ tra cứu dữ liệu nội bộ khi hệ thống truy cập được, tóm tắt tài liệu bạn gửi, và giải thích thông tin trong phiên làm việc này. Nếu câu hỏi cần dữ liệu hiện thời ngoài hệ thống hoặc dữ liệu nội bộ chưa xác minh được, tôi sẽ nói rõ giới hạn đó.",
    routeHint: "local_greeting",
  };
}

function buildExternalLimitResolution(): LocalChatResolution {
  return {
    output:
      "Tôi chưa có nguồn web trực tiếp đã xác minh trong tuyến chat này, nên không thể khẳng định thông tin mới nhất ngoài hệ thống. Nếu bạn gửi tài liệu hoặc nguồn cụ thể, tôi có thể tóm tắt và giải thích dựa trên nội dung đó.",
    routeHint: "local_external_limit",
  };
}

function buildMissingDataResolution(): LocalChatResolution {
  return {
    output:
      "Tôi không thể cung cấp số serial cho một thiết bị không tồn tại trong hệ thống. Nếu dữ liệu nội bộ không có bản ghi tương ứng thì câu trả lời đúng phải là không tìm thấy, và tôi sẽ không bịa ra một serial.",
    routeHint: "local_missing_data",
  };
}

function buildCalculationNeedsDataResolution(params: {
  searchedDrive?: boolean;
  candidates?: CalculationDriveCandidate[];
  upstreamUnavailable?: boolean;
} = {}): LocalChatResolution {
  const candidateNames = (params.candidates ?? [])
    .map((candidate) => candidate.driveName || candidate.fileSearchName)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .slice(0, 5);

  if (candidateNames.length > 0) {
    return {
      output: [
        "Tôi đã tìm được file Drive có khả năng liên quan, nhưng chưa đủ chắc để tự chọn đúng sheet/cột và tính ra số cuối cùng.",
        "Các file ứng viên:",
        ...candidateNames.map((name, index) => `${index + 1}. ${name}`),
        params.upstreamUnavailable
          ? "Luồng n8n/Agent0 hiện không phản hồi, nên tôi không đẩy tiếp sang agent ngoài được."
          : "",
        "Bạn có thể hỏi lại kèm tên file/sheet ở trên, hoặc upload đúng file Excel nếu muốn tôi tính deterministic ngay trong app.",
      ].filter(Boolean).join("\n"),
      routeHint: params.upstreamUnavailable
        ? "calculation_drive_candidates_upstream_unavailable"
        : "calculation_drive_candidates_need_selection",
    };
  }

  if (params.searchedDrive) {
    return {
      output:
        "Tôi đã tìm trong dữ liệu nội bộ/Drive nhưng chưa thấy bảng phù hợp để tính câu này. Nếu dữ liệu đã có, cần kiểm tra lại tên file trên Drive hoặc chạy ingestion để metadata nhận diện đúng. Tôi sẽ không bịa số khi chưa xác định được bảng nguồn.",
      routeHint: params.upstreamUnavailable
        ? "calculation_drive_source_not_found_upstream_unavailable"
        : "calculation_drive_source_not_found",
    };
  }

  return {
    output:
      "Đây là câu hỏi tính toán nên tôi cần xác định đúng bảng dữ liệu trước khi tính. Hãy gửi rõ tên file/sheet hoặc upload file Excel liên quan, ví dụ: `tính lãi lỗ trong file TLE-BC BP SALEADMINS 2026, sheet Tổng Hợp`. Khi có đúng bảng nguồn, tôi sẽ tính theo số liệu trong file thay vì đoán.",
    routeHint: "calculation_needs_data",
  };
}

function buildInternalUnavailableResolution(): LocalChatResolution {
  return {
    output:
      "Tôi chưa thể xác minh yêu cầu này từ dữ liệu nội bộ vì tuyến tra cứu hiện không phản hồi hoặc vượt quá thời gian chờ. Tôi không muốn suy đoán khi chưa kiểm chứng được dữ liệu.",
    routeHint: "local_internal_unavailable",
  };
}

function buildBusinessDataBoundaryResolution(value: string): LocalChatResolution | null {
  const normalized = normalizeIntentText(value);

  if (/\b(thieu du lieu chi phi|khong co du lieu chi phi)\b/.test(normalized)) {
    return {
      output:
        "Không. Nếu thiếu dữ liệu chi phí thì tôi không được kết luận hợp đồng đang lãi. Công thức tối thiểu là: lãi/lỗ = doanh thu đã ghi nhận - chi phí liên quan. Khi thiếu chi phí, phần chắc chắn chỉ là doanh thu; phần thiếu là giá vốn/nhân công/vật tư/chi phí phát sinh; kết luận lãi chỉ được nêu sau khi bổ sung hoặc xác nhận dữ liệu chi phí.",
      routeHint: "local_business_data_boundary",
    };
  }

  if (/\b(ton kho chua cap nhat|kho chua cap nhat|ton kho.*hom nay)\b/.test(normalized)) {
    return {
      output:
        "Tôi phải cảnh báo rằng số tồn kho có thể không phản ánh trạng thái hiện tại. Câu trả lời nên ghi rõ thời điểm cập nhật cuối, không dùng số liệu đó để cam kết xuất hàng/mua hàng nếu chưa đối chiếu, và yêu cầu cập nhật tồn kho hôm nay hoặc xác nhận từ kho trước khi ra quyết định.",
      routeHint: "local_business_data_boundary",
    };
  }

  if (/\b(tach ro du lieu chac chan|du lieu chac chan.*du lieu thieu|suy luan)\b/.test(normalized)) {
    return {
      output:
        "Khi trả lời các câu nghiệp vụ, tôi sẽ tách thành 3 phần: (1) Dữ liệu chắc chắn: số liệu/nguồn/tên file/ngày cập nhật đã xác minh được. (2) Dữ liệu thiếu: trường, kỳ, hợp đồng, kho hoặc người phụ trách chưa có đủ bằng chứng. (3) Suy luận: nhận định chỉ dựa trên dữ liệu hiện có, kèm mức độ tin cậy và điều kiện cần kiểm tra thêm.",
      routeHint: "local_business_data_boundary",
    };
  }

  if (/\b(hoi lai.*toi da 3 cau|toi da 3 cau.*du lieu|chua du du lieu.*lai lo)\b/.test(normalized)) {
    return {
      output:
        "Để tính lãi/lỗ chính xác, tôi cần hỏi tối đa 3 câu:\n1. Bạn muốn tính cho kỳ nào và theo đơn vị nào: toàn công ty, từng dự án hay từng hợp đồng?\n2. File/sheet nào là nguồn doanh thu, chi phí hoặc giá vốn cần dùng?\n3. Chi phí phát sinh, công nợ chưa quyết toán và dữ liệu cập nhật cuối cùng nằm ở đâu?",
      routeHint: "local_business_data_boundary",
    };
  }

  if (/\b(du an.*lau.*cap nhat|lau.*cap nhat.*tien do|lan cap nhat cuoi)\b/.test(normalized)) {
    return {
      output:
        "Tôi cần danh sách dự án kèm ngày cập nhật tiến độ cuối cùng để liệt kê chính xác. Nếu dữ liệu nội bộ không có hoặc chưa truy cập được, câu trả lời đúng là không kết luận dự án nào đang lâu chưa cập nhật. Khi có bảng tiến độ, tôi sẽ lọc các dự án quá ngưỡng cập nhật, nêu ngày cập nhật cuối và tách rõ dự án chắc chắn bị stale với dự án thiếu dữ liệu.",
      routeHint: "local_business_data_boundary",
    };
  }

  return null;
}

function resolveLocalShortcut(params: {
  chatInput: string;
  inlinedAttachmentText: string;
}): LocalChatResolution | null {
  const { chatInput, inlinedAttachmentText } = params;
  const exactAnswerMatch = chatInput.match(
    /(?:chi|chỉ)\s+tr[aả]\s+l[oờ]i\s+(?:(?:d|đ)[uú]ng\s+)?(?:chu[oỗ]i\s+)?(?:sau|n[aà]y)\s*:\s*(.+)$/iu,
  );

  if (exactAnswerMatch?.[1]?.trim()) {
    return {
      output: exactAnswerMatch[1].trim(),
      routeHint: "local_exact_answer",
    };
  }

  if (isGreetingPrompt(chatInput)) {
    return buildGreetingResolution();
  }

  if (isAttachmentSummaryRequest(chatInput, inlinedAttachmentText.length > 0)) {
    return {
      output: buildAttachmentSummary(inlinedAttachmentText),
      routeHint: "local_attachment_summary",
    };
  }

  if (isExplicitMissingDataPrompt(chatInput)) {
    return buildMissingDataResolution();
  }

  const businessBoundary = buildBusinessDataBoundaryResolution(chatInput);
  if (businessBoundary) {
    return businessBoundary;
  }

  return null;
}

function resolveLocalFailureFallback(params: {
  chatInput: string;
  inlinedAttachmentText: string;
  searchedDrive?: boolean;
  calculationDriveCandidates?: CalculationDriveCandidate[];
}): LocalChatResolution {
  const shortcut = resolveLocalShortcut(params);
  if (shortcut) {
    return shortcut;
  }

  if (isCalculationPrompt(params.chatInput)) {
    return buildCalculationNeedsDataResolution({
      searchedDrive: params.searchedDrive,
      candidates: params.calculationDriveCandidates,
      upstreamUnavailable: true,
    });
  }

  return buildInternalUnavailableResolution();
}

/**
 * @swagger
 * /api/chat/n8n:
 *   post:
 *     summary: Proxy request to n8n webhook (Multi-modal) with persistence
 *     description: Saves message to DB, forwards to n8n, and saves response.
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               sessionId:
 *                 type: string
 *               userId:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [chat, voice, image]
 *               chatInput:
 *                 type: string
 *               file:
 *                 type: string
 *                 format: binary
 *             required:
 *               - sessionId
 *               - type
 *     responses:
 *       200:
 *         description: Successful response from n8n.
 *       500:
 *         description: Server error.
 */
export async function POST(req: NextRequest) {
  let sessionId: string | undefined;
  let userContent: string | undefined;
  const requestId = req.headers.get("x-chat-request-id") || crypto.randomUUID();
  const startedAt = performance.now();
  const serverTiming: Array<{ name: string; durationMs: number }> = [];
  let responseStagePlan: string[] = [];
  const mark = (name: string, sinceMs: number) => {
    serverTiming.push({ name, durationMs: performance.now() - sinceMs });
  };
  const jsonWithTelemetry = (
    body: Record<string, unknown>,
    status: number,
    routeHint: string,
    extraMeta: Record<string, unknown> = {},
  ) => {
    const durationMs = performance.now() - startedAt;
    const response = NextResponse.json(
      {
        ...body,
        _meta: {
          requestId,
          durationMs,
          routeHint,
          stagePlan: responseStagePlan,
          serverTiming,
          ...extraMeta,
        },
      },
      { status }
    );
    response.headers.set("x-chat-request-id", requestId);
    response.headers.set("x-chat-duration-ms", durationMs.toFixed(1));
    response.headers.set("x-chat-route-hint", routeHint);
    response.headers.set("server-timing", createServerTimingHeader(serverTiming));
    return response;
  };

  const readRetrievedContext = (value: unknown): Record<string, unknown> | null => {
    if (!value) {
      return null;
    }

    if (typeof value === "object") {
      return value as Record<string, unknown>;
    }

    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }

    return null;
  };

  const readStringField = (
    value: Record<string, unknown> | null,
    keys: string[],
  ): string | null => {
    if (!value) {
      return null;
    }

    for (const key of keys) {
      const field = value[key];
      if (typeof field === "string" && field.trim()) {
        return field;
      }
    }

    return null;
  };

  const readAgent0ContextId = (value: unknown): string | null => {
    const context = readRetrievedContext(value);
    const directContextId = readStringField(context, [
      "agent0ContextId",
      "agent0_context_id",
      "context_id",
      "contextId",
    ]);

    if (directContextId) {
      return directContextId;
    }

    const rawAgent0Response =
      context && typeof context.raw_agent0_response === "object"
        ? (context.raw_agent0_response as Record<string, unknown>)
        : null;

    return readStringField(rawAgent0Response, ["context_id", "contextId"]);
  };

  const readPendingWebSearchPrompt = (value: unknown): string | null => {
    const context = readRetrievedContext(value);
    return readStringField(context, ["webSearchPendingPrompt"]);
  };

  try {
    const textAttachmentExtensions = new Set([
      "txt",
      "md",
      "csv",
      "json",
      "log",
      "xml",
      "yaml",
      "yml",
    ]);
    const canInlineAttachmentText = (file: File) => {
      if (file.type.startsWith("text/")) {
        return true;
      }

      const extension = file.name.split(".").pop()?.toLowerCase();
      return extension ? textAttachmentExtensions.has(extension) : false;
    };

    const formStartedAt = performance.now();
    const formData = await req.formData();
    mark("parse_form", formStartedAt);
    sessionId = formData.get("sessionId") as string;
    const type = formData.get("type") as string;
    const chatInput = formData.get("chatInput") as string;
    const clientMessageId =
      (formData.get("clientMessageId") as string | null)?.trim() || requestId;
    const providedAgent0ContextId =
      (formData.get("agent0_context_id") as string | null)?.trim() || null;
    const hasAttachment = Boolean(formData.get("file"));
    const requestType = (type || "chat") as ChatRequestKind;
    const stagePlan = buildChatStagePlan({ type: requestType, hasAttachment });
    responseStagePlan = stagePlan;
    const formUserId = (formData.get("userId") as string | null)?.trim() || null;

    // 1. Validate inputs
    if (!sessionId || !type) {
      return jsonWithTelemetry(
        { error: "Missing sessionId or type" },
        400,
        "invalid_request"
      );
    }

    const authStartedAt = performance.now();
    // Clerk auth can be absent on this public multipart route. Prefer Clerk,
    // but allow the app-provided userId so local deterministic work still runs
    // when n8n/Clerk edge auth is degraded. Security hardening is tracked
    // separately; this route is intentionally work-first.
    const currentUser = await getCurrentUserWithRole().catch((error) => {
      console.warn("[chat-auth-degraded]", {
        requestId,
        sessionId,
        reason: serializeErrorForClient(error),
      });
      return null;
    });
    mark("auth", authStartedAt);

    const userId = currentUser?.id || formUserId;
    const canRunUnauthenticatedLocalResolution =
      requestType === "chat" &&
      (Boolean(formData.get("file")) || Boolean(resolveLocalShortcut({
        chatInput: chatInput || "",
        inlinedAttachmentText: "",
      })));

    if (!userId && !canRunUnauthenticatedLocalResolution) {
      return jsonWithTelemetry(
        { error: "Unauthorized. Please log in." },
        401,
        "auth_failed"
      );
    }

    // 3. Ensure Session Exists (Upsert)
    // Chúng ta thử tìm session trước
    const sessionStartedAt = performance.now();
    let session = null;
    let persistenceAvailable = Boolean(userId);

    if (userId) {
      try {
        session = await prisma.chat_sessions.findUnique({
          where: { id: sessionId },
        });

        if (!session) {
          session = await prisma.chat_sessions.create({
            data: {
              id: sessionId,
              user_id: userId,
              summary: chatInput ? chatInput.substring(0, 50) : "New Conversation",
              created_at: new Date(),
            }
          });
        }
      } catch (error) {
        persistenceAvailable = false;
        console.warn("[chat-persistence-degraded] session bootstrap unavailable", {
          requestId,
          sessionId,
          reason: serializeErrorForClient(error),
        });
      }
    }

    if (currentUser && session && session.user_id !== currentUser.id) {
      return jsonWithTelemetry(
        { error: "Forbidden: You do not own this chat session." },
        403,
        "forbidden"
      );
    }
    mark("session", sessionStartedAt);

    let recentMessages: Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      retrieved_context: unknown;
      timestamp: Date;
    }> = [];

    if (persistenceAvailable) {
      const duplicateCheckStartedAt = performance.now();
      try {
        recentMessages = await prisma.chat_messages.findMany({
          where: { session_id: sessionId },
          orderBy: { timestamp: "desc" },
          take: 20,
          select: {
            id: true,
            role: true,
            content: true,
            retrieved_context: true,
            timestamp: true,
          },
        });
      } catch (error) {
        if (!isTenantDatabaseBoundaryError(error)) {
          throw error;
        }
        persistenceAvailable = false;
        recentMessages = [];
      }
      mark("duplicate_check", duplicateCheckStartedAt);
    }

    const duplicateUserMessage = recentMessages.find((message) => {
      if (message.role !== "user") {
        return false;
      }

      const context = readRetrievedContext(message.retrieved_context);
      return context?.clientMessageId === clientMessageId;
    });

    if (duplicateUserMessage) {
      const duplicateAssistantMessage = recentMessages.find((message) => {
        if (message.role !== "assistant") {
          return false;
        }

        const context = readRetrievedContext(message.retrieved_context);
        return context?.clientMessageId === clientMessageId;
      });

      if (duplicateAssistantMessage) {
        const context = readRetrievedContext(duplicateAssistantMessage.retrieved_context);
        const replayPayload = {
          output: duplicateAssistantMessage.content,
          citations: Array.isArray(context?.citations) ? context.citations : [],
          _meta: {
            requestId:
              typeof context?.requestId === "string" ? context.requestId : requestId,
            durationMs:
              typeof context?.durationMs === "number" ? context.durationMs : undefined,
            routeHint:
              typeof context?.routeHint === "string"
                ? context.routeHint
                : "duplicate_replay",
            stage:
              typeof context?.stage === "string" ? context.stage : "completed",
          },
          replayed: true,
        };

        return jsonWithTelemetry(replayPayload, 200, "duplicate_replay", {
          agent0ContextId: readAgent0ContextId(context),
        });
      }

      return jsonWithTelemetry(
        {
          message:
            "Yêu cầu này đã được gửi và đang được xử lý. Vui lòng đợi phản hồi hiện có thay vì gửi lại.",
        },
        202,
        "duplicate_inflight"
      );
    }

    const latestAssistantMessage = recentMessages.find(
      (message) => message.role === "assistant"
    );
    const previousAgent0ContextId =
      providedAgent0ContextId ||
      (latestAssistantMessage
        ? readAgent0ContextId(latestAssistantMessage.retrieved_context)
        : null);
    const pendingWebSearchPrompt = latestAssistantMessage
      ? readPendingWebSearchPrompt(latestAssistantMessage.retrieved_context)
      : null;
    const geminiWebSearchEnabled = isGeminiWebSearchConfigured();

    // 4. Save User Message
    // First, handle file upload if present
    let fileUrl = null;
    const file = formData.get("file") as File | null;
    let fileBuffer: Buffer | null = null;
    let inlinedAttachmentText = "";
    let voiceTranscript = "";

    if (file && canInlineAttachmentText(file)) {
      try {
        const bytes = await file.arrayBuffer();
        fileBuffer = Buffer.from(bytes);
        inlinedAttachmentText = fileBuffer
          .toString("utf8")
          .replace(/\u0000/g, "")
          .trim()
          .slice(0, 12000);
      } catch (error) {
        console.warn("[chat-attachment-inline-text-failed]", {
          requestId,
          sessionId,
          fileName: file.name,
          error: serializeErrorForClient(error),
        });
      }
    }

    if (file) {
      const uploadStartedAt = performance.now();
      try {
        const supabaseAdmin = getSupabaseAdmin();
        if (!fileBuffer) {
          const bytes = await file.arrayBuffer();
          fileBuffer = Buffer.from(bytes);
        }
        const timestamp = Date.now();
        const filename = `${timestamp}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

        const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

        // Ensure bucket exists (Self-healing)
        const { data: buckets } = await supabaseAdmin.storage.listBuckets();
        if (!buckets?.find(b => b.name === bucket)) {
          await supabaseAdmin.storage.createBucket(bucket, { public: true });
        }

        const { error: uploadError } = await supabaseAdmin
          .storage
          .from(bucket)
          .upload(filename, fileBuffer, { contentType: file.type });

        if (!uploadError) {
          const { data: { publicUrl } } = supabaseAdmin
            .storage
            .from(bucket)
            .getPublicUrl(filename);
          fileUrl = publicUrl;
        }
      } catch (e) {
        console.error("Chat File Upload Error:", e);
      }
      mark("upload", uploadStartedAt);
    }

    if (type === "voice" && file && isGroqTranscriptionConfigured()) {
      const voiceTranscriptionStartedAt = performance.now();
      try {
        if (!fileBuffer) {
          const bytes = await file.arrayBuffer();
          fileBuffer = Buffer.from(bytes);
        }

        voiceTranscript = await transcribeVoiceWithGroq({
          buffer: fileBuffer,
          fileName: file.name || "recording.webm",
          mimeType: file.type || "audio/webm",
        });
      } catch (error) {
        console.warn("[chat-voice-transcription-failed]", {
          requestId,
          sessionId,
          error: serializeErrorForClient(error),
        });
      }
      mark("voice_transcription", voiceTranscriptionStartedAt);
    }

    userContent = chatInput || "";
    if (type === "voice") {
      userContent = [chatInput, voiceTranscript ? `Transcript: ${voiceTranscript}` : ""]
        .filter(Boolean)
        .join("\n")
        .trim() || "[Voice Message]";
    }
    if (type === "image") userContent = userContent || "[Image Upload]";

    if (persistenceAvailable) {
      const saveUserMessageStartedAt = performance.now();
      try {
        await prisma.chat_messages.create({
          data: {
            session_id: sessionId,
            role: "user",
            content: userContent,
            file_url: fileUrl,
            file_type: type, // 'image' or 'voice'
            timestamp: new Date(),
            retrieved_context: {
              source: "chat_n8n",
              clientMessageId,
              requestId,
              type: requestType,
              hasAttachment,
            },
          }
        });
      } catch (error) {
        if (!isTenantDatabaseBoundaryError(error)) {
          throw error;
        }
        persistenceAvailable = false;
      }
      mark("persist_user_message", saveUserMessageStartedAt);
    }

    const persistAssistantResponse = async (
      resolution: LocalChatResolution,
      extraContext: Record<string, unknown> = {},
    ) => {
      if (!persistenceAvailable) {
        return;
      }

      const saveAssistantMessageStartedAt = performance.now();
      try {
        await prisma.chat_messages.create({
          data: {
            session_id: sessionId!,
            role: "assistant",
            content: resolution.output,
            timestamp: new Date(),
            retrieved_context: {
              source: "chat_n8n",
              clientMessageId,
              requestId,
              type: requestType,
              hasAttachment,
              routeHint: resolution.routeHint,
              stage: "completed",
              durationMs: performance.now() - startedAt,
              citations: resolution.citations ?? [],
              ...(voiceTranscript ? { voiceTranscript } : {}),
              ...extraContext,
            },
          }
        });
      } catch (error) {
        if (!isTenantDatabaseBoundaryError(error)) {
          throw error;
        }
        persistenceAvailable = false;
      }
      mark("persist_assistant_message", saveAssistantMessageStartedAt);
    };

    const persistAndReturnResolution = async (
      resolution: LocalChatResolution,
      extraContext: RequestResolutionMeta = {},
    ) => {
      const totalDurationMs = performance.now() - startedAt;
      await persistAssistantResponse(resolution, extraContext);

      console.info("[chat-request-metric]", JSON.stringify({
        requestId,
        sessionId,
        type: requestType,
        hasAttachment,
        routeHint: resolution.routeHint,
        persistenceAvailable,
        durationMs: totalDurationMs,
        stagePlan,
        outcome: "ok",
        ...extraContext,
      }));

      return jsonWithTelemetry(
        {
          output: resolution.output,
          citations: resolution.citations ?? [],
        },
        200,
        resolution.routeHint,
        extraContext,
      );
    };

    if (
      requestType === "chat" &&
      !hasAttachment &&
      geminiWebSearchEnabled &&
      pendingWebSearchPrompt &&
      isGeminiWebSearchConsent(userContent)
    ) {
      const geminiStartedAt = performance.now();
      try {
        const webResult = await runGeminiWebSearch(pendingWebSearchPrompt);
        mark("gemini_web_search", geminiStartedAt);

        return await persistAndReturnResolution(
          {
            output: webResult.output,
            routeHint: "gemini_web_search",
            citations: webResult.citations,
          },
          {
            webSearchUsed: true,
            webSearchProvider: "gemini_google_search",
            webSearchQueries: webResult.groundingQueries,
            webSearchModel: webResult.model,
          },
        );
      } catch (error) {
        mark("gemini_web_search", geminiStartedAt);

        return await persistAndReturnResolution(
          {
            output:
              "Tôi đã thử bật luồng Gemini Web Search nhưng lần này không lấy được kết quả ổn định. Bạn có thể thử lại với câu hỏi cụ thể hơn hoặc gửi nguồn muốn tôi đọc trực tiếp.",
            routeHint: "gemini_web_search_failed",
          },
          {
            webSearchUsed: true,
            webSearchProvider: "gemini_google_search",
            webSearchPendingPrompt: pendingWebSearchPrompt,
            degradedReason: serializeErrorForClient(error),
          },
        );
      }
    }

    const businessBoundaryShortcut = buildBusinessDataBoundaryResolution(userContent);
    if (businessBoundaryShortcut) {
      return await persistAndReturnResolution(businessBoundaryShortcut);
    }

    if (
      requestType === "chat" &&
      !hasAttachment &&
      isExternalFreshInfoQuery(userContent)
    ) {
      if (geminiWebSearchEnabled) {
        return await persistAndReturnResolution(
          buildGeminiWebOfferResolution(),
          {
            webSearchPendingPrompt: userContent,
            webSearchProvider: "gemini_google_search",
          },
        );
      }

      return await persistAndReturnResolution(buildExternalLimitResolution());
    }

    if (file && fileBuffer && isCalculationPrompt(userContent)) {
      const spreadsheetStartedAt = performance.now();
      try {
        const spreadsheetResolution = resolveSpreadsheetCalculation({
          prompt: userContent,
          fileName: file.name,
          buffer: fileBuffer,
        });
        mark("spreadsheet_calculation", spreadsheetStartedAt);

        if (spreadsheetResolution) {
          return await persistAndReturnResolution(
            {
              output: spreadsheetResolution.output,
              routeHint: spreadsheetResolution.routeHint,
              citations: spreadsheetResolution.citations,
            },
            {
              ...spreadsheetResolution.meta,
              spreadsheetCalculationUsed: true,
            },
          );
        }
      } catch (error) {
        mark("spreadsheet_calculation", spreadsheetStartedAt);
        console.warn("[chat-spreadsheet-calculation-failed]", {
          requestId,
          sessionId,
          fileName: file.name,
          error: serializeErrorForClient(error),
        });
      }
    }

    const localShortcut = resolveLocalShortcut({
      chatInput: userContent,
      inlinedAttachmentText,
    });

    if (localShortcut) {
      return await persistAndReturnResolution(localShortcut);
    }

    // 5. Forward to n8n
    const n8nUrl = process.env.N8N_MAIN_RAG_WEBHOOK_URL;

    if (!n8nUrl) {
      // Development Fallback
      if (process.env.NODE_ENV === 'development') {
        const durationMs = performance.now() - startedAt;
        const fakeResponse = {
          text: `[DEV MODE] Received: ${userContent}. (Configure N8N_HOST in .env to use real AI)`
        };

        if (persistenceAvailable) {
          try {
            await prisma.chat_messages.create({
              data: {
                session_id: sessionId,
                role: "assistant",
                content: fakeResponse.text,
                timestamp: new Date(),
                retrieved_context: {
                  source: "chat_n8n",
                  clientMessageId,
                  requestId,
                  type: requestType,
                  hasAttachment,
                  routeHint: "dev_fallback",
                  stage: "completed",
                  durationMs,
                  citations: [],
                },
              }
            });
          } catch (error) {
            if (!isTenantDatabaseBoundaryError(error)) {
              throw error;
            }
            persistenceAvailable = false;
          }
        }
        return NextResponse.json(fakeResponse);
      }

      throw new Error("N8N Webhook URL not configured");
    }

    const semanticChatInput =
      type === "voice" && voiceTranscript
        ? [chatInput, `[VOICE_TRANSCRIPT_BEGIN]\n${voiceTranscript}\n[VOICE_TRANSCRIPT_END]`]
            .filter(Boolean)
            .join("\n\n")
        : chatInput;

    if (requestType === "chat" && !hasAttachment && isInventorySummaryPrompt(userContent)) {
      const inventoryStartedAt = performance.now();
      try {
        const inventoryResolution = await resolveInventoryDbCalculation(userContent);
        mark("inventory_db", inventoryStartedAt);
        if (inventoryResolution) {
          return await persistAndReturnResolution(inventoryResolution, {
            spreadsheetCalculationUsed: true,
            webSearchUsed: false,
            webSearchProvider: "app_inventory_db",
          });
        }
      } catch (error) {
        mark("inventory_db", inventoryStartedAt);
        console.warn("[chat-inventory-db-calculation-failed]", {
          requestId,
          sessionId,
          error: serializeErrorForClient(error),
        });
      }
    }

    let calculationDriveContext = "";
    let calculationDriveSearched = false;
    let calculationDriveCandidates: CalculationDriveCandidate[] = [];
    if (requestType === "chat" && !hasAttachment && isSpreadsheetCalculationDataPathPrompt(userContent)) {
      const fileResolveStartedAt = performance.now();
      try {
        calculationDriveSearched = true;
        const candidates = await resolveCalculationDriveCandidates(userContent);
        calculationDriveCandidates = candidates;
        const driveSpreadsheetResolution = await resolveDriveSpreadsheetCalculation({
          prompt: userContent,
          candidates,
        });
        if (driveSpreadsheetResolution?.routeHint === "spreadsheet_calculation") {
          return await persistAndReturnResolution(
            driveSpreadsheetResolution,
            {
              spreadsheetCalculationUsed: true,
              webSearchUsed: false,
              webSearchProvider: "drive_spreadsheet_parser",
            },
          );
        }
        const priceFilterResolution = await resolveDriveUnitPriceThresholdCalculation({
          prompt: userContent,
          candidates,
        });
        if (priceFilterResolution) {
          return await persistAndReturnResolution(
            priceFilterResolution,
            {
              spreadsheetCalculationUsed: true,
              webSearchUsed: false,
              webSearchProvider: "drive_spreadsheet_parser",
            },
          );
        }
        calculationDriveContext = [
          buildCalculationDriveContext(candidates),
          await buildCalculationRawDriveContext(candidates),
        ].filter(Boolean).join("\n\n");
      } catch (error) {
        if (!isTenantDatabaseBoundaryError(error)) {
          console.warn("[chat-calculation-drive-context-failed]", {
            requestId,
            sessionId,
            error: serializeErrorForClient(error),
          });
        }
      }
      mark("calculation_drive_context", fileResolveStartedAt);
    }

    let calculationFileSearchStoreNames: string[] = [];
    if (requestType === "chat" && !hasAttachment && isSpreadsheetCalculationDataPathPrompt(userContent)) {
      const fileSearchStoreStartedAt = performance.now();
      try {
        calculationFileSearchStoreNames = await buildCalculationFileSearchStoreNames(calculationDriveCandidates);
      } catch (error) {
        console.warn("[chat-calculation-file-search-store-failed]", {
          requestId,
          sessionId,
          error: serializeErrorForClient(error),
        });
      }
      mark("calculation_file_search_store", fileSearchStoreStartedAt);
    }

    const effectiveChatInput =
      [
        semanticChatInput || (inlinedAttachmentText.length > 0 ? "Đây là nội dung file đính kèm cần xử lý." : ""),
        calculationDriveContext,
        inlinedAttachmentText.length > 0
          ? `[ATTACHED_FILE_TEXT_BEGIN]\n${inlinedAttachmentText}\n[ATTACHED_FILE_TEXT_END]`
          : "",
      ].filter(Boolean).join("\n\n");

    if (
      requestType === "chat" &&
      !hasAttachment &&
      calculationDriveContext.includes("[RAW_DRIVE_SPREADSHEET_CONTEXT_BEGIN]") &&
      geminiWebSearchEnabled
    ) {
      const geminiSpreadsheetStartedAt = performance.now();
      try {
        const calculationResult = await runGeminiSpreadsheetCalculation(effectiveChatInput);
        mark("gemini_spreadsheet_calculation", geminiSpreadsheetStartedAt);

        return await persistAndReturnResolution(
          {
            output: calculationResult.output,
            routeHint: "gemini_spreadsheet_calculation",
            citations: calculationResult.citations,
          },
          {
            spreadsheetCalculationUsed: true,
            webSearchUsed: false,
            webSearchProvider: "gemini_internal_spreadsheet",
            webSearchModel: calculationResult.model,
          },
        );
      } catch (error) {
        mark("gemini_spreadsheet_calculation", geminiSpreadsheetStartedAt);
        console.warn("[chat-gemini-spreadsheet-calculation-failed]", {
          requestId,
          sessionId,
          error: serializeErrorForClient(error),
        });
      }
    }

    if (
      requestType === "chat" &&
      !hasAttachment &&
      calculationFileSearchStoreNames.length > 0 &&
      geminiWebSearchEnabled
    ) {
      const geminiFileSearchStartedAt = performance.now();
      try {
        const calculationResult = await runGeminiFileSearchCalculation({
          prompt: effectiveChatInput,
          fileSearchStoreNames: calculationFileSearchStoreNames,
        });
        mark("gemini_file_search_calculation", geminiFileSearchStartedAt);

        return await persistAndReturnResolution(
          {
            output: calculationResult.output,
            routeHint: "gemini_file_search_calculation",
            citations: calculationResult.citations,
          },
          {
            spreadsheetCalculationUsed: true,
            webSearchUsed: false,
            webSearchProvider: "gemini_file_search",
            webSearchModel: calculationResult.model,
          },
        );
      } catch (error) {
        mark("gemini_file_search_calculation", geminiFileSearchStartedAt);
        console.warn("[chat-gemini-file-search-calculation-failed]", {
          requestId,
          sessionId,
          error: serializeErrorForClient(error),
        });
      }
    }

    const outgoingFormData = new FormData();
    outgoingFormData.append("sessionId", sessionId);
    outgoingFormData.append("type", type);
    outgoingFormData.append("clientMessageId", clientMessageId);
    if (effectiveChatInput) outgoingFormData.append("chatInput", effectiveChatInput);
    if (previousAgent0ContextId) {
      outgoingFormData.append("agent0_context_id", previousAgent0ContextId);
    }
    if (file) outgoingFormData.append("file", file);
    if (fileUrl) outgoingFormData.append("fileUrl", fileUrl); // Provide URL to n8n as well

    const n8nStartedAt = performance.now();
    const n8nAbortController = new AbortController();
    const n8nTimeoutId = setTimeout(() => {
      n8nAbortController.abort();
    }, N8N_TIMEOUT_MS);
    let n8nResponse: Response;

    try {
      n8nResponse = await fetch(n8nUrl, {
        method: "POST",
        body: outgoingFormData,
        headers: {
          "x-chat-request-id": requestId,
        },
        signal: n8nAbortController.signal,
      });
    } catch (error) {
      mark("n8n", n8nStartedAt);

      const degradedResolution = resolveLocalFailureFallback({
        chatInput: userContent,
        inlinedAttachmentText,
        searchedDrive: calculationDriveSearched,
        calculationDriveCandidates,
      });
      const totalDurationMs = performance.now() - startedAt;
      const fallbackReason =
        error instanceof Error && error.name === "AbortError"
          ? "n8n_timeout"
          : "n8n_fetch_error";
      await persistAssistantResponse(degradedResolution, {
        degradedFrom: fallbackReason,
        degradedReason: serializeErrorForClient(error),
      });

      console.warn("[chat-request-degraded]", {
        requestId,
        sessionId,
        routeHint: degradedResolution.routeHint,
        fallbackReason,
        durationMs: totalDurationMs,
      });

      return jsonWithTelemetry(
        {
          output: degradedResolution.output,
          citations: degradedResolution.citations ?? [],
        },
        200,
        degradedResolution.routeHint,
        { degradedFrom: fallbackReason }
      );
    } finally {
      clearTimeout(n8nTimeoutId);
    }

    mark("n8n", n8nStartedAt);

    if (!n8nResponse.ok) {
      const errText = await n8nResponse.text();
      const degradedResolution = resolveLocalFailureFallback({
        chatInput: userContent,
        inlinedAttachmentText,
        searchedDrive: calculationDriveSearched,
        calculationDriveCandidates,
      });
      const totalDurationMs = performance.now() - startedAt;
      await persistAssistantResponse(degradedResolution, {
        degradedFrom: "n8n_non_ok",
        degradedReason: `n8n responded with ${n8nResponse.status}: ${errText}`,
      });

      console.warn("[chat-request-degraded]", {
        requestId,
        sessionId,
        routeHint: degradedResolution.routeHint,
        fallbackReason: "n8n_non_ok",
        upstreamStatus: n8nResponse.status,
        durationMs: totalDurationMs,
      });

      return jsonWithTelemetry(
        {
          output: degradedResolution.output,
          citations: degradedResolution.citations ?? [],
        },
        200,
        degradedResolution.routeHint,
        {
          degradedFrom: "n8n_non_ok",
          upstreamStatus: n8nResponse.status,
        }
      );
    }

    const text = await n8nResponse.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { text: text };
    }

    // 6. Save AI Response
    const normalizedData =
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown>)
        : { text };
    const aiContent =
      typeof normalizedData.output === "string"
        ? normalizedData.output
        : typeof normalizedData.text === "string"
          ? normalizedData.text
          : typeof normalizedData.message === "string"
            ? normalizedData.message
            : JSON.stringify(normalizedData);
    const citations = normalizedData.citations;
    const routeHint = inferRouteHint(normalizedData, {
      type: requestType,
      hasAttachment,
    });
    const agent0ContextId = readAgent0ContextId(normalizedData);
    const totalDurationMs = performance.now() - startedAt;

    if (
      requestType === "chat" &&
      !hasAttachment &&
      geminiWebSearchEnabled &&
      shouldOfferGeminiAfterNoResult(userContent, aiContent)
    ) {
      return await persistAndReturnResolution(
        buildGeminiWebOfferResolution(),
        {
          webSearchPendingPrompt: userContent,
          webSearchProvider: "gemini_google_search",
        },
      );
    }

    if (
      requestType === "chat" &&
      !hasAttachment &&
      isCalculationPrompt(userContent) &&
      hasNoResultSignal(aiContent)
    ) {
      return await persistAndReturnResolution(buildCalculationNeedsDataResolution({
        searchedDrive: calculationDriveSearched,
        candidates: calculationDriveCandidates,
      }), {
        degradedFrom: "calculation_no_structured_source",
      });
    }

    if (persistenceAvailable) {
      const saveAssistantMessageStartedAt = performance.now();
      try {
        await prisma.chat_messages.create({
          data: {
            session_id: sessionId,
            role: "assistant",
            content: aiContent,
            timestamp: new Date(),
            retrieved_context: {
              source: "chat_n8n",
              clientMessageId,
              requestId,
              type: requestType,
              hasAttachment,
              routeHint,
              stage: "completed",
              durationMs: totalDurationMs,
              citations: Array.isArray(citations) ? citations : [],
              ...(agent0ContextId ? { agent0ContextId } : {}),
            },
          }
        });
      } catch (error) {
        if (!isTenantDatabaseBoundaryError(error)) {
          throw error;
        }
        persistenceAvailable = false;
      }
      mark("persist_assistant_message", saveAssistantMessageStartedAt);
    }

    console.info("[chat-request-metric]", JSON.stringify({
      requestId,
      sessionId,
      type: requestType,
      hasAttachment,
      routeHint,
      persistenceAvailable,
      durationMs: totalDurationMs,
      stagePlan,
      outcome: "ok",
    }));

    return jsonWithTelemetry(normalizedData, 200, routeHint, {
      ...(agent0ContextId ? { agent0ContextId } : {}),
    });

  } catch (error: unknown) {
    const routeHint = "failed";
    console.error("[Chat API Error]", {
      requestId,
      sessionId,
      message: serializeErrorForClient(error),
      durationMs: performance.now() - startedAt,
    });
    return jsonWithTelemetry(
      {
        error: "Internal Server Error",
        details: serializeErrorForClient(error),
        requestId,
        stage: "failed",
      },
      500,
      routeHint
    );
  }
}
