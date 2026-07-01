import {
  extractEntities,
  normalizeBusinessText,
} from "./entity-normalizer.ts";
import type { EntityMention } from "./entity-normalizer.ts";
import { removeInternalLookupInstructionPhrases } from "./internal-query-terms.ts";

export type QueryIntent =
  | "inventory_lookup"
  | "inventory_analysis"
  | "internal_price_lookup"
  | "spreadsheet_calculation"
  | "profit_loss"
  | "contract_status"
  | "project_progress"
  | "risk_summary"
  | "external_web"
  | "general";

export type ToolName =
  | "inventory_db"
  | "drive_file_search"
  | "raw_spreadsheet"
  | "gemini_file_search"
  | "gemini_web_search"
  | "n8n"
  | "general_model";

export type FallbackPolicy =
  | "web_search"
  | "general_answer"
  | "unverified_internal_data"
  | "drive_visible_as_indexed";

export type SourceRequirement =
  | "inventory_current_stock"
  | "inventory_movement"
  | "warehouse_dimension"
  | "internal_price_file"
  | "revenue"
  | "cost"
  | "contract_status"
  | "project_progress"
  | "raw_spreadsheet"
  | "external_web";

export type AnswerContract =
  | "separate_verified_missing_inferred"
  | "cite_internal_sources"
  | "do_not_use_web_prices"
  | "do_not_conclude_profit_without_cost"
  | "state_missing_warehouse_dimension"
  | "state_formula"
  | "ground_web_sources";

export type QueryPlan = {
  intent: QueryIntent;
  entities: EntityMention[];
  sourceRequirements: SourceRequirement[];
  allowedTools: ToolName[];
  blockedFallbacks: FallbackPolicy[];
  answerContract: AnswerContract[];
  requiresMultipleSources: boolean;
  confidence: "low" | "medium" | "high";
  retrievalTerms: string[];
};

export type QueryPlannerContext = {
  explicitWebAllowed?: boolean;
};

export type QueryRoutingPolicy = {
  useLocalInventoryLookup: boolean;
  needsInternalFileAnalysis: boolean;
  blockInternalPriceWebFallback: boolean;
  useInventoryBusinessFallback: boolean;
  useAgent0DeepLane: boolean;
};

type N8nCandidateFileInput = Record<string, unknown>;

export type N8nSourcePlanPayloadInput = {
  queryPlan: QueryPlan | null;
  routingPolicy: QueryRoutingPolicy;
  businessAnalysisPlan?: {
    intent: string;
    requiresMultipleSources: boolean;
    retrievalTerms: string[];
    requiredSources: string[];
    answerContract: string[];
  } | null;
  candidateFiles?: N8nCandidateFileInput[];
  calculationFileSearchStoreNames?: string[];
  needsInternalFileAnalysis: boolean;
  calculationDriveSearched: boolean;
  geminiWebSearchEnabled: boolean;
  hasAttachment?: boolean;
  onSerializationError?: (field: string, error: unknown) => void;
};

export type N8nSourcePlanPayload = {
  sourcePlan: string;
  candidateFiles: string;
  answerContract: string;
};

export type N8nSourcePlan = {
  intent: string;
  entities: EntityMention[];
  sourceRequirements: string[];
  allowedTools: string[];
  blockedFallbacks: string[];
  requiresMultipleSources: boolean;
  retrievalTerms: string[];
  routingPolicy: QueryRoutingPolicy;
  needsInternalFileAnalysis: boolean;
  calculationDriveSearched: boolean;
  geminiWebSearchEnabled: boolean;
  calculationFileSearchStoreNames: string[];
};

export type N8nCandidateFile = {
  fileId?: string;
  driveFileId?: string;
  name?: string;
  driveName?: string;
  mimeType?: string;
  type?: string;
  sheetName?: string;
  fileSearchName?: string;
  source: string;
  reason: string;
  confidence?: number;
  matchedTerms?: string[];
  expectedUse?: string;
  sourceStateStatus?: string;
  likelyDomains?: string[];
};

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function entityTerms(entities: EntityMention[]) {
  return entities
    .map((entity) => entity.normalized)
    .filter((term) => term.length >= 2);
}

