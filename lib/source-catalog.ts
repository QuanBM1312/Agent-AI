import {
  normalizeBusinessText,
} from "./entity-normalizer.ts";
import {
  buildKnowledgeSourceState,
  isSpreadsheetCompatibleSource,
} from "./knowledge-source-state.ts";
import type {
  KnowledgeSourceState,
  KnowledgeSourceStatus,
} from "./knowledge-source-state.ts";

export type SourceDomain =
  | "price"
  | "inventory"
  | "finance"
  | "project"
  | "contract"
  | "report"
  | "customer"
  | "unknown";

export type SourceCatalogOrigin =
  | "drive_index"
  | "drive_fallback"
  | "file_search_storage"
  | "manual_upload"
  | "app_db";

export type SourceCatalogItem = {
  sourceId: string;
  source: SourceCatalogOrigin;
  driveFileId?: string;
  driveName: string;
  mimeType?: string;
  fileSearchName?: string;
  sourceState: KnowledgeSourceState;
  likelyDomains: SourceDomain[];
  vectorIndexed: boolean;
  rawReadable: boolean;
  rawReadChecked: boolean;
  pathHint?: string;
  folderHint?: string;
  updatedAt?: string;
};

export type SourceCatalogRecord = {
  driveFileId?: string | null;
  driveName?: string | null;
  fileSearchName?: string | null;
  mimeType?: string | null;
  source?: SourceCatalogOrigin;
  hasFileSearchStore?: boolean;
  hasKnowledgeChunks?: boolean;
  rawReadable?: boolean | null;
  rawReadChecked?: boolean;
  n8nIngested?: boolean | null;
  ingestionError?: string | null;
  pathHint?: string | null;
  folderHint?: string | null;
  updatedAt?: string | Date | null;
};

export function uniqueCatalogStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(
    values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  ));
}

