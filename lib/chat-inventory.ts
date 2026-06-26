export type InventoryItem = {
  code: string;
  name: string;
  unit: string;
  currentStock: number;
};

export type InventoryChatResolution = {
  output: string;
  routeHint: string;
};

function normalizeInventoryText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\u0111/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatInventoryQuantity(value: number) {
  return value.toLocaleString("vi-VN", {
    maximumFractionDigits: 3,
  });
}

export function extractInventoryLookupTerms(prompt: string) {
  const normalized = normalizeInventoryText(prompt);
  const terms = new Set<string>();

  for (const phrase of [
    "dieu khien",
    "dieu hoa",
    "may lanh",
    "dan lanh",
    "dan nong",
    "bo chia gas",
  ]) {
    if (new RegExp(`\\b${phrase}\\b`).test(normalized)) {
      terms.add(phrase);
    }
  }

  for (const match of prompt.matchAll(/\b[A-Z0-9][A-Z0-9._-]{2,}\b/g)) {
    const term = normalizeInventoryText(match[0]);
    if (term.length >= 3) {
      terms.add(term);
    }
  }

  const stopWords = new Set([
    "am",
    "bao",
    "bao nhieu",
    "cac",
    "cho",
    "con",
    "co",
    "cua",
    "danh",
    "dem",
    "dieu",
    "duoi",
    "giup",
    "hang",
    "hang ton",
    "hien",
    "hien tai",
    "kho",
    "kho hang",
    "la",
    "liet",
    "loai",
    "ma",
    "mat",
    "mat hang",
    "may",
    "nguong",
    "nhap",
    "nhieu",
    "o",
    "san",
    "san pham",
    "so",
    "so luong",
    "theo",
    "toi",
    "ton",
    "ton kho",
    "trong",
    "tung",
    "xuat",
  ]);

  for (const rawWord of normalized.split(" ")) {
    const word = rawWord.replace(/[^a-z0-9]/g, "");
    if (word.length >= 4 && !stopWords.has(word) && !/^\d+$/.test(word)) {
      terms.add(word);
    }
  }

  return [...terms].filter((term) => !stopWords.has(term)).slice(0, 8);
}

function scoreInventoryItem(item: InventoryItem, terms: string[]) {
  const code = normalizeInventoryText(item.code);
  const name = normalizeInventoryText(item.name);
  const combined = `${code} ${name}`;

  return terms.reduce((score, term) => {
    if (code === term) {
      return score + 10;
    }
    if (code.includes(term)) {
      return score + 7;
    }
    if (name.includes(term)) {
      return score + (term.includes(" ") ? 5 : 3);
    }
    if (combined.includes(term)) {
      return score + 1;
    }
    return score;
  }, 0);
}

export function buildFilteredInventoryResolution(params: {
  prompt: string;
  inventory: InventoryItem[];
  year: number;
  month: number;
}): InventoryChatResolution | null {
  const terms = extractInventoryLookupTerms(params.prompt);
  if (terms.length === 0) {
    return null;
  }

  const normalized = normalizeInventoryText(params.prompt);
  const matches = params.inventory
    .map((item) => ({
      item,
      score: scoreInventoryItem(item, terms),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.item.currentStock - a.item.currentStock)
    .map((entry) => entry.item);

  if (matches.length === 0) {
    return {
      routeHint: "local_inventory_filter_not_found",
      output: [
        `Tôi đã tìm trong bảng inventory tháng ${params.month}/${params.year} nhưng chưa thấy mặt hàng/mã khớp: ${terms.join(", ")}.`,
        "Dữ liệu chắc chắn: bảng hiện có dim_product + inventory_month_opening + inventory_daily_movement.",
        "Dữ liệu thiếu: không có dòng sản phẩm khớp từ khóa trên, hoặc tên/mã hàng trong hệ thống khác cách gọi của bạn.",
        "Suy luận: cần gửi mã hàng/tên model chính xác hơn hoặc kiểm tra lại dữ liệu tồn kho đã được import đủ chưa.",
      ].join("\n"),
    };
  }

  const asksTypeCount = /\b(bao nhieu loai|may loai|co may loai|bao nhieu ma|so loai|so mat hang|dem)\b/.test(
    normalized,
  );
  const asksByWarehouse = /\b(tung kho|moi kho|theo kho|kho nao|o kho)\b/.test(normalized);
  const totalStock = matches.reduce((sum, item) => sum + item.currentStock, 0);
  const lines = matches.slice(0, 12).map((item, index) => {
    const code = item.code ? ` (${item.code})` : "";
    const unit = item.unit ? ` ${item.unit}` : "";
    return `${index + 1}. ${item.name}${code}: ${formatInventoryQuantity(item.currentStock)}${unit}`;
  });

  return {
    routeHint: "local_inventory_filtered",
    output: [
      `Tôi lọc tồn kho hiện tại theo từ khóa: ${terms.join(", ")}.`,
      asksTypeCount
        ? `Kết quả: có ${matches.length.toLocaleString("vi-VN")} mặt hàng/mã khớp; tổng tồn của nhóm này là ${formatInventoryQuantity(totalStock)} đơn vị.`
        : `Kết quả: tổng tồn của ${matches.length.toLocaleString("vi-VN")} mặt hàng/mã khớp là ${formatInventoryQuantity(totalStock)} đơn vị.`,
      "",
      "Các dòng khớp nhiều nhất:",
      ...lines,
      matches.length > lines.length ? `... còn ${matches.length - lines.length} dòng khớp khác.` : "",
      asksByWarehouse
        ? "Lưu ý: schema tồn kho hiện tại chưa có chiều kho/vị trí kho, nên tôi chỉ tính được tồn tổng theo sản phẩm, chưa tách được từng kho."
        : "",
      "",
      `Nguồn dữ liệu: dim_product + inventory_month_opening + inventory_daily_movement trong database production, tháng ${params.month}/${params.year}.`,
    ].filter(Boolean).join("\n"),
  };
}
