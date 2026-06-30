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
        webSearchUsed: body?._meta?.webSearchUsed === true,
      };
    }

    const sessionId = `inventory-filter-${crypto.randomUUID()}`;
    const filtered = await ask(sessionId, "Trong tồn kho điều khiển RBC có bao nhiêu loại?");
    const panasonic = await ask(sessionId, "Hàng panasonic trong kho có bao nhiêu loại?");
    const pananonicTypo = await ask(sessionId, "Hàng pananonic trong kho có bao nhiêu loại?");
    const followUp = await ask(sessionId, "cái này đủ chưa?");

    return { filtered, panasonic, pananonicTypo, followUp };
  });

  expect(result.filtered.status).toBe(200);
  expect(result.filtered.routeHint).toBe("local_inventory_filtered");
  expect(result.filtered.output).toContain("RBC");
  expect(result.filtered.output).not.toContain("Tổng tồn hiện tại");
  expect(result.filtered.webSearchUsed).toBe(false);

  expect(result.panasonic.status).toBe(200);
  expect(result.pananonicTypo.status).toBe(200);
  expect(result.panasonic.routeHint).toBe("local_inventory_filtered");
  expect(result.pananonicTypo.routeHint).toBe(result.panasonic.routeHint);
  expect(result.panasonic.output).toContain("Panasonic");
  expect(result.pananonicTypo.output).toContain("Panasonic");
  expect(result.panasonic.webSearchUsed).toBe(false);
  expect(result.pananonicTypo.webSearchUsed).toBe(false);

  expect(result.followUp.status).toBe(200);
  expect(result.followUp.routeHint).toBe("local_followup_assessment");
  expect(result.followUp.output).toContain("Dữ liệu thiếu");
  expect(result.followUp.output).toContain("kho/vị trí kho");
});
