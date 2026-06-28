import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildFilteredInventoryResolution,
  extractInventoryLookupTerms,
} from "./chat-inventory.ts";
import type { InventoryItem } from "./chat-inventory.ts";

const INVENTORY: InventoryItem[] = [
  {
    code: "H8BTDK0032",
    name: "Điều khiển RBC-AXU31-E",
    unit: "Cái",
    currentStock: 210,
  },
  {
    code: "H8BTDK0003",
    name: "Điều khiển nối dây RBC-AMTU31-E",
    unit: "Bộ",
    currentStock: 187,
  },
  {
    code: "H8ATDL0001",
    name: "Bộ chia gas dàn lạnh RBM-BY55E",
    unit: "Bộ",
    currentStock: 691,
  },
  {
    code: "H1AT322I03",
    name: "Điều hòa Toshiba RAS-18J2AVG-V",
    unit: "Bộ",
    currentStock: 195,
  },
  {
    code: "H9BTDK9999",
    name: "Điều khiển không dây",
    unit: "Bộ",
    currentStock: 999,
  },
];

test("inventory lookup extracts the actual product terms from a stock question", () => {
  assert.deepEqual(
    extractInventoryLookupTerms("Trong tồn kho điều khiển RBC có bao nhiêu loại?"),
    ["dieu khien", "rbc", "khien"],
  );
});

test("warehouse report wording does not become a product-name filter", () => {
  assert.deepEqual(
    extractInventoryLookupTerms("Tạo báo cáo kho hàng: tồn kho, nhập xuất tồn và rủi ro thiếu hàng."),
    [],
  );
});

test("filtered inventory answers product-family count instead of global stock summary", () => {
  const res = buildFilteredInventoryResolution({
    prompt: "Trong tồn kho điều khiển RBC có bao nhiêu loại?",
    inventory: INVENTORY,
    year: 2026,
    month: 6,
  });

  assert.ok(res);
  assert.equal(res.routeHint, "local_inventory_filtered");
  assert.match(res.output, /có 2 mặt hàng\/mã khớp/);
  assert.match(res.output, /tổng tồn của nhóm này là 397/);
  assert.match(res.output, /Điều khiển RBC-AXU31-E/);
  assert.match(res.output, /Điều khiển nối dây RBC-AMTU31-E/);
  assert.doesNotMatch(res.output, /Bộ chia gas/);
  assert.doesNotMatch(res.output, /Điều khiển không dây/);
  assert.doesNotMatch(res.output, /Tổng tồn hiện tại/);
});

test("filtered inventory is honest when the user asks per-warehouse but schema lacks warehouse", () => {
  const res = buildFilteredInventoryResolution({
    prompt: "Hàng điều khiển RBC còn tồn bao nhiêu ở từng kho?",
    inventory: INVENTORY,
    year: 2026,
    month: 6,
  });

  assert.ok(res);
  assert.match(res.output, /chưa có chiều kho\/vị trí kho/);
  assert.match(res.output, /chỉ tính được tồn tổng theo sản phẩm/);
});

test("unknown inventory item returns an explicit no-match answer", () => {
  const res = buildFilteredInventoryResolution({
    prompt: "Mã KHONGCOTHAT999 còn tồn bao nhiêu?",
    inventory: INVENTORY,
    year: 2026,
    month: 6,
  });

  assert.ok(res);
  assert.equal(res.routeHint, "local_inventory_filter_not_found");
  assert.match(res.output, /chưa thấy mặt hàng\/mã khớp/);
});