function hasEntity(entities: EntityMention[], kinds: EntityMention["kind"][]) {
  return entities.some((entity) => kinds.includes(entity.kind));
}

function includesAny(normalized: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(normalized));
}

function buildPlan(params: Omit<QueryPlan, "retrievalTerms"> & { retrievalTerms?: string[] }): QueryPlan {
  return {
    ...params,
    sourceRequirements: unique(params.sourceRequirements),
    allowedTools: unique(params.allowedTools),
    blockedFallbacks: unique(params.blockedFallbacks),
    answerContract: unique(params.answerContract),
    retrievalTerms: unique(params.retrievalTerms ?? entityTerms(params.entities)),
  };
}

export function buildQueryRoutingPolicy(plan: QueryPlan | null): QueryRoutingPolicy {
  const useAgent0DeepLane =
    plan?.intent === "internal_price_lookup" ||
    plan?.intent === "profit_loss" ||
    plan?.intent === "contract_status" ||
    plan?.intent === "project_progress" ||
    plan?.intent === "risk_summary";

  return {
    useLocalInventoryLookup: plan?.intent === "inventory_lookup",
    needsInternalFileAnalysis:
      plan?.intent === "internal_price_lookup" ||
      plan?.intent === "spreadsheet_calculation" ||
      plan?.intent === "profit_loss" ||
      plan?.intent === "contract_status" ||
      plan?.intent === "project_progress" ||
      plan?.intent === "risk_summary" ||
      plan?.intent === "inventory_analysis",
    blockInternalPriceWebFallback: plan?.intent === "internal_price_lookup",
    useInventoryBusinessFallback: plan?.intent === "inventory_analysis",
    useAgent0DeepLane,
  };
}

