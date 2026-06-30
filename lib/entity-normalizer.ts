export type EntityKind =
  | "brand"
  | "product_type"
  | "model"
  | "product_code"
  | "warehouse_signal"
  | "time_period"
  | "project"
  | "contract";

export type EntityMention = {
  kind: EntityKind;
  raw: string;
  normalized: string;
  confidence: "low" | "medium" | "high";
};

export const BUSINESS_BRANDS = [
  "toshiba",
  "carrier",
  "daikin",
  "midea",
  "lg",
  "panasonic",
  "mitsubishi",
];

const BRAND_ALIASES = new Map<string, string>([
  ["tosiba", "toshiba"],
  ["pananonic", "panasonic"],
  ["mitsubisi", "mitsubishi"],
]);

const PRODUCT_TYPE_SYNONYMS: Array<{ canonical: string; phrases: string[] }> = [
  { canonical: "dieu hoa", phrases: ["dieu hoa", "may lanh"] },
  { canonical: "dieu khien", phrases: ["dieu khien"] },
  { canonical: "dan lanh", phrases: ["dan lanh"] },
  { canonical: "dan nong", phrases: ["dan nong"] },
  { canonical: "bo chia gas", phrases: ["bo chia gas"] },
];

const WAREHOUSE_SIGNALS = [
  "ton kho",
  "kho hang",
  "trong kho",
  "tung kho",
  "moi kho",
  "theo kho",
  "o kho",
  "kho nao",
  "nhap xuat ton",
  "am kho",
  "duoi nguong",
  "nguong toi thieu",
];

const TIME_PERIOD_PATTERNS = [
  /\bquy gan nhat\b/g,
  /\bquy\s*\d+\b/g,
  /\bthang\s*\d{1,2}\b/g,
  /\bnam\s*\d{4}\b/g,
  /\b(hom nay|hien tai|gan nhat|thang nay|nam nay)\b/g,
];

export function normalizeBusinessText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\u0111/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(left: string, right: string) {
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));

  for (let i = 0; i <= left.length; i += 1) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= right.length; j += 1) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + substitutionCost,
      );
    }
  }

  return dp[left.length][right.length];
}

export function canonicalizeBrand(term: string) {
  const normalized = normalizeBusinessText(term).replace(/[^a-z0-9]/g, "");
  if (!normalized) {
    return normalized;
  }

  const alias = BRAND_ALIASES.get(normalized);
  if (alias) {
    return alias;
  }

  if (BUSINESS_BRANDS.includes(normalized)) {
    return normalized;
  }

  for (const brand of BUSINESS_BRANDS) {
    if (brand.length <= 3) {
      continue;
    }

    const maxDistance = brand.length >= 8 ? 2 : 1;
    if (
      Math.abs(normalized.length - brand.length) <= maxDistance &&
      editDistance(normalized, brand) <= maxDistance
    ) {
      return brand;
    }
  }

  return normalized;
}

function pushUnique(entities: EntityMention[], mention: EntityMention) {
  if (
    entities.some(
      (entity) =>
        entity.kind === mention.kind &&
        entity.normalized === mention.normalized &&
        normalizeBusinessText(entity.raw) === normalizeBusinessText(mention.raw),
    )
  ) {
    return;
  }

  entities.push(mention);
}

function findRawPhrase(prompt: string, normalizedPrompt: string, normalizedPhrase: string) {
  const normalizedWords = normalizedPrompt.split(" ");
  const phraseWords = normalizedPhrase.split(" ");

  for (let i = 0; i <= normalizedWords.length - phraseWords.length; i += 1) {
    if (phraseWords.every((word, offset) => normalizedWords[i + offset] === word)) {
      return prompt.split(/\s+/).slice(i, i + phraseWords.length).join(" ");
    }
  }

  return normalizedPhrase;
}

function addPhraseEntities(params: {
  prompt: string;
  normalized: string;
  entities: EntityMention[];
}) {
  for (const productType of PRODUCT_TYPE_SYNONYMS) {
    for (const phrase of productType.phrases) {
      if (new RegExp(`\\b${phrase}\\b`).test(params.normalized)) {
        pushUnique(params.entities, {
          kind: "product_type",
          raw: findRawPhrase(params.prompt, params.normalized, phrase),
          normalized: productType.canonical,
          confidence: "high",
        });
      }
    }
  }

  for (const phrase of WAREHOUSE_SIGNALS) {
    if (new RegExp(`\\b${phrase}\\b`).test(params.normalized)) {
      pushUnique(params.entities, {
        kind: "warehouse_signal",
        raw: findRawPhrase(params.prompt, params.normalized, phrase),
        normalized: phrase,
        confidence: "high",
      });
    }
  }

  if (/\b(du an|cong trinh|tien do|hang muc)\b/.test(params.normalized)) {
    pushUnique(params.entities, {
      kind: "project",
      raw: "du an",
      normalized: "du an",
      confidence: "medium",
    });
  }

  if (/\b(hop dong|quyet toan|nghiem thu|thanh toan|cong no)\b/.test(params.normalized)) {
    pushUnique(params.entities, {
      kind: "contract",
      raw: "hop dong",
      normalized: "hop dong",
      confidence: "medium",
    });
  }

  for (const pattern of TIME_PERIOD_PATTERNS) {
    for (const match of params.normalized.matchAll(pattern)) {
      pushUnique(params.entities, {
        kind: "time_period",
        raw: match[0],
        normalized: match[0],
        confidence: "high",
      });
    }
  }
}

function addCodeAndModelEntities(prompt: string, entities: EntityMention[]) {
  for (const match of prompt.matchAll(/\b[A-Z0-9][A-Z0-9._-]{2,}\b/g)) {
    const raw = match[0];
    const normalized = normalizeBusinessText(raw);
    const compact = raw.replace(/[-._]/g, "");
    const kind: EntityKind =
      /^[A-Z]\d[A-Z0-9]{5,}$/.test(compact) && !raw.includes("-")
        ? "product_code"
        : "model";

    pushUnique(entities, {
      kind,
      raw,
      normalized,
      confidence: "high",
    });
  }
}

function addBrandEntities(normalized: string, entities: EntityMention[]) {
  for (const rawWord of normalized.split(" ")) {
    const word = rawWord.replace(/[^a-z0-9]/g, "");
    if (word.length < 2) {
      continue;
    }

    const canonical = canonicalizeBrand(word);
    if (BUSINESS_BRANDS.includes(canonical) && (canonical === word || word.length >= 5)) {
      pushUnique(entities, {
        kind: "brand",
        raw: word,
        normalized: canonical,
        confidence: canonical === word ? "high" : "medium",
      });
    }
  }
}

function addShortModelEntities(normalized: string, entities: EntityMention[]) {
  for (const token of ["rbc", "rbm", "ras"]) {
    if (new RegExp(`\\b${token}\\b`).test(normalized)) {
      pushUnique(entities, {
        kind: "model",
        raw: token,
        normalized: token,
        confidence: "medium",
      });
    }
  }
}

export function extractEntities(prompt: string): EntityMention[] {
  const normalized = normalizeBusinessText(prompt);
  if (!normalized) {
    return [];
  }

  const entities: EntityMention[] = [];
  addPhraseEntities({ prompt, normalized, entities });
  addCodeAndModelEntities(prompt, entities);
  addBrandEntities(normalized, entities);
  addShortModelEntities(normalized, entities);

  return entities;
}
