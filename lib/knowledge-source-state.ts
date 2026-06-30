export type KnowledgeSourceStatus =
  | "drive_only"
  | "metadata_only"
  | "index_pending"
  | "rag_ready"
  | "calculation_unverified"
  | "calculation_ready"
  | "raw_unreadable"
  | "ingestion_failed"
  | "unknown";

export type KnowledgeSourceState = {
  driveVisible: boolean;
  metadataSaved: boolean;
  vectorIndexed: boolean;
  rawReadable: boolean;
  rawReadChecked: boolean;
  n8nIngested: boolean | null;
  usableForCalculation: boolean;
  usableForRag: boolean;
  status: KnowledgeSourceStatus;
  statusMessage: string;
};

export type KnowledgeSourceStateInput = {
  driveVisible?: boolean;
  metadataSaved?: boolean;
  hasVectorIndex?: boolean;
  hasFileSearchStore?: boolean;
  hasKnowledgeChunks?: boolean;
  rawReadable?: boolean | null;
  rawReadChecked?: boolean;
  n8nIngested?: boolean | null;
  ingestionError?: string | null;
  spreadsheetCompatible?: boolean;
  webSource?: boolean;
};

export function buildKnowledgeSourceState(
  input: KnowledgeSourceStateInput,
): KnowledgeSourceState {
  const driveVisible = input.driveVisible === true;
  const metadataSaved = input.metadataSaved === true;
  const vectorIndexed =
    input.hasVectorIndex === true ||
    input.hasFileSearchStore === true ||
    input.hasKnowledgeChunks === true;
  const rawReadable = input.rawReadable === true;
  const rawReadChecked = input.rawReadChecked === true;
  const n8nIngested =
    input.n8nIngested === undefined ? (vectorIndexed ? true : null) : input.n8nIngested;
  const spreadsheetCompatible = input.spreadsheetCompatible === true;
  const webSource = input.webSource === true;
  const usableForRag = metadataSaved && vectorIndexed && n8nIngested !== false;
  const usableForCalculation =
    metadataSaved &&
    rawReadable &&
    spreadsheetCompatible &&
    n8nIngested !== false;

  if (n8nIngested === false) {
    return {
      driveVisible,
      metadataSaved,
      vectorIndexed,
      rawReadable,
      rawReadChecked,
      n8nIngested,
      usableForCalculation: false,
      usableForRag: false,
      status: "ingestion_failed",
      statusMessage: input.ingestionError
        ? `Upload thanh cong, nhung ingestion loi: ${input.ingestionError}. Chat co the chua tra cuu duoc file nay.`
        : "Upload thanh cong, nhung ingestion loi. Chat co the chua tra cuu duoc file nay.",
    };
  }

  if (driveVisible && !metadataSaved) {
    return {
      driveVisible,
      metadataSaved,
      vectorIndexed: false,
      rawReadable,
      rawReadChecked,
      n8nIngested,
      usableForCalculation: false,
      usableForRag: false,
      status: "drive_only",
      statusMessage: "Co tren Drive - chua index.",
    };
  }

  if (metadataSaved && !driveVisible && !vectorIndexed) {
    return {
      driveVisible,
      metadataSaved,
      vectorIndexed,
      rawReadable,
      rawReadChecked,
      n8nIngested,
      usableForCalculation: false,
      usableForRag: false,
      status: "metadata_only",
      statusMessage: "Chi co metadata, chua xac minh Drive/index.",
    };
  }

  if (metadataSaved && !vectorIndexed) {
    return {
      driveVisible,
      metadataSaved,
      vectorIndexed,
      rawReadable,
      rawReadChecked,
      n8nIngested,
      usableForCalculation: false,
      usableForRag: false,
      status: "index_pending",
      statusMessage: "Da luu metadata, dang cho ingestion/index.",
    };
  }

  if (metadataSaved && vectorIndexed && spreadsheetCompatible && rawReadChecked && !rawReadable) {
    return {
      driveVisible,
      metadataSaved,
      vectorIndexed,
      rawReadable,
      rawReadChecked,
      n8nIngested,
      usableForCalculation: false,
      usableForRag,
      status: "raw_unreadable",
      statusMessage: "Da index cho tra cuu, nhung khong doc raw duoc de tinh toan.",
    };
  }

  if (usableForCalculation) {
    return {
      driveVisible,
      metadataSaved,
      vectorIndexed,
      rawReadable,
      rawReadChecked,
      n8nIngested,
      usableForCalculation,
      usableForRag,
      status: "calculation_ready",
      statusMessage: "San sang tinh toan.",
    };
  }

  if (usableForRag && spreadsheetCompatible && !webSource) {
    return {
      driveVisible,
      metadataSaved,
      vectorIndexed,
      rawReadable,
      rawReadChecked,
      n8nIngested,
      usableForCalculation: false,
      usableForRag,
      status: "calculation_unverified",
      statusMessage: "Da index cho chat, chua xac minh doc file de tinh.",
    };
  }

  if (usableForRag) {
    return {
      driveVisible,
      metadataSaved,
      vectorIndexed,
      rawReadable,
      rawReadChecked,
      n8nIngested,
      usableForCalculation: false,
      usableForRag,
      status: "rag_ready",
      statusMessage: "Da index cho chat.",
    };
  }

  return {
    driveVisible,
    metadataSaved,
    vectorIndexed,
    rawReadable,
    rawReadChecked,
    n8nIngested,
    usableForCalculation,
    usableForRag,
    status: "unknown",
    statusMessage: "Chua xac dinh duoc trang thai nguon tri thuc.",
  };
}

export function isSpreadsheetCompatibleSource(sheetName?: string | null) {
  const value = (sheetName || "").trim().toUpperCase();
  return ["CSV", "XLS", "XLSX", "GOOGLE_SHEET"].includes(value);
}
