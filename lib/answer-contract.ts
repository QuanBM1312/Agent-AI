import type { QueryPlan, SourceRequirement } from "./query-planner.ts";

export type VerificationStatus =
  | "verified"
  | "partial"
  | "missing"
  | "tool_unavailable"
  | "unverified";

export type EvidenceKind =
  | "db"
  | "drive_file"
  | "spreadsheet_row"
  | "vector_chunk"
  | "n8n"
  | "agent0"
  | "web";

export type EvidenceItem = {
  kind: EvidenceKind;
  sourceName: string;
  fileId?: string;
  sheet?: string;
  row?: number;
  dbTable?: string;
  field?: string;
  confidence: "low" | "medium" | "high";
};

export type MissingDataItem = {
  field: string;
  reason: string;
  sourceRequirement?: SourceRequirement;
};

export type ExecutionTraceEvent = {
  step: string;
  status: "success" | "partial" | "missing_source" | "tool_unavailable" | "skipped" | "error";
  routeHint?: string;
  detail?: string;
};

export type AnswerContractMetadata = {
  verificationStatus: VerificationStatus;
  evidence: EvidenceItem[];
  missingData: MissingDataItem[];
  warnings: string[];
  executionTrace: ExecutionTraceEvent[];
};

export type BuildAnswerContractMetadataInput = {
  queryPlan: QueryPlan | null;
  routeHint: string;
  output?: string;
  citations?: unknown;
  responseEvidence?: unknown;
  degradedFrom?: string;
  toolProvider?: string;
  agent0ContextId?: string | null;
  calculationDriveSearched?: boolean;
  candidateFileCount?: number;
  sourcePlanPresent?: boolean;
  answerContractPresent?: boolean;
  toolExecutionProof?: boolean;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/g, "d")
    .toLowerCase();
}

function readCitations(citations: unknown) {
  return Array.isArray(citations)
    ? citations.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
}

function hasStructuredEvidence(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.some((item) => {
    if (typeof item === "string") {
      return item.trim().length > 0;
    }

    if (typeof item !== "object" || item === null) {
      return false;
    }

    return Object.values(item).some((field) => typeof field === "string" && field.trim().length > 0);
  });
}

function routeIncludes(routeHint: string, fragments: string[]) {
  return fragments.some((fragment) => routeHint.includes(fragment));
}

function isInternalPlan(plan: QueryPlan | null) {
  return Boolean(plan && plan.intent !== "general" && plan.intent !== "external_web");
}

function evidenceFromRoute(params: BuildAnswerContractMetadataInput): EvidenceItem[] {
  const routeHint = params.routeHint;
  const citations = readCitations(params.citations);
  const hasCitations = citations.length > 0;
  const hasResponseEvidence = hasStructuredEvidence(params.responseEvidence);
  const hasAgent0Proof = Boolean(params.agent0ContextId?.trim()) || routeIncludes(routeHint, ["agent0", "search_agent0"]);
  const hasN8nToolProof = params.toolExecutionProof === true || hasCitations || hasResponseEvidence;
  const evidence: EvidenceItem[] = [];

  if (routeHint.includes("inventory")) {
    evidence.push({
      kind: "db",
      sourceName: "production inventory database",
      dbTable: "dim_product + inventory_month_opening + inventory_daily_movement",
      confidence: "high",
    });
  }

  if (routeIncludes(routeHint, ["spreadsheet", "drive_spreadsheet"])) {
    evidence.push({
      kind: "spreadsheet_row",
      sourceName: citations[0] || "internal spreadsheet",
      confidence: citations.length > 0 ? "high" : "medium",
    });
  }

  if (routeHint.includes("gemini_file_search")) {
    evidence.push({
      kind: "vector_chunk",
      sourceName: citations[0] || "Gemini File Search",
      confidence: citations.length > 0 ? "medium" : "low",
    });
  }

  if (routeHint.includes("gemini_web_search")) {
    evidence.push({
      kind: "web",
      sourceName: citations[0] || "Gemini Google Search grounding",
      confidence: citations.length > 0 ? "medium" : "low",
    });
  }

  if (hasAgent0Proof) {
    evidence.push({
      kind: "agent0",
      sourceName: "Agent0 via n8n",
      confidence: hasCitations || hasResponseEvidence ? "medium" : "low",
    });
  } else if (params.toolProvider === "n8n" && hasN8nToolProof) {
    evidence.push({
      kind: "n8n",
      sourceName: citations[0] || "n8n sourced response",
      confidence: hasCitations || hasResponseEvidence ? "medium" : "low",
    });
  }

  return evidence;
}

