import type {
  EntityMention,
} from "./entity-normalizer.ts";
import {
  normalizeBusinessText,
} from "./entity-normalizer.ts";
import {
  isInternalLookupInstructionStopWord,
  removeInternalLookupInstructionPhrases,
} from "./internal-query-terms.ts";
import type {
  AnswerContract,
  QueryPlan,
  SourceRequirement,
} from "./query-planner.ts";
import type {
  SourceCatalogItem,
  SourceCatalogOrigin,
  SourceDomain,
} from "./source-catalog.ts";
import {
  classifyPriceSourceKind,
  sourceCatalogText,
  sourceStateRank,
  uniqueCatalogStrings,
} from "./source-catalog.ts";

export type RecommendedLane =
  | "local_db"
  | "deterministic_single_file"
  | "agent0_deep"
  | "gemini_internal"
  | "missing_source"
  | "ask_followup"
  | "web";

export type CandidateExpectedUse =
  | "price_lookup"
  | "inventory_lookup"
  | "profit_loss_revenue"
  | "profit_loss_cost"
  | "project_progress"
  | "contract_status"
  | "risk_summary"
  | "technical_support"
  | "maintenance_procedure"
  | "sales_process"
  | "company_policy"
  | "service_job_status"
  | "customer_lookup"
  | "general_internal_file";

export type SourceCandidateFile = {
  driveFileId: string;
  driveName: string;
  mimeType?: string;
  source: SourceCatalogOrigin;
  reason: string;
  confidence: number;
  matchedTerms: string[];
  expectedUse: CandidateExpectedUse;
  sourceStateStatus: string;
  likelyDomains: SourceDomain[];
  fileSearchName?: string;
};

export type SourceDecisionTraceEvent = {
  step: string;
  status: "success" | "partial" | "missing_source" | "skipped";
  detail?: string;
};

export type SourceDecision = {
  recommendedLane: RecommendedLane;
  reason: string;
  confidence: number;
  candidateFiles: SourceCandidateFile[];
  requiredSources: SourceRequirement[];
  missingSources: SourceRequirement[];
  answerContract: AnswerContract[];
  trace: SourceDecisionTraceEvent[];
};

export type SourceRoutePolicy = {
  shouldUseAgent0DeepLane: boolean;
  shouldUseLocalInventoryDb: boolean;
  shouldUseInventoryFallback: boolean;
  outgoingCandidateFileCount: number;
  routeIntent: RecommendedLane;
};

type RankedCandidate = {
  item: SourceCatalogItem;
  score: number;
  matchedTerms: string[];
  expectedUse: CandidateExpectedUse;
  reasons: string[];
};

const DOMAIN_BY_REQUIREMENT: Partial<Record<SourceRequirement, SourceDomain[]>> = {
  inventory_current_stock: ["inventory"],
  inventory_movement: ["inventory"],
  warehouse_dimension: ["inventory"],
  internal_price_file: ["price"],
  revenue: ["finance", "contract", "report"],
  cost: ["finance", "contract", "report"],
  contract_status: ["contract", "project", "report"],
  project_progress: ["project", "report"],
  technical_manual: ["technical"],
  error_code_reference: ["error_code"],
  installation_guide: ["installation"],
  repair_procedure: ["repair"],
  maintenance_procedure: ["maintenance"],
  warranty_policy: ["warranty"],
  sales_process_doc: ["sales_process", "customer"],
  company_policy_doc: ["policy", "hr", "company_profile", "finance"],
  service_job_data: ["service_job", "technical", "customer", "report"],
  customer_data: ["customer", "sales_process"],
  raw_spreadsheet: ["price", "inventory", "finance", "project", "contract", "report"],
};

const GENERIC_SOURCE_LOOKUP_STOP_WORDS = new Set([
  "bao",
  "can",
  "cho",
  "con",
  "cua",
  "dieu",
  "duoc",
  "hang",
  "hay",
  "hoa",
  "la",
  "luc",
  "may",
  "nao",
  "noi",
  "phan",
  "pham",
  "quy",
  "san",
  "the",
  "thi",
  "thong",
  "tin",
  "trinh",
  "trong",
  "tu",
  "ve",
]);

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function normalizedTokens(value: string) {
  const cleaned = removeInternalLookupInstructionPhrases(normalizeBusinessText(value));
  return cleaned
    .split(/\s+/)
    .map((term) => term.replace(/[^a-z0-9]/g, ""))
    .filter((term) =>
      term.length >= 3 &&
      !isInternalLookupInstructionStopWord(term) &&
      !GENERIC_SOURCE_LOOKUP_STOP_WORDS.has(term)
    );
}

