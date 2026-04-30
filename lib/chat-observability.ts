export const CHAT_STAGE_DEFINITIONS = {
  reading_history: "Đang đọc lịch sử hội thoại",
  analyzing_input: "Đang phân tích giọng nói / hình ảnh / tệp đính kèm",
  routing: "Đang xác định cách xử lý",
  querying_internal_data: "Đang tra cứu dữ liệu nội bộ",
  searching_documents: "Đang đọc tài liệu liên quan",
  deep_reasoning: "Đang phân tích chuyên sâu",
  synthesizing: "Đang tổng hợp câu trả lời",
  completed: "Hoàn tất",
  failed: "Không thể hoàn tất yêu cầu",
} as const;

export type ChatStageKey = keyof typeof CHAT_STAGE_DEFINITIONS;
export type ChatRequestKind = "chat" | "voice" | "image";

export interface ChatStagePlanContext {
  type: ChatRequestKind;
  hasAttachment: boolean;
}

export interface ChatRequestMetric {
  requestId: string;
  sessionId: string;
  type: ChatRequestKind;
  hasAttachment: boolean;
  latencyMs: number;
  routeHint: string;
  outcome: "ok" | "error";
  stage: ChatStageKey;
  timestamp: string;
}

export const CHAT_TELEMETRY_STORAGE_KEY = "sutra-chat-telemetry";
export const CHAT_TELEMETRY_UPDATED_EVENT = "sutra-chat-telemetry-updated";
const TELEMETRY_LIMIT = 50;

export function getChatStageLabel(stage: ChatStageKey) {
  return CHAT_STAGE_DEFINITIONS[stage];
}

export function buildChatStagePlan(context: ChatStagePlanContext): ChatStageKey[] {
  const basePlan: ChatStageKey[] = ["reading_history"];

  if (context.hasAttachment || context.type !== "chat") {
    basePlan.push("analyzing_input");
  }

  basePlan.push("routing");

  if (context.hasAttachment) {
    basePlan.push("searching_documents", "deep_reasoning");
  } else {
    basePlan.push("querying_internal_data");
  }

  basePlan.push("synthesizing");
  return basePlan;
}

export function getStageAdvanceDelayMs(stage: ChatStageKey) {
  switch (stage) {
    case "reading_history":
      return 800;
    case "analyzing_input":
      return 1500;
    case "routing":
      return 1200;
    case "querying_internal_data":
      return 1800;
    case "searching_documents":
      return 2200;
    case "deep_reasoning":
      return 2800;
    case "synthesizing":
      return 1800;
    default:
      return 1000;
  }
}

export function createChatRequestId() {
  return `chat_${crypto.randomUUID()}`;
}

export function inferRouteHint(payload: Record<string, unknown>, context: ChatStagePlanContext) {
  const routeHintCandidates = [
    payload.route,
    payload.stage,
    payload.path,
    payload.branch,
  ];

  const directHint = routeHintCandidates.find((value) => typeof value === "string" && value.trim());
  if (typeof directHint === "string") {
    return directHint;
  }

  if (payload.citations) {
    return "document_grounded";
  }

  if (context.hasAttachment) {
    return "attachment_flow";
  }

  return "general";
}

export function createServerTimingHeader(entries: Array<{ name: string; durationMs: number }>) {
  return entries
    .filter((entry) => Number.isFinite(entry.durationMs) && entry.durationMs >= 0)
    .map((entry) => `${entry.name};dur=${entry.durationMs.toFixed(1)}`)
    .join(", ");
}

export function serializeErrorForClient(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

export function recordClientChatMetric(metric: ChatRequestMetric) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const raw = window.localStorage.getItem(CHAT_TELEMETRY_STORAGE_KEY);
    const existing = raw ? (JSON.parse(raw) as ChatRequestMetric[]) : [];
    const next = [metric, ...existing].slice(0, TELEMETRY_LIMIT);
    window.localStorage.setItem(CHAT_TELEMETRY_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(CHAT_TELEMETRY_UPDATED_EVENT, { detail: metric }));
  } catch (error) {
    console.warn("[chat-telemetry] failed to persist metric", error);
  }
}

export function readClientChatMetrics() {
  if (typeof window === "undefined") {
    return [] as ChatRequestMetric[];
  }

  try {
    const raw = window.localStorage.getItem(CHAT_TELEMETRY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChatRequestMetric[]) : [];
  } catch (error) {
    console.warn("[chat-telemetry] failed to read metrics", error);
    return [] as ChatRequestMetric[];
  }
}
