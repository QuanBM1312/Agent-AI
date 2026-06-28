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

function normalizeBusinessText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\u0111/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function detectBusinessAnalysisPlan(prompt: string): BusinessAnalysisPlan | null {
  const normalized = normalizeBusinessText(prompt);
  if (!normalized) {
    return null;
  }

  const asksProfitLoss =
    /\b(lai lo|loi nhuan|dang lai|dang lo|lo nhat|lai nhat|doanh thu.*chi phi|chi phi.*doanh thu|quy\s*\d|quy gan nhat)\b/.test(
      normalized,
    );
  if (asksProfitLoss) {
    return {
      intent: "profit_loss",
      requiresMultipleSources: true,
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
      ]),
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
  }

  const asksContract =
    /\b(hop dong|quyet toan|hoan thanh.*chua quyet toan|chua quyet toan|cong no|thanh toan|nghiem thu)\b/.test(
      normalized,
    );
  if (asksContract) {
    return {
      intent: "contract_status",
      requiresMultipleSources: true,
      retrievalTerms: unique([
        "hop dong",
        "quyet toan",
        "thanh toan",
        "nghiem thu",
        "cong no",
        "saleadmin",
        "bao cao",
        "du an",
      ]),
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
  }

  const asksMultiSourceInventory =
    /\b(tung kho|moi kho|theo kho|o kho|nhap xuat ton|the kho|kiem ke|doi chieu.*kho|kho.*doi chieu|am kho|duoi nguong|nguong toi thieu|ton kho.*hom nay|cap nhat.*ton kho|lan cap nhat.*kho|bao cao.*kho|tong hop.*kho|phan tich.*kho|kho hang.*bao cao|kho hang.*tong hop)\b/.test(
      normalized,
    );
  if (asksMultiSourceInventory) {
    return {
      intent: "inventory_analysis",
      requiresMultipleSources: true,
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
      ]),
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
  }

  const asksProject =
    /\b(du an|cong trinh|tien do|deadline|tre deadline|hang muc|phu trach|da xong|chua xong|phan tram|khoi luong|du toan|thuc te)\b/.test(
      normalized,
    );
  if (asksProject) {
    return {
      intent: "project_progress",
      requiresMultipleSources: true,
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
      ]),
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
  }

  const asksRiskSummary =
    /\b(bao cao ngan|tong hop|rủi ro|rui ro|can.*can thiep|can thiep ngay|hom nay).*\b(tai chinh|ton kho|tien do|du an|rui ro|rủi ro)\b/.test(
      normalized,
    ) ||
    /\b(tai chinh|ton kho|tien do|rui ro|rủi ro)\b.*\b(tong hop|bao cao)\b/.test(normalized);
  if (asksRiskSummary) {
    return {
      intent: "risk_summary",
      requiresMultipleSources: true,
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
      ]),
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
  }

  return null;
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
