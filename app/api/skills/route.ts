import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";
import { isGeminiWebSearchConfigured } from "@/lib/gemini-web-search";
import { isGroqTranscriptionConfigured } from "@/lib/groq-transcription";

type SkillStatus = "ready" | "partial" | "blocked";

type CountRow = {
  count: number | bigint | null;
};

async function countRows(table: string, where = "") {
  const result = await prisma.$queryRawUnsafe<CountRow[]>(
    `SELECT COUNT(*)::int AS count FROM public.${table} ${where}`,
  );

  return Number(result[0]?.count || 0);
}

function statusLabel(status: SkillStatus) {
  if (status === "ready") return "Sẵn sàng";
  if (status === "partial") return "Cần kiểm tra";
  return "Đang thiếu cấu hình";
}

export async function GET() {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [fileSearchCount, sourceCount, excelSourceCount, customerCount, jobCount] =
      await Promise.all([
        countRows("file_search_storage"),
        countRows("knowledge_sources"),
        countRows(
          "knowledge_sources",
          "WHERE UPPER(COALESCE(sheet_name, '')) IN ('XLS', 'XLSX', 'CSV') OR LOWER(COALESCE(drive_name, '')) ~ '\\.(xls|xlsx|csv)( \\(|$)'",
        ),
        countRows("customers"),
        countRows("jobs"),
      ]);

    const n8nConfigured = Boolean(process.env.N8N_MAIN_RAG_WEBHOOK_URL?.trim());
    const uploadConfigured = Boolean(
      process.env.N8N_INGESTION_WEBHOOK_URL?.trim() &&
        (process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ||
          process.env.GDRIVE_JSON?.trim() ||
          process.env.GOOGLE_SERVICE_ACCOUNT_BASE64?.trim() ||
          (process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
            process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() &&
            process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim())),
    );

    const structuredDataReady = customerCount > 0 || jobCount > 0;

    const skills = [
      {
        id: "internal_knowledge_search",
        name: "Tra tài liệu nội bộ",
        status: fileSearchCount > 0 || sourceCount > 0 ? "ready" : "blocked",
        statusLabel: statusLabel(fileSearchCount > 0 || sourceCount > 0 ? "ready" : "blocked"),
        description: "Tìm và tóm tắt tài liệu đã nạp vào kho tri thức.",
        evidence: `${fileSearchCount} tài liệu searchable, ${sourceCount} nguồn metadata`,
      },
      {
        id: "excel_calculation",
        name: "Tính toán từ Excel",
        status: "ready",
        statusLabel: statusLabel("ready"),
        description: "Tính nhanh file CSV/XLS/XLSX đính kèm khi hỏi lãi/lỗ, tổng doanh thu, tồn kho hoặc bảng số liệu.",
        evidence:
          excelSourceCount > 0
            ? `${excelSourceCount} nguồn Excel/CSV đã có metadata; file đính kèm có thể tính trực tiếp, file trong kho cần raw workbook để tính deterministic`
            : "File đính kèm CSV/XLS/XLSX có thể tính trực tiếp; chưa thấy nguồn Excel/CSV trong metadata",
      },
      {
        id: "structured_ops_lookup",
        name: "Tra dữ liệu vận hành",
        status: structuredDataReady ? "ready" : "partial",
        statusLabel: statusLabel(structuredDataReady ? "ready" : "partial"),
        description: "Tra khách hàng, dự án, job, lịch, tồn kho khi DB nghiệp vụ có dữ liệu.",
        evidence: `${customerCount} khách hàng, ${jobCount} job`,
      },
      {
        id: "voice_transcription",
        name: "Nhận diện giọng nói",
        status: isGroqTranscriptionConfigured() ? "ready" : "blocked",
        statusLabel: statusLabel(isGroqTranscriptionConfigured() ? "ready" : "blocked"),
        description: "Chuyển voice thành transcript trước khi gửi vào tuyến chat.",
        evidence: isGroqTranscriptionConfigured() ? "Groq transcription configured" : "Thiếu GROQ_API_KEY",
      },
      {
        id: "web_search",
        name: "Tìm web có grounding",
        status: isGeminiWebSearchConfigured() ? "ready" : "blocked",
        statusLabel: statusLabel(isGeminiWebSearchConfigured() ? "ready" : "blocked"),
        description: "Dùng cho câu hỏi ngoài hệ thống hoặc thông tin mới.",
        evidence: isGeminiWebSearchConfigured() ? "Gemini web search configured" : "Thiếu GEMINI_API_KEYS",
      },
      {
        id: "n8n_agent0",
        name: "Agent0 chuyên sâu",
        status: n8nConfigured ? "ready" : "blocked",
        statusLabel: statusLabel(n8nConfigured ? "ready" : "blocked"),
        description: "Tuyến n8n/Agent0 cho câu hỏi cần xử lý sâu hơn.",
        evidence: n8nConfigured ? "N8N_MAIN_RAG_WEBHOOK_URL configured" : "Thiếu n8n webhook",
      },
      {
        id: "knowledge_ingestion",
        name: "Nạp tri thức",
        status: uploadConfigured ? "ready" : "partial",
        statusLabel: statusLabel(uploadConfigured ? "ready" : "partial"),
        description: "Upload tài liệu, URL, Drive source vào kho tri thức.",
        evidence: uploadConfigured ? "Drive/n8n upload configured" : "Upload UI có thể cần bypass hoặc sửa credential Drive",
      },
    ];

    return NextResponse.json({ data: skills });
  } catch (error) {
    console.error("Failed to load skills:", error);
    return NextResponse.json({ error: "Failed to load skills" }, { status: 500 });
  }
}
