/**
 * Hàm helper để gọi Webhook của n8n
 * @param webhookPath Đường dẫn webhook (phần sau domain), ví dụ: 'new-job-report'
 * @param payload Dữ liệu JSON cần gửi sang n8n
 */
export async function triggerN8nWorkflow(webhookPath: string, payload: any) {
  // URL gốc của n8n (Lấy từ biến môi trường)
  const n8nHost = process.env.N8N_HOST;

  if (!n8nHost) {
    console.warn("N8N_HOST is not defined in .env. Skipping n8n trigger.");
    return;
  }

  // Ghép thành URL hoàn chỉnh: https://n8n.../webhook/new-job-report
  // Đảm bảo không bị duplicate dấu slash
  const baseUrl = n8nHost.endsWith('/') ? n8nHost.slice(0, -1) : n8nHost;
  const path = webhookPath.startsWith('/') ? webhookPath.slice(1) : webhookPath;
  const url = `${baseUrl}/webhook/${path}`;

  try {
    console.log(`[N8N Trigger] Sending data to ${url}`);

    // Gọi n8n (Fire and Forget - hoặc await tùy nhu cầu)
    // Ở đây tôi dùng await nhưng catch lỗi để không làm crash luồng chính
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Nếu n8n của bạn có set authentication header, thêm vào đây
        // "X-N8N-API-KEY": process.env.N8N_API_KEY 
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[N8N Error] Failed to trigger workflow: ${response.status} ${response.statusText}`);
    } else {
      console.log("[N8N Success] Workflow triggered successfully");
    }
  } catch (error) {
    console.error("[N8N Exception] Error calling n8n:", error);
  }
}