export function buildSourceLookupTerms(params: {
  prompt: string;
  plan: QueryPlan;
  entities?: EntityMention[];
}) {
  const entityTerms = (params.entities ?? params.plan.entities)
    .map((entity) => entity.normalized)
    .filter((term) => term.length >= 2 && !isInternalLookupInstructionStopWord(term));
  const retrievalTerms = params.plan.retrievalTerms
    .flatMap((term) => normalizedTokens(term).length > 0 ? [normalizeBusinessText(term)] : [])
    .filter((term) => term.length >= 2 && !isInternalLookupInstructionStopWord(term));
  const promptTerms = normalizedTokens(params.prompt)
    .filter((term) => !/^(khong|dung|web|google|internet|thi|truong|cong|khai|ben|ngoai)$/.test(term));

  return uniqueCatalogStrings([
    ...entityTerms,
    ...retrievalTerms,
    ...promptTerms,
  ]).slice(0, 24);
}

function expectedUseForItem(plan: QueryPlan, item: SourceCatalogItem): CandidateExpectedUse {
  if (plan.intent === "technical_support") {
    return "technical_support";
  }
  if (plan.intent === "maintenance_warranty") {
    return "maintenance_procedure";
  }
  if (plan.intent === "sales_process") {
    return "sales_process";
  }
  if (plan.intent === "company_policy") {
    return "company_policy";
  }
  if (plan.intent === "service_job_status") {
    return "service_job_status";
  }
  if (plan.intent === "customer_lookup") {
    return "customer_lookup";
  }
  if (plan.intent === "internal_price_lookup" || item.likelyDomains.includes("price")) {
    return "price_lookup";
  }
  if (plan.intent === "inventory_lookup" || plan.intent === "inventory_analysis" || item.likelyDomains.includes("inventory")) {
    return "inventory_lookup";
  }
  if (plan.intent === "profit_loss") {
    if (item.likelyDomains.includes("finance") || item.likelyDomains.includes("report")) {
      return "profit_loss_revenue";
    }
    if (item.likelyDomains.includes("contract")) {
      return "profit_loss_cost";
    }
  }
  if (plan.intent === "project_progress" || item.likelyDomains.includes("project")) {
    return "project_progress";
  }
  if (plan.intent === "contract_status" || item.likelyDomains.includes("contract")) {
    return "contract_status";
  }
  if (plan.intent === "risk_summary") {
    return "risk_summary";
  }
  if (item.likelyDomains.some((domain) => ["technical", "installation", "error_code"].includes(domain))) {
    return "technical_support";
  }
  if (item.likelyDomains.some((domain) => ["maintenance", "warranty"].includes(domain))) {
    return "maintenance_procedure";
  }
  if (item.likelyDomains.includes("sales_process")) {
    return "sales_process";
  }
  if (item.likelyDomains.some((domain) => ["policy", "hr", "company_profile"].includes(domain))) {
    return "company_policy";
  }
  if (item.likelyDomains.includes("service_job")) {
    return "service_job_status";
  }
  if (item.likelyDomains.includes("customer")) {
    return "customer_lookup";
  }
  return "general_internal_file";
}

function requiredDomains(plan: QueryPlan) {
  return unique(
    plan.sourceRequirements.flatMap((requirement) => DOMAIN_BY_REQUIREMENT[requirement] ?? []),
  );
}

function sourceMatchesDomain(item: SourceCatalogItem, domains: SourceDomain[]) {
  if (domains.length === 0) {
    return false;
  }
  return item.likelyDomains.some((domain) => domains.includes(domain));
}

