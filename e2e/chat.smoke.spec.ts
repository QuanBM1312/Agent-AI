import { expect, test } from "playwright/test";
import { ensureChatReady, getChatSessionIdFromUrl } from "./support/auth";

test("chat can send a prompt and persist the assistant response", async ({ page }) => {
  const promptToken = `E2E_OK_${Date.now()}`;
  const prompt = `Đây là smoke test E2E. Chỉ trả lời đúng chuỗi sau: ${promptToken}`;

  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  await ensureChatReady(page);

  const input = page.getByPlaceholder("Nhập tin nhắn...");
  await input.fill(prompt);
  await input.press("Enter");

  await expect(page.getByText(prompt, { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  const sessionId = getChatSessionIdFromUrl(page);

  await expect
    .poll(
      async () =>
        page.evaluate(async ({ activeSessionId, expectedToken }) => {
          const response = await fetch(
            `/api/chat/messages?session_id=${activeSessionId}`,
            { headers: { accept: "application/json" } },
          );

          if (!response.ok) {
            return {
              ok: false,
              status: response.status,
              matched: false,
            };
          }

          const body = await response.json().catch(() => null);
          const assistantMessages = Array.isArray(body?.data)
            ? body.data.filter((message: { role?: string }) => message.role === "assistant")
            : [];

          const matched = assistantMessages.some((message: { content?: string }) =>
            typeof message.content === "string" && message.content.includes(expectedToken),
          );

          return {
            ok: true,
            status: response.status,
            matched,
          };
        }, { activeSessionId: sessionId, expectedToken: promptToken }),
      {
        timeout: 120_000,
        intervals: [1_000, 2_000, 5_000],
        message: "assistant response should be persisted for the active chat session",
      },
    )
    .toMatchObject({
      ok: true,
      status: 200,
      matched: true,
    });

  await expect(page.getByText(promptToken).last()).toBeVisible({
    timeout: 15_000,
  });
});
