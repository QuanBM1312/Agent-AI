import { expect, test } from "playwright/test";

test("chat answers filtered inventory prompts and contextual follow-ups", async ({ page }) => {
  await page.goto("/chat");

  const result = await page.evaluate(async () => {
    async function ask(sessionId: string, prompt: string) {
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("type", "chat");
      formData.append("chatInput", prompt);
      formData.append("clientMessageId", crypto.randomUUID());

      const response = await fetch("/api/chat/n8n", {
        method: "POST",
        body: formData,
        headers: {
          "x-chat-request-id": crypto.randomUUID(),
        },
      });
      const body = await response.json();

      return {
        status: response.status,
        routeHint: response.headers.get("x-chat-route-hint") || body?._meta?.routeHint || null,
        output: String(body.output || body.text || body.message || body.error || ""),
      };
    }

    const sessionId = `inventory-filter-${crypto.randomUUID()}`;
    const filtered = await ask(sessionId, "Trong tồn kho điều khiển RBC có bao nhiêu loại?");
    const warehouse = await ask(sessionId, "Hàng điều khiển RBC còn tồn bao nhiêu ở từng kho?");
    const followUp = await ask(sessionId, "cái này đủ chưa?");

    return { filtered, warehouse, followUp };
  });

  expect(result.filtered.status).toBe(200);
  expect(result.filtered.routeHint).toBe("local_inventory_filtered");
  expect(result.filtered.output).toContain("RBC");
  expect(result.filtered.output).not.toContain("Tổng tồn hiện tại");

  expect(result.warehouse.status).toBe(200);
  expect(result.warehouse.routeHint).toBe("local_inventory_filtered");
  expect(result.warehouse.output).toContain("chưa có chiều kho");

  expect(result.followUp.status).toBe(200);
  expect(result.followUp.routeHint).toBe("local_followup_assessment");
  expect(result.followUp.output).toContain("chưa đủ");
  expect(result.followUp.output).toContain("kho/vị trí kho");
});