function missingDataForPlan(params: BuildAnswerContractMetadataInput): MissingDataItem[] {
  const plan = params.queryPlan;
  const routeHint = params.routeHint;
  const output = normalize(params.output ?? "");
  const missing: MissingDataItem[] = [];

  if (!plan) {
    return missing;
  }

  if (
    plan.intent === "profit_loss" &&
    (routeIncludes(routeHint, ["needs_data", "source_not_found", "business_data_boundary", "unavailable"]) ||
      output.includes("thieu du lieu chi phi") ||
      output.includes("thieu chi phi"))
  ) {
    missing.push({
      field: "cost",
      reason: "Profit/loss conclusions require cost or cost-basis data.",
      sourceRequirement: "cost",
    });
  }

  if (
    plan.sourceRequirements.includes("warehouse_dimension") &&
    (routeHint.includes("inventory") || output.includes("chieu kho") || output.includes("vi tri kho"))
  ) {
    missing.push({
      field: "warehouse_dimension",
      reason: "The available stock path can prove product totals but not per-warehouse quantities.",
      sourceRequirement: "warehouse_dimension",
    });
  }

  if (
    plan.intent === "internal_price_lookup" &&
    routeIncludes(routeHint, ["internal_price_unavailable", "source_not_found", "needs_data", "unavailable"])
  ) {
    missing.push({
      field: "internal_price_file",
      reason: "The internal price file was not readable or not found.",
      sourceRequirement: "internal_price_file",
    });
  }

  for (const requirement of plan.sourceRequirements) {
    if (
      routeIncludes(routeHint, ["source_not_found", "needs_data"]) &&
      !missing.some((item) => item.sourceRequirement === requirement)
    ) {
      missing.push({
        field: requirement,
        reason: "Required source category was not verified for this answer.",
        sourceRequirement: requirement,
      });
    }
  }

  return missing;
}

function warningsForPlan(params: BuildAnswerContractMetadataInput) {
  const warnings: string[] = [];
  const routeHint = params.routeHint;

  if (params.queryPlan?.blockedFallbacks.includes("web_search")) {
    warnings.push("Web fallback is blocked for this internal business prompt.");
  }

  if (params.queryPlan?.blockedFallbacks.includes("drive_visible_as_indexed")) {
    warnings.push("Drive visibility is not treated as indexed or calculation-ready evidence.");
  }

  if (routeHint.includes("gemini_web_search")) {
    warnings.push("This answer used web grounding, not internal business data.");
  }

  if (params.degradedFrom) {
    warnings.push(`Upstream path degraded: ${params.degradedFrom}.`);
  }

  if (params.calculationDriveSearched && (params.candidateFileCount ?? 0) === 0) {
    warnings.push("No internal Drive candidate files were resolved for the required source search.");
  }

  return Array.from(new Set(warnings));
}

function statusFor(params: BuildAnswerContractMetadataInput, evidence: EvidenceItem[], missingData: MissingDataItem[]) {
  const routeHint = params.routeHint;

  if (params.degradedFrom || routeIncludes(routeHint, ["timeout", "fetch_error", "non_ok"])) {
    return "tool_unavailable" satisfies VerificationStatus;
  }

  if (routeIncludes(routeHint, ["source_not_found", "needs_data", "need_selection", "internal_price_unavailable"])) {
    return "missing" satisfies VerificationStatus;
  }

  if (routeHint.includes("unavailable")) {
    return "tool_unavailable" satisfies VerificationStatus;
  }

  if (missingData.length > 0) {
    return "partial" satisfies VerificationStatus;
  }

  if (evidence.length > 0) {
    return "verified" satisfies VerificationStatus;
  }

  if (isInternalPlan(params.queryPlan)) {
    return "partial" satisfies VerificationStatus;
  }

  return "unverified" satisfies VerificationStatus;
}

export function buildAnswerContractMetadata(
  params: BuildAnswerContractMetadataInput,
): AnswerContractMetadata {
  const evidence = evidenceFromRoute(params);
  const missingData = missingDataForPlan(params);
  const warnings = warningsForPlan(params);
  const verificationStatus = statusFor(params, evidence, missingData);
  const executionTrace: ExecutionTraceEvent[] = [
    {
      step: "query_planner",
      status: params.queryPlan ? "success" : "skipped",
      detail: params.queryPlan
        ? `intent=${params.queryPlan.intent}; sources=${params.queryPlan.sourceRequirements.join(",") || "none"}`
        : "No structured plan for this request type.",
    },
    {
      step: "source_plan",
      status: params.sourcePlanPresent ? "success" : "skipped",
      detail: params.sourcePlanPresent
        ? `candidate_files=${params.candidateFileCount ?? 0}; answer_contract=${String(params.answerContractPresent)}`
        : "No n8n source plan was sent for this path.",
    },
    {
      step: "tool_execution",
      status:
        verificationStatus === "verified"
          ? "success"
          : verificationStatus === "tool_unavailable"
            ? "tool_unavailable"
            : verificationStatus === "missing"
              ? "missing_source"
              : verificationStatus === "partial"
                ? "partial"
                : "skipped",
      routeHint: params.routeHint,
    },
    {
      step: "evidence_verifier",
      status:
        verificationStatus === "verified"
          ? "success"
          : verificationStatus === "tool_unavailable"
            ? "tool_unavailable"
            : missingData.length > 0
              ? "partial"
              : "skipped",
      detail: `verificationStatus=${verificationStatus}`,
    },
  ];

  return {
    verificationStatus,
    evidence,
    missingData,
    warnings,
    executionTrace,
  };
}