function scoreSourceItem(params: {
  item: SourceCatalogItem;
  plan: QueryPlan;
  lookupTerms: string[];
  domains: SourceDomain[];
}): RankedCandidate | null {
  const { item, plan, lookupTerms, domains } = params;
  if (!item.driveFileId) {
    return null;
  }

  const text = sourceCatalogText([
    item.driveName,
    item.fileSearchName,
    item.pathHint,
    item.folderHint,
    item.likelyDomains.join(" "),
  ].filter(Boolean).join(" "));
  const matchedTerms = lookupTerms.filter((term) => {
    const normalized = normalizeBusinessText(term);
    return normalized.length >= 2 && text.includes(normalized);
  });
  const reasons: string[] = [];
  let score = 0;
  const matchesRequiredDomain = sourceMatchesDomain(item, domains);

  if (matchesRequiredDomain) {
    score += 24;
    reasons.push(`domain=${item.likelyDomains.filter((domain) => domains.includes(domain)).join(",")}`);
  }

  if (!matchesRequiredDomain && matchedTerms.length === 0) {
    return null;
  }

  if (matchedTerms.length > 0) {
    score += Math.min(18, matchedTerms.length * 4);
    reasons.push(`matched_terms=${matchedTerms.join(",")}`);
  }

  score += sourceStateRank(item.sourceState.status) * 2;
  reasons.push(`source_state=${item.sourceState.status}`);

  if (item.source === "file_search_storage" || item.source === "drive_index") {
    score += 4;
    reasons.push(`source=${item.source}`);
  }

  if (item.source === "drive_fallback") {
    score += 1;
    reasons.push("drive_visible_candidate");
  }

  if (plan.intent === "internal_price_lookup") {
    const priceKind = classifyPriceSourceKind({
      name: item.driveName,
      fileSearchName: item.fileSearchName,
      pathHint: item.pathHint,
    });
    const wantsServicePrice = lookupTerms.some((term) =>
      /\b(gia dich vu|dich vu|sua chua|bao duong|bao tri|lap dat|lap dat nho le|vat tu|nhan cong)\b/.test(normalizeBusinessText(term)),
    );

    if (priceKind === "service_price" && wantsServicePrice) {
      score += 14;
      reasons.push("service_price_source");
    } else if (priceKind === "product_price" && !wantsServicePrice) {
      score += 12;
      reasons.push("product_price_source");
    } else if (priceKind === "service_price") {
      score -= 5;
      reasons.push("service_price_demoted");
    }
  }

  if (plan.intent === "risk_summary" && item.likelyDomains.some((domain) => ["finance", "inventory", "project", "contract", "report"].includes(domain))) {
    score += 6;
    reasons.push("risk_summary_domain_coverage");
  }

  if (plan.intent === "profit_loss" && item.likelyDomains.some((domain) => ["finance", "contract", "report"].includes(domain))) {
    score += 8;
    reasons.push("profit_loss_source");
  }

  if (
    ["technical_support", "maintenance_warranty", "sales_process", "company_policy", "service_job_status", "customer_lookup"].includes(plan.intent) &&
    item.likelyDomains.some((domain) =>
      [
        "technical",
        "installation",
        "maintenance",
        "warranty",
        "error_code",
        "sales_process",
        "company_profile",
        "policy",
        "hr",
        "service_job",
        "customer",
      ].includes(domain),
    )
  ) {
    score += 8;
    reasons.push("internal_domain_source");
  }

  if (score <= 0) {
    return null;
  }

  return {
    item,
    score,
    matchedTerms,
    expectedUse: expectedUseForItem(plan, item),
    reasons,
  };
}

function missingRequirements(plan: QueryPlan, candidates: RankedCandidate[]) {
  return plan.sourceRequirements.filter((requirement) => {
    const domains = DOMAIN_BY_REQUIREMENT[requirement] ?? [];
    if (domains.length === 0) {
      return false;
    }
    return !candidates.some((candidate) => sourceMatchesDomain(candidate.item, domains));
  });
}

function chooseLane(params: {
  plan: QueryPlan;
  candidates: RankedCandidate[];
  missingSources: SourceRequirement[];
}) {
  const { plan, candidates, missingSources } = params;

  if (plan.intent === "external_web") {
    return {
      recommendedLane: "web" as const,
      reason: "external_web_intent",
    };
  }

  if (plan.intent === "general") {
    return {
      recommendedLane: "ask_followup" as const,
      reason: "no_internal_source_requirement",
    };
  }

  if (plan.intent === "inventory_lookup" && !plan.sourceRequirements.includes("warehouse_dimension")) {
    return {
      recommendedLane: "local_db" as const,
      reason: "complete_inventory_total_prefers_app_db",
    };
  }

  if (candidates.length > 0) {
    if (plan.intent === "spreadsheet_calculation" && !plan.requiresMultipleSources && candidates.length === 1) {
      return {
        recommendedLane: "deterministic_single_file" as const,
        reason: "single_candidate_spreadsheet_can_be_deterministic_first",
      };
    }

    if (
      plan.intent === "internal_price_lookup" ||
      plan.intent === "profit_loss" ||
      plan.intent === "contract_status" ||
      plan.intent === "project_progress" ||
      plan.intent === "risk_summary" ||
      plan.intent === "inventory_analysis" ||
      plan.intent === "technical_support" ||
      plan.intent === "maintenance_warranty" ||
      plan.intent === "sales_process" ||
      plan.intent === "company_policy" ||
      plan.intent === "service_job_status" ||
      plan.intent === "customer_lookup"
    ) {
      return {
        recommendedLane: "agent0_deep" as const,
        reason: plan.requiresMultipleSources
          ? "multi_source_or_partial_internal_analysis"
          : "internal_file_lookup",
      };
    }

    return {
      recommendedLane: "gemini_internal" as const,
      reason: "internal_candidates_available",
    };
  }

  return {
    recommendedLane: "missing_source" as const,
    reason: missingSources.length > 0
      ? `missing_required_sources:${missingSources.join(",")}`
      : "no_candidate_files",
  };
}

