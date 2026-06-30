import { expect, test, type Page } from "playwright/test";
import { ensureChatReady } from "./support/auth";

async function askThroughUi(page: Page, prompt: string) {
  const input = page.getByPlaceholder("Nhập tin nhắn...");

  await input.waitFor({ state: "visible", timeout: 60_000 });
  await input.fill(prompt);
  await input.press("Enter");

  await expect(page.getByText(prompt, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

test("chat UI renders complex business answers from grounded routes", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  await ensureChatReady(page);

  await askThroughUi(page, "Hàng điều khiển RBC còn tồn bao nhiêu ở từng kho?");
  await expect(page.getByText("chưa có chiều kho/vị trí kho").last()).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByText("RBC-AXU31-E").last()).toBeVisible({
    timeout: 15_000,
  });

  await askThroughUi(page, "Tạo báo cáo kho hàng: tồn kho, nhập xuất tồn và rủi ro thiếu hàng.");
  await expect(page.getByText("Tổng tồn hiện tại").last()).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByText("Không thấy mặt hàng âm kho").last()).toBeVisible({
    timeout: 15_000,
  });

  await askThroughUi(page, "Quý gần nhất công ty đang lời hay lỗ? Nêu công thức và nguồn dữ liệu.");
  await expect(page.getByText(/không thể .*lời hay lỗ/i).last()).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByText("Doanh thu thực tế").last()).toBeVisible({
    timeout: 15_000,
  });

  await askThroughUi(page, "Giá nội bộ hàng Toshiba là bao nhiêu? Không dùng giá thị trường.");
  await expect(page.getByText(/không trả giá lấy từ web/i).last()).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByText(/dữ liệu nội bộ/i).last()).toBeVisible({
    timeout: 15_000,
  });
});
