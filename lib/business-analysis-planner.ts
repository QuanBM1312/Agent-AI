import { buildQueryPlan } from "./query-planner.ts";
import type { QueryPlan } from "./query-planner.ts";

export type BusinessAnalysisIntent =
  | "profit_loss"
  | "contract_status"
  | "inventory_analysis"
  | "project_progress"
  | "risk_summary";

export type BusinessAnalysisPlan = {
  intent: BusinessAnalysisIntent;
  requiresMultipleSources: boolean;
  retrievalTerms: string[];
  requiredSources: string[];
  candidateLimit: number;
  rawFileLimit: number;
  answerContract: string[];
};

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function businessPlanFromQueryPlan(plan: QueryPlan): BusinessAnalysisPlan | null {
  switch (plan.intent) {
    case "profit_loss":
      return {
        intent: "profit_loss",
        requiresMultipleSources: plan.requiresMultipleSources,
        retrievalTerms: plan.retrievalTerms,
        requiredSources: [
          "Doanh thu hoặc giá trị hợp đồng theo kỳ/quý",
          "Chi phí/giá vốn/vật tư/nhân công liên quan",
          "Thông tin nghiệm thu/thanh toán/quyết toán nếu câu hỏi theo hợp đồng",
        ],
        candidateLimit: 18,
        rawFileLimit: 5,
        answerContract: [
          "Không kết luận lãi nếu thiếu chi phí/giá vốn.",
          "Nêu công thức lãi/lỗ = doanh thu đã xác minh - chi phí đã xác minh.",
          "Tách dữ liệu chắc chắn, dữ liệu thiếu và suy luận.",
        ],
      };
    case "contract_status":
      return {
        intent: "contract_status",
        requiresMultipleSources: plan.requiresMultipleSources,
        retrievalTerms: plan.retrievalTerms,
        requiredSources: [
          "Danh sách hợp đồng/dự án",
          "Trạng thái hoàn thành/nghiệm thu",
          "Dữ liệu thanh toán/quyết toán/công nợ",
        ],
        candidateLimit: 16,
        rawFileLimit: 4,
        answerContract: [
          "Không gọi hợp đồng là chưa quyết toán nếu thiếu nguồn thanh toán/quyết toán.",
          "Nêu rõ file/sheet/cột dùng để xác định hoàn thành và quyết toán.",
        ],
      };
    case "inventory_analysis":
      return {
        intent: "inventory_analysis",
        requiresMultipleSources: plan.requiresMultipleSources,
        retrievalTerms: plan.retrievalTerms,
        requiredSources: [
          "Tồn đầu kỳ hoặc tồn hiện tại theo mã hàng",
          "Nhập/xuất trong kỳ nếu câu hỏi cần công thức tồn",
          "Vị trí kho/warehouse nếu người dùng hỏi từng kho",
          "Ngưỡng tối thiểu hoặc dữ liệu kiểm kê nếu hỏi âm kho/dưới ngưỡng",
        ],
        candidateLimit: 18,
        rawFileLimit: 5,
        answerContract: [
          "Ưu tiên tìm file kho/nhập-xuất-tồn trước khi kết luận không có dữ liệu từng kho.",
          "Nếu nguồn chỉ có tồn tổng, nói rõ chưa có chiều kho/vị trí kho.",
          "Nêu công thức tồn = tồn đầu + nhập - xuất khi có đủ cột.",
        ],
      };
    case "project_progress":
      return {
        intent: "project_progress",
        requiresMultipleSources: plan.requiresMultipleSources,
        retrievalTerms: plan.retrievalTerms,
        requiredSources: [
          "Danh sách hạng mục/dự án",
          "Tiến độ hoặc % hoàn thành",
          "Deadline/kế hoạch",
          "Người phụ trách và báo cáo cập nhật gần nhất",
        ],
        candidateLimit: 16,
        rawFileLimit: 4,
        answerContract: [
          "Không kết luận nguyên nhân trễ nếu không có báo cáo/hạng mục còn mở.",
          "Nếu có % hoàn thành, nêu cách tính %.",
          "Nêu dữ liệu thiếu nếu thiếu deadline hoặc lần cập nhật cuối.",
        ],
      };
    case "risk_summary":
      return {
        intent: "risk_summary",
        requiresMultipleSources: plan.requiresMultipleSources,
        retrievalTerms: plan.retrievalTerms,
        requiredSources: [
          "Tài chính/doanh thu/chi phí",
          "Tồn kho và cảnh báo thiếu/âm kho",
          "Tiến độ dự án/deadline",
          "Báo cáo rủi ro hoặc cập nhật gần nhất",
        ],
        candidateLimit: 20,
        rawFileLimit: 5,
        answerContract: [
          "Tạo báo cáo theo nhóm: tài chính, tồn kho, tiến độ, rủi ro.",
          "Mỗi nhóm phải tách chắc chắn/thiếu/suy luận.",
          "Không bịa số nếu thiếu nguồn.",
        ],
      };
    default:
      return null;
  }
}

export function detectBusinessAnalysisPlan(prompt: string): BusinessAnalysisPlan | null {
  const plan = businessPlanFromQueryPlan(buildQueryPlan(prompt));
  if (!plan) {
    return null;
  }

  return {
    ...plan,
    retrievalTerms: unique(plan.retrievalTerms),
  };
}

export function buildBusinessAnalysisContext(plan: BusinessAnalysisPlan | null) {
  if (!plan) {
    return "";
  }

  return [
    "[BUSINESS_ANALYSIS_PLAN_BEGIN]",
    `intent="${plan.intent}"`,
    `requires_multiple_sources="${String(plan.requiresMultipleSources)}"`,
    "Required source categories:",
    ...plan.requiredSources.map((source, index) => `${index + 1}. ${source}`),
    "Answer contract:",
    ...plan.answerContract.map((rule, index) => `${index + 1}. ${rule}`),
    "Retrieval terms:",
    plan.retrievalTerms.join(", "),
    "[BUSINESS_ANALYSIS_PLAN_END]",
  ].join("\n");
}