export function buildSourceDecision(params: {
  prompt: string;
  plan: QueryPlan;
  catalog: SourceCatalogItem[];
  entities?: EntityMention[];
  maxCandidates?: number;
}): SourceDecision {
  const lookupTerms = buildSourceLookupTerms({
    prompt: params.prompt,
    plan: params.plan,
    entities: params.entities,
  });
  const domains = requiredDomains(params.plan);
  const ranked = params.catalog
    .map((item) => scoreSourceItem({
      item,
      plan: params.plan,
      lookupTerms,
      domains,
    }))
    .filter((item): item is RankedCandidate => Boolean(item))
    .sort((left, right) => right.score - left.score);

  const missingSources = missingRequirements(params.plan, ranked);
  const lane = chooseLane({
    plan: params.plan,
    candidates: ranked,
    missingSources,
  });
  const maxCandidates = params.maxCandidates ?? (params.plan.requiresMultipleSources ? 8 : 5);
  const candidateFiles = ranked.slice(0, maxCandidates).map((candidate) => ({
    driveFileId: candidate.item.driveFileId!,
    driveName: candidate.item.driveName,
    ...(candidate.item.mimeType ? { mimeType: candidate.item.mimeType } : {}),
    source: candidate.item.source,
    reason: candidate.reasons.join("; "),
    confidence: Math.max(0.05, Math.min(0.99, candidate.score / 60)),
    matchedTerms: candidate.matchedTerms,
    expectedUse: candidate.expectedUse,
    sourceStateStatus: candidate.item.sourceState.status,
    likelyDomains: candidate.item.likelyDomains,
    ...(candidate.item.fileSearchName ? { fileSearchName: candidate.item.fileSearchName } : {}),
  }));

  return {
    recommendedLane: lane.recommendedLane,
    reason: lane.reason,
    confidence: candidateFiles.length > 0
      ? Math.max(...candidateFiles.map((candidate) => candidate.confidence))
      : params.plan.confidence === "high"
        ? 0.7
        : 0.45,
    candidateFiles,
    requiredSources: params.plan.sourceRequirements,
    missingSources,
    answerContract: params.plan.answerContract,
    trace: [
      {
        step: "source_catalog",
        status: params.catalog.length > 0 ? "success" : "missing_source",
        detail: `catalog_items=${params.catalog.length}`,
      },
      {
        step: "candidate_ranking",
        status: candidateFiles.length > 0 ? "success" : "missing_source",
        detail: `candidates=${candidateFiles.length}; terms=${lookupTerms.join(",") || "none"}`,
      },
      {
        step: "lane_decision",
        status: lane.recommendedLane === "missing_source" ? "missing_source" : "success",
        detail: `${lane.recommendedLane}:${lane.reason}`,
      },
    ],
  };
}

export function buildSourceRoutePolicy(params: {
  plan: QueryPlan;
  decision: SourceDecision | null;
}): SourceRoutePolicy {
  const candidateCount = params.decision?.candidateFiles.length ?? 0;
  const routeIntent = params.decision?.recommendedLane ?? (
    params.plan.intent === "external_web"
      ? "web"
      : params.plan.intent === "inventory_lookup"
        ? "local_db"
        : "missing_source"
  );
  const shouldUseAgent0DeepLane =
    routeIntent === "agent0_deep" && candidateCount > 0;

  return {
    shouldUseAgent0DeepLane,
    shouldUseLocalInventoryDb:
      routeIntent === "local_db" &&
      params.plan.intent === "inventory_lookup" &&
      !params.plan.sourceRequirements.includes("warehouse_dimension"),
    shouldUseInventoryFallback:
      params.plan.intent === "inventory_analysis" && !shouldUseAgent0DeepLane,
    outgoingCandidateFileCount: candidateCount,
    routeIntent,
  };
}