function getStringField(input: N8nCandidateFileInput, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function sanitizeCandidateFile(input: N8nCandidateFileInput): N8nCandidateFile {
  const fileId = getStringField(input, ["fileId", "file_id", "id"]);
  const driveFileId = getStringField(input, ["driveFileId", "drive_file_id"]);
  const name = getStringField(input, ["name", "fileName", "fileSearchName"]);
  const driveName = getStringField(input, ["driveName", "drive_name"]);
  const mimeType = getStringField(input, ["mimeType", "mime_type"]);
  const type = getStringField(input, ["type"]);
  const sheetName = getStringField(input, ["sheetName", "sheet_name"]);
  const fileSearchName = getStringField(input, ["fileSearchName", "file_search_name"]);
  const source = getStringField(input, ["source"]) || "agent_ai_candidate_resolution";
  const reason = getStringField(input, ["reason"]) || "resolved_for_internal_file_analysis";
  const expectedUse = getStringField(input, ["expectedUse", "expected_use"]);
  const sourceStateStatus = getStringField(input, ["sourceStateStatus", "source_state_status"]);
  const confidenceValue = input.confidence;
  const confidence =
    typeof confidenceValue === "number" && Number.isFinite(confidenceValue)
      ? Math.max(0, Math.min(1, confidenceValue))
      : undefined;
  const matchedTerms = Array.isArray(input.matchedTerms)
    ? input.matchedTerms.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : undefined;
  const likelyDomains = Array.isArray(input.likelyDomains)
    ? input.likelyDomains.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : undefined;

  return {
    ...(fileId ? { fileId } : {}),
    ...(driveFileId ? { driveFileId } : {}),
    ...(name ? { name } : {}),
    ...(driveName ? { driveName } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(type ? { type } : {}),
    ...(sheetName ? { sheetName } : {}),
    ...(fileSearchName ? { fileSearchName } : {}),
    source,
    reason,
    ...(typeof confidence === "number" ? { confidence } : {}),
    ...(matchedTerms && matchedTerms.length > 0 ? { matchedTerms } : {}),
    ...(expectedUse ? { expectedUse } : {}),
    ...(sourceStateStatus ? { sourceStateStatus } : {}),
    ...(likelyDomains && likelyDomains.length > 0 ? { likelyDomains } : {}),
  };
}

function buildAnswerContract(params: {
  queryPlan: QueryPlan | null;
  businessAnswerContract: string[];
}) {
  const { queryPlan, businessAnswerContract } = params;

  return uniqueStrings([
    ...(queryPlan?.answerContract ?? []),
    ...businessAnswerContract,
    queryPlan?.intent === "internal_price_lookup" || queryPlan?.blockedFallbacks.includes("web_search")
      ? "do_not_use_web_prices"
      : null,
    queryPlan?.intent === "profit_loss" ? "do_not_conclude_profit_without_cost" : null,
    queryPlan?.intent === "profit_loss" ||
    queryPlan?.intent === "spreadsheet_calculation" ||
    queryPlan?.intent === "inventory_analysis" ||
    queryPlan?.answerContract.includes("state_formula")
      ? "state_formula"
      : null,
    queryPlan?.intent !== "general" && queryPlan?.intent !== "external_web"
      ? "separate_verified_missing_inferred"
      : null,
    queryPlan?.allowedTools.some((tool) => tool !== "general_model" && tool !== "gemini_web_search")
      ? "cite_internal_sources"
      : null,
  ]);
}

function safeJsonStringify(params: {
  field: string;
  value: unknown;
  fallback: unknown;
  onSerializationError?: (field: string, error: unknown) => void;
}) {
  try {
    return JSON.stringify(params.value);
  } catch (error) {
    params.onSerializationError?.(params.field, error);
    return JSON.stringify(params.fallback);
  }
}

export function buildN8nSourcePlanPayload(params: N8nSourcePlanPayloadInput): N8nSourcePlanPayload {
  const queryPlan = params.queryPlan;
  const businessPlan = params.businessAnalysisPlan;
  const answerContract = buildAnswerContract({
    queryPlan,
    businessAnswerContract: businessPlan?.answerContract ?? [],
  });
  const candidateFiles = (params.candidateFiles ?? []).map(sanitizeCandidateFile);
  const sourcePlan: N8nSourcePlan = {
    intent: queryPlan?.intent ?? businessPlan?.intent ?? (params.hasAttachment ? "attachment_analysis" : "general"),
    entities: queryPlan?.entities ?? [],
    sourceRequirements: uniqueStrings([
      ...(queryPlan?.sourceRequirements ?? []),
      ...(businessPlan?.requiredSources ?? []),
    ]),
    allowedTools: uniqueStrings(queryPlan?.allowedTools ?? []),
    blockedFallbacks: uniqueStrings(queryPlan?.blockedFallbacks ?? []),
    requiresMultipleSources: queryPlan?.requiresMultipleSources ?? businessPlan?.requiresMultipleSources ?? false,
    retrievalTerms: uniqueStrings([
      ...(queryPlan?.retrievalTerms ?? []),
      ...(businessPlan?.retrievalTerms ?? []),
    ]),
    routingPolicy: params.routingPolicy,
    needsInternalFileAnalysis: params.needsInternalFileAnalysis,
    calculationDriveSearched: params.calculationDriveSearched,
    geminiWebSearchEnabled: params.geminiWebSearchEnabled,
    calculationFileSearchStoreNames: uniqueStrings(params.calculationFileSearchStoreNames ?? []),
  };

  return {
    sourcePlan: safeJsonStringify({
      field: "source_plan",
      value: sourcePlan,
      fallback: {
        intent: "general",
        entities: [],
        sourceRequirements: [],
        allowedTools: [],
        blockedFallbacks: [],
        requiresMultipleSources: false,
        retrievalTerms: [],
        routingPolicy: params.routingPolicy,
        needsInternalFileAnalysis: params.needsInternalFileAnalysis,
        calculationDriveSearched: params.calculationDriveSearched,
        geminiWebSearchEnabled: params.geminiWebSearchEnabled,
        calculationFileSearchStoreNames: [],
      },
      onSerializationError: params.onSerializationError,
    }),
    candidateFiles: safeJsonStringify({
      field: "candidate_files",
      value: candidateFiles,
      fallback: [],
      onSerializationError: params.onSerializationError,
    }),
    answerContract: safeJsonStringify({
      field: "answer_contract",
      value: answerContract,
      fallback: [],
      onSerializationError: params.onSerializationError,
    }),
  };
}

export function buildQueryPlan(prompt: string, context: QueryPlannerContext = {}): QueryPlan {
  const normalized = normalizeBusinessText(prompt);
  const normalizedForIntent = removeInternalLookupInstructionPhrases(normalized);
  const entities = extractEntities(prompt);

  if (!normalized) {
    return buildPlan({
      intent: "general",
      entities,
      sourceRequirements: [],
      allowedTools: ["general_model", "n8n"],
      blockedFallbacks: [],
      answerContract: [],
      requiresMultipleSources: false,
      confidence: "low",
    });
  }

  const explicitWebIntent = context.explicitWebAllowed || includesAny(normalizedForIntent, [
    /\b(web|google|internet|thi truong|cong khai|ben ngoai|gia thi truong|search web)\b/,
  ]);
  const priceSignal = includesAny(normalized, [
    /\b(phieu tinh gia|tim gia|gia cua|gia san pham|gia dieu hoa|bao gia|bang gia|don gia|price)\b/,
  ]);
  const inventorySignal = includesAny(normalized, [
    /\b(ton kho|hang ton|kho hang|nhap xuat ton|ton hien tai|con ton|ton bao nhieu|con bao nhieu|trong kho|tung kho|theo kho|o kho|am kho|duoi nguong|nguong toi thieu)\b/,
  ]);
  const asksWarehouseDimension = includesAny(normalized, [
    /\b(tung kho|moi kho|theo kho|o kho|kho nao)\b/,
  ]);
  const riskSummarySignal = includesAny(normalized, [
    /\b(bao cao ngan|tong hop|rui ro|can.*can thiep|can thiep ngay|hom nay).*\b(tai chinh|ton kho|tien do|du an|rui ro)\b/,
    /\b(tai chinh|ton kho|tien do|rui ro)\b.*\b(tong hop|bao cao)\b/,
    /\b(tach ro|phan tach|du lieu chac chan|du lieu thieu|suy luan)\b.*\b(du lieu|cau tra loi|tra loi|noi ro)\b/,
  ]);
  const profitLossSignal = includesAny(normalized, [
    /\b(lai[\s/.-]*lo|loi nhuan|dang lai|dang lo|lo nhat|lai nhat|doanh thu.*chi phi|chi phi.*doanh thu|doanh thu.*gia von|gia von.*doanh thu|quy\s*\d|quy gan nhat)\b/,
  ]);
  const contractStatusSignal = includesAny(normalized, [
    /\b(hop dong|quyet toan|hoan thanh.*chua quyet toan|chua quyet toan|cong no|thanh toan|nghiem thu)\b/,
  ]);
  const projectProgressSignal = includesAny(normalized, [
    /\b(du an|cong trinh|tien do|deadline|tre deadline|hang muc|phu trach|da xong|chua xong|phan tram|khoi luong|du toan|thuc te)\b/,
  ]);
  const inventoryAnalysisSignal = includesAny(normalized, [
    /\b(tung kho|moi kho|theo kho|o kho|nhap xuat ton|the kho|kiem ke|doi chieu.*kho|kho.*doi chieu|am kho|duoi nguong|nguong toi thieu|ton kho.*hom nay|cap nhat.*ton kho|lan cap nhat.*kho|bao cao.*kho|tong hop.*kho|phan tich.*kho|kho hang.*bao cao|kho hang.*tong hop)\b/,
  ]);

  if (explicitWebIntent && !/\b(noi bo|he thong|file|drive|bao gia noi bo)\b/.test(normalized)) {
    return buildPlan({
      intent: "external_web",
      entities,
      sourceRequirements: ["external_web"],
      allowedTools: ["gemini_web_search"],
      blockedFallbacks: ["unverified_internal_data"],
      answerContract: ["ground_web_sources"],
      requiresMultipleSources: false,
      confidence: "high",
    });
  }

  if (riskSummarySignal) {
    return buildPlan({
      intent: "risk_summary",
      entities,
      sourceRequirements: ["revenue", "cost", "inventory_current_stock", "project_progress"],
      allowedTools: ["drive_file_search", "raw_spreadsheet", "gemini_file_search"],
      blockedFallbacks: ["web_search", "general_answer", "drive_visible_as_indexed"],
      answerContract: ["separate_verified_missing_inferred", "cite_internal_sources"],
      requiresMultipleSources: true,
      confidence: "medium",
      retrievalTerms: unique([
        "tai chinh",
        "doanh thu",
        "chi phi",
        "ton kho",
        "nhap xuat ton",
        "kho",
        "tien do",
        "du an",
        "rui ro",
        "bao cao",
        "deadline",
        ...entityTerms(entities),
      ]),
    });
  }

  if (profitLossSignal) {
    return buildPlan({
      intent: "profit_loss",
      entities,
      sourceRequirements: ["revenue", "cost", "contract_status"],
      allowedTools: ["drive_file_search", "raw_spreadsheet", "gemini_file_search"],
      blockedFallbacks: ["web_search", "general_answer", "drive_visible_as_indexed"],
      answerContract: [
        "do_not_conclude_profit_without_cost",
        "state_formula",
        "separate_verified_missing_inferred",
        "cite_internal_sources",
      ],
      requiresMultipleSources: true,
      confidence: "high",
      retrievalTerms: unique([
        "saleadmin",
        "sale admin",
        "doanh thu",
        "chi phi",
        "gia von",
        "vat tu",
        "hop dong",
        "quyet toan",
        "thanh toan",
        "nghiem thu",
        "quy",
        ...entityTerms(entities),
      ]),
    });
  }

  if (contractStatusSignal) {
    return buildPlan({
      intent: "contract_status",
      entities,
      sourceRequirements: ["contract_status"],
      allowedTools: ["drive_file_search", "raw_spreadsheet", "gemini_file_search"],
      blockedFallbacks: ["web_search", "general_answer", "drive_visible_as_indexed"],
      answerContract: ["separate_verified_missing_inferred", "cite_internal_sources"],
      requiresMultipleSources: true,
      confidence: "high",
      retrievalTerms: unique([
        "hop dong",
        "quyet toan",
        "thanh toan",
        "nghiem thu",
        "cong no",
        "saleadmin",
        "bao cao",
        "du an",
        ...entityTerms(entities),
      ]),
    });
  }

  if (projectProgressSignal) {
    return buildPlan({
      intent: "project_progress",
      entities,
      sourceRequirements: ["project_progress"],
      allowedTools: ["drive_file_search", "raw_spreadsheet", "gemini_file_search"],
      blockedFallbacks: ["web_search", "general_answer", "drive_visible_as_indexed"],
      answerContract: ["separate_verified_missing_inferred", "cite_internal_sources"],
      requiresMultipleSources: true,
      confidence: "high",
      retrievalTerms: unique([
        "du an",
        "cong trinh",
        "tien do",
        "deadline",
        "hang muc",
        "phu trach",
        "nghiem thu",
        "khoi luong",
        "du toan",
        "thuc te",
        "bao cao thi cong",
        "giao viec",
        ...entityTerms(entities),
      ]),
    });
  }

  if (inventoryAnalysisSignal) {
    return buildPlan({
      intent: "inventory_analysis",
      entities,
      sourceRequirements: unique([
        "inventory_current_stock",
        "inventory_movement",
        asksWarehouseDimension ? "warehouse_dimension" : "inventory_movement",
      ]),
      allowedTools: ["inventory_db", "drive_file_search", "raw_spreadsheet", "gemini_file_search"],
      blockedFallbacks: ["web_search", "general_answer", "drive_visible_as_indexed"],
      answerContract: [
        "separate_verified_missing_inferred",
        "cite_internal_sources",
        asksWarehouseDimension ? "state_missing_warehouse_dimension" : "state_formula",
      ],
      requiresMultipleSources: true,
      confidence: "high",
      retrievalTerms: unique([
        "kho",
        "ton kho",
        "nhap xuat ton",
        "the kho",
        "kiem ke",
        "hang hoa",
        "mat hang",
        "san pham",
        "ma hang",
        "so luong",
        "xuat",
        "nhap",
        "kho hang",
        ...entityTerms(entities),
      ]),
    });
  }

  if (priceSignal || (hasEntity(entities, ["brand", "model", "product_code"]) && /\bgia\b/.test(normalized))) {
    return buildPlan({
      intent: "internal_price_lookup",
      entities,
      sourceRequirements: ["internal_price_file", "raw_spreadsheet"],
      allowedTools: ["drive_file_search", "raw_spreadsheet", "gemini_file_search"],
      blockedFallbacks: ["web_search", "general_answer", "drive_visible_as_indexed"],
      answerContract: ["do_not_use_web_prices", "separate_verified_missing_inferred", "cite_internal_sources"],
      requiresMultipleSources: false,
      confidence: hasEntity(entities, ["brand", "model", "product_code"]) ? "high" : "medium",
      retrievalTerms: unique(["gia", "bang gia", "bao gia", "niem yet", ...entityTerms(entities)]),
    });
  }

  if (
    inventorySignal ||
    (hasEntity(entities, ["brand", "product_type", "model", "product_code"]) &&
      /\b(kho|bao nhieu|con|ton|hang|san pham|mat hang|ma hang|loai)\b/.test(normalized))
  ) {
    return buildPlan({
      intent: "inventory_lookup",
      entities,
      sourceRequirements: unique([
        "inventory_current_stock",
        asksWarehouseDimension ? "warehouse_dimension" : "inventory_current_stock",
      ]),
      allowedTools: ["inventory_db"],
      blockedFallbacks: ["web_search", "general_answer"],
      answerContract: unique([
        "separate_verified_missing_inferred",
        asksWarehouseDimension ? "state_missing_warehouse_dimension" : "cite_internal_sources",
      ]),
      requiresMultipleSources: asksWarehouseDimension,
      confidence: hasEntity(entities, ["brand", "product_type", "model", "product_code"]) ? "high" : "medium",
    });
  }

  if (
    includesAny(normalized, [
      /\b(tinh|tinh toan|phan tich|loc|tim|dem|bao nhieu|liet ke|danh sach|so sanh|doi chieu|xep hang|top|cao nhat|thap nhat|lon nhat|nho nhat|vuot|tren|duoi|tong|trung binh|chenh lech|bien loi nhuan|margin|so luong|thanh tien|tieu chi|dieu kien)\b/,
    ]) &&
    includesAny(normalized, [
      /\b(file|excel|xls|xlsx|bang|sheet|bao cao|saleadmin|hop dong|du an|kho|hang hoa|mat hang|san pham|khach hang|nhan vien|doanh so|don vi|don vi tinh|cong ty|quy|tai chinh)\b/,
    ])
  ) {
    return buildPlan({
      intent: "spreadsheet_calculation",
      entities,
      sourceRequirements: ["raw_spreadsheet"],
      allowedTools: ["drive_file_search", "raw_spreadsheet", "gemini_file_search"],
      blockedFallbacks: ["web_search", "general_answer", "drive_visible_as_indexed"],
      answerContract: ["state_formula", "separate_verified_missing_inferred", "cite_internal_sources"],
      requiresMultipleSources: false,
      confidence: "medium",
    });
  }

  return buildPlan({
    intent: "general",
    entities,
    sourceRequirements: [],
    allowedTools: ["general_model", "n8n"],
    blockedFallbacks: [],
    answerContract: [],
    requiresMultipleSources: false,
    confidence: "medium",
  });
}
