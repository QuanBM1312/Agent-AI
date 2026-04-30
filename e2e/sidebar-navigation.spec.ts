import { expect, test } from "playwright/test";
import { ensureChatReady } from "./support/auth";

const adminTabs = [
  {
    label: "Nạp Tri thức",
    path: "/knowledge",
    readyText: /Cổng Nạp Tri thức/i,
  },
  {
    label: "Lịch hẹn",
    path: "/scheduling",
    readyText: /Đã phân công/i,
  },
  {
    label: "Báo cáo",
    path: "/reports",
    readyText: /Quản lý Báo cáo/i,
  },
  {
    label: "Tồn kho",
    path: "/storage",
    readyText: /Quản lý Tồn kho/i,
  },
  {
    label: "Khách hàng",
    path: "/customers",
    readyText: /Quản lý Khách hàng/i,
  },
  {
    label: "Nhân sự",
    path: "/users",
    readyText: /Quản lý Nhân sự/i,
  },
] as const;

test("sidebar shows expected admin items and can route back to chat", async ({ page }) => {
  await page.goto("/chat", { waitUntil: "domcontentloaded" });
  await ensureChatReady(page);

  await expect(page.getByRole("button", { name: /Trợ lý AI/i })).toBeVisible();

  for (const tab of adminTabs) {
    await expect(page.getByRole("button", { name: new RegExp(tab.label, "i") })).toBeVisible();
  }

  await page.getByRole("button", { name: /Nạp Tri thức/i }).click();
  await page.waitForURL(/\/knowledge(\/|$)/, { timeout: 30_000 });
  await expect(page.getByText(/Cổng Nạp Tri thức/i)).toBeVisible();
  await expect(page.getByText(/Nguồn dữ liệu kết nối/i)).toBeVisible();

  await page.getByRole("button", { name: /Trợ lý AI/i }).click();
  await page.waitForURL(/\/chat\/[^/]+$/, { timeout: 30_000 });
  await ensureChatReady(page);

  for (const tab of adminTabs.slice(1)) {
    await page.getByRole("button", { name: new RegExp(tab.label, "i") }).click();
    await page.waitForURL(new RegExp(`${tab.path}(\\/|$)`), { timeout: 30_000 });
    await expect(page.getByText(tab.readyText).first()).toBeVisible();
  }
});
