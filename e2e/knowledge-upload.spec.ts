import { expect, test } from "playwright/test";

type KnowledgeSource = {
  id?: string;
  drive_name?: string | null;
};

test("knowledge upload reaches Drive metadata and reports ingestion status", async ({ page }) => {
  const fileName = `upload-probe-e2e-${Date.now()}.csv`;
  let uploadError: string | null = null;
  page.on("dialog", async (dialog) => {
    uploadError = dialog.message();
    await dialog.accept();
  });

  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Cổng Nạp Tri thức/i)).toBeVisible();

  const initialProbe = await page.evaluate(async () => {
    const response = await fetch("/api/knowledge/sources?type=document&page=1&limit=5", {
      headers: { accept: "application/json" },
    });
    return { status: response.status, ok: response.ok };
  });
  expect(initialProbe).toMatchObject({ status: 200, ok: true });

  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from("Mã hàng,Tên sản phẩm,Đơn giá\nE2E001,Sản phẩm E2E,123000\n"),
  });

  await expect
    .poll(
      async () => {
        if (uploadError) {
          return "error";
        }
        const noticeVisible = await page
          .getByText(new RegExp(`Đã upload "${fileName}" lên Drive`))
          .isVisible()
          .catch(() => false);
        return noticeVisible ? "success" : "pending";
      },
      {
        timeout: 45_000,
        intervals: [500, 1_000, 2_000],
      },
    )
    .not.toBe("pending");

  if (uploadError) {
    expect(uploadError).toMatch(/Google Drive|service account|Editor|OAuth|re-auth/i);
    expect(uploadError).not.toMatch(/^Có lỗi xảy ra: invalid_grant$/i);
    return;
  }

  await expect
    .poll(
      async () =>
        page.evaluate(async (expectedName) => {
          const response = await fetch("/api/knowledge/sources?type=document&page=1&limit=50", {
            headers: { accept: "application/json" },
          });
          const body = await response.json().catch(() => null);
          const item = Array.isArray(body?.data)
            ? (body.data as KnowledgeSource[]).find((source) => source.drive_name === expectedName)
            : null;
          return item ? { id: item.id, name: item.drive_name } : null;
        }, fileName),
      {
        timeout: 30_000,
        intervals: [1_000, 2_000, 5_000],
      },
    )
    .not.toBeNull();

  const uploadedItem = await page.evaluate(async (expectedName) => {
    const response = await fetch("/api/knowledge/sources?type=document&page=1&limit=50", {
      headers: { accept: "application/json" },
    });
    const body = await response.json();
    return (body.data as KnowledgeSource[]).find((source) => source.drive_name === expectedName) || null;
  }, fileName);
  expect(uploadedItem?.id).toBeTruthy();

  const cleanup = await page.evaluate(async (id) => {
    const response = await fetch(`/api/knowledge/sources?id=${encodeURIComponent(String(id))}`, {
      method: "DELETE",
      headers: { accept: "application/json" },
    });
    return { status: response.status, ok: response.ok };
  }, uploadedItem?.id);
  expect(cleanup.ok).toBe(true);
});