export function sourceCatalogText(value: string) {
  return normalizeBusinessText(value)
    .replace(/[_/\\.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isProbeOrTestSourceName(name: string) {
  const normalized = sourceCatalogText(name);
  return (
    /^upload probe\b/.test(normalized) ||
    /\b(upload probe|test file|probe file|playwright|fixture|dummy|sample|smoke test)\b/.test(normalized)
  );
}

export function promptExplicitlyNamesSource(prompt: string, sourceName: string) {
  const normalizedPrompt = sourceCatalogText(prompt);
  const normalizedName = sourceCatalogText(sourceName);
  if (!normalizedPrompt || !normalizedName) {
    return false;
  }

  const tokens = normalizedName
    .split(" ")
    .filter((token) => token.length >= 4 && !["xlsx", "xls", "csv", "pdf", "docx"].includes(token))
    .slice(0, 5);
  return tokens.length > 0 && tokens.every((token) => normalizedPrompt.includes(token));
}

export function classifySourceDomains(input: {
  name?: string | null;
  fileSearchName?: string | null;
  mimeType?: string | null;
  folderHint?: string | null;
  pathHint?: string | null;
}): SourceDomain[] {
  const text = sourceCatalogText([
    input.name,
    input.fileSearchName,
    input.folderHint,
    input.pathHint,
  ].filter(Boolean).join(" "));
  const domains = new Set<SourceDomain>();

  if (/\b(bang gia|bao gia|phieu tinh gia|don gia|niem yet|quote|quotation|price|pricing)\b/.test(text)) {
    domains.add("price");
  }

  if (/\b(gia dich vu|dich vu|vat tu|materials? and services?|service price)\b/.test(text)) {
    domains.add("price");
  }

  if (/\b(kho|ton kho|nhap xuat ton|ton hang|hang hoa|mat hang|inventory|stock)\b/.test(text)) {
    domains.add("inventory");
  }

  if (/\b(tai chinh|doanh thu|chi phi|gia von|loi nhuan|lai lo|saleadmins?|sale admins?|cong no|thu chi|finance|revenue|cost|profit)\b/.test(text)) {
    domains.add("finance");
  }

  if (/\b(du an|cong trinh|tien do|deadline|hang muc|thi cong|giao viec|project|progress)\b/.test(text)) {
    domains.add("project");
  }

  if (/\b(hop dong|quyet toan|nghiem thu|thanh toan|contract|settlement|payment)\b/.test(text)) {
    domains.add("contract");
  }

  if (/\b(bao cao|tong hop|report|dashboard|summary|weekly|monthly|hang tuan|hang thang)\b/.test(text)) {
    domains.add("report");
  }

  if (/\b(khach hang|customer|client|crm)\b/.test(text)) {
    domains.add("customer");
  }

  return domains.size > 0 ? Array.from(domains) : ["unknown"];
}

export function classifyPriceSourceKind(input: {
  name?: string | null;
  fileSearchName?: string | null;
  pathHint?: string | null;
}) {
  const text = sourceCatalogText([input.name, input.fileSearchName, input.pathHint].filter(Boolean).join(" "));
  if (/\b(gia dich vu|dich vu|vat tu|service|materials? and services?)\b/.test(text)) {
    return "service_price" as const;
  }
  if (/\b(bang gia|bao gia|phieu tinh gia|niem yet|don gia|quote|quotation|product price|pricing)\b/.test(text)) {
    return "product_price" as const;
  }
  return "price_unknown" as const;
}

function isSpreadsheetMimeOrName(mimeType?: string | null, name?: string | null) {
  const value = (mimeType || "").trim();
  if (value === "application/vnd.google-apps.spreadsheet") {
    return true;
  }
  if (value === "text/csv") {
    return true;
  }
  return /\.(xlsx|xls|csv)$/i.test(name || "");
}

function sourceStatusFromRecord(record: SourceCatalogRecord, source: SourceCatalogOrigin, name: string) {
  const hasFileSearchStore =
    record.hasFileSearchStore === true ||
    Boolean(record.fileSearchName?.startsWith("fileSearchStores/")) ||
    Boolean(record.fileSearchName?.includes("/documents/"));
  const spreadsheetCompatible = isSpreadsheetCompatibleSource(record.mimeType) ||
    isSpreadsheetMimeOrName(record.mimeType, name);

  return buildKnowledgeSourceState({
    driveVisible: Boolean(record.driveFileId) || source === "drive_fallback",
    metadataSaved: source !== "drive_fallback",
    hasFileSearchStore,
    hasKnowledgeChunks: record.hasKnowledgeChunks === true,
    rawReadable: record.rawReadable,
    rawReadChecked: record.rawReadChecked,
    n8nIngested: record.n8nIngested,
    ingestionError: record.ingestionError,
    spreadsheetCompatible,
  });
}

export function buildSourceCatalogFromRecords(
  records: SourceCatalogRecord[],
  options: {
    prompt?: string;
    limit?: number;
    includeAppDbSources?: boolean;
  } = {},
): SourceCatalogItem[] {
  const prompt = options.prompt || "";
  const seen = new Set<string>();
  const catalog: SourceCatalogItem[] = [];

  for (const record of records) {
    const source = record.source ?? "file_search_storage";
    const driveName = (record.driveName || record.pathHint || record.fileSearchName || record.driveFileId || "").trim();
    if (!driveName) {
      continue;
    }

    if (isProbeOrTestSourceName(driveName) && !promptExplicitlyNamesSource(prompt, driveName)) {
      continue;
    }

    const sourceId = record.driveFileId?.trim() || record.fileSearchName?.trim() || driveName;
    if (seen.has(sourceId)) {
      continue;
    }
    seen.add(sourceId);

    const sourceState = sourceStatusFromRecord(record, source, driveName);
    catalog.push({
      sourceId,
      source,
      ...(record.driveFileId?.trim() ? { driveFileId: record.driveFileId.trim() } : {}),
      driveName,
      ...(record.mimeType?.trim() ? { mimeType: record.mimeType.trim() } : {}),
      ...(record.fileSearchName?.trim() ? { fileSearchName: record.fileSearchName.trim() } : {}),
      sourceState,
      likelyDomains: classifySourceDomains({
        name: driveName,
        fileSearchName: record.fileSearchName,
        mimeType: record.mimeType,
        folderHint: record.folderHint,
        pathHint: record.pathHint,
      }),
      vectorIndexed: sourceState.vectorIndexed,
      rawReadable: sourceState.rawReadable,
      rawReadChecked: sourceState.rawReadChecked,
      ...(record.pathHint?.trim() ? { pathHint: record.pathHint.trim() } : {}),
      ...(record.folderHint?.trim() ? { folderHint: record.folderHint.trim() } : {}),
      ...(record.updatedAt ? { updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : String(record.updatedAt) } : {}),
    });
  }

  if (options.includeAppDbSources) {
    catalog.push(...buildKnownAppDbCatalogItems());
  }

  return catalog.slice(0, options.limit ?? 80);
}

export function buildKnownAppDbCatalogItems(): SourceCatalogItem[] {
  const ready = buildKnowledgeSourceState({
    driveVisible: false,
    metadataSaved: true,
    hasKnowledgeChunks: true,
    rawReadable: true,
    rawReadChecked: true,
    spreadsheetCompatible: false,
  });

  return [
    {
      sourceId: "app_db:inventory",
      source: "app_db",
      driveName: "App inventory database",
      sourceState: ready,
      likelyDomains: ["inventory"],
      vectorIndexed: false,
      rawReadable: true,
      rawReadChecked: true,
    },
  ];
}

export function sourceStateRank(status: KnowledgeSourceStatus) {
  switch (status) {
    case "calculation_ready":
      return 5;
    case "rag_ready":
    case "calculation_unverified":
      return 4;
    case "index_pending":
    case "drive_only":
      return 2;
    case "metadata_only":
      return 1;
    case "raw_unreadable":
    case "ingestion_failed":
      return -2;
    default:
      return 0;
  }
}
