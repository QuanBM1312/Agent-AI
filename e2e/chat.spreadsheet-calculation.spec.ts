import { expect, test } from "playwright/test";
import { ensureChatReady, getChatSessionIdFromUrl } from "./support/auth";

test("chat calculates an attached spreadsheet before falling back to n8n", async ({ page }) => {
  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  await ensureChatReady(page);

  const sessionId = getChatSessionIdFromUrl(page);
  const result = await page.evaluate(async (activeSessionId) => {
    const formData = new FormData();
    formData.append("sessionId", activeSessionId);
    formData.append("type", "chat");
    formData.append("chatInput", "tính lãi lỗ trong file Excel này");
    formData.append("clientMessageId", crypto.randomUUID());
    formData.append(
      "file",
      new File(
        [
          [
            "Khách hàng,Doanh thu,Giá vốn",
            "A,1000000,700000",
            "B,2500000,1000000",
          ].join("\n"),
        ],
        "lai-lo-smoke.csv",
        { type: "text/csv" },
      ),
    );

    const response = await fetch("/api/chat/n8n", {
      method: "POST",
      body: formData,
      headers: { accept: "application/json" },
    });
    const body = await response.json().catch(() => null);

    return {
      status: response.status,
      routeHint: response.headers.get("x-chat-route-hint"),
      output: typeof body?.output === "string" ? body.output : "",
      webSearchUsed: body?._meta?.webSearchUsed === true,
    };
  }, sessionId);

  expect(result.status).toBe(200);
  expect(result.routeHint).toBe("spreadsheet_calculation");
  expect(result.output).toContain("Lãi/lỗ = Doanh thu - Chi phí");
  expect(result.output).toContain("1.800.000");
  expect(result.webSearchUsed).toBe(false);

  const missingCost = await page.evaluate(async (activeSessionId) => {
    const formData = new FormData();
    formData.append("sessionId", activeSessionId);
    formData.append("type", "chat");
    formData.append("chatInput", "tính lãi lỗ trong file Excel này");
    formData.append("clientMessageId", crypto.randomUUID());
    formData.append(
      "file",
      new File(
        [
          [
            "Khách hàng,Doanh thu",
            "A,1000000",
            "B,2500000",
          ].join("\n"),
        ],
        "lai-lo-thieu-chi-phi.csv",
        { type: "text/csv" },
      ),
    );

    const response = await fetch("/api/chat/n8n", {
      method: "POST",
      body: formData,
      headers: { accept: "application/json" },
    });
    const body = await response.json().catch(() => null);

    return {
      status: response.status,
      routeHint: response.headers.get("x-chat-route-hint"),
      output: typeof body?.output === "string" ? body.output : "",
      webSearchUsed: body?._meta?.webSearchUsed === true,
    };
  }, sessionId);

  expect(missingCost.status).toBe(200);
  expect(missingCost.routeHint).toBe("spreadsheet_calculation_needs_columns");
  expect(missingCost.output).toContain("Doanh thu");
  expect(missingCost.output).toContain("Giá vốn");
  expect(missingCost.output).not.toContain("1.800.000");
  expect(missingCost.webSearchUsed).toBe(false);
});
