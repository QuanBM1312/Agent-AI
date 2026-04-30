const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_HOST = "https://generativelanguage.googleapis.com";

export interface GeminiWebCitation {
  title: string;
  uri: string;
}

export interface GeminiWebSearchResult {
  output: string;
  citations: string[];
  groundingQueries: string[];
  webCitations: GeminiWebCitation[];
  model: string;
}

function readGeminiApiKeys() {
  const rawKeys = [
    process.env.GEMINI_API_KEYS,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(rawKeys));
}

function readTextPart(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((part) => {
      if (typeof part !== "object" || part === null) {
        return "";
      }

      const text = (part as Record<string, unknown>).text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizeCitation(citation: GeminiWebCitation) {
  return `${citation.title} — ${citation.uri}`;
}

function parseWebCitations(candidate: Record<string, unknown> | null) {
  const groundingMetadata =
    candidate && typeof candidate.groundingMetadata === "object"
      ? (candidate.groundingMetadata as Record<string, unknown>)
      : null;
  const groundingChunks = Array.isArray(groundingMetadata?.groundingChunks)
    ? groundingMetadata.groundingChunks
    : [];

  const citations: GeminiWebCitation[] = [];
  const seen = new Set<string>();

  for (const chunk of groundingChunks) {
    if (typeof chunk !== "object" || chunk === null) {
      continue;
    }

    const web =
      typeof (chunk as Record<string, unknown>).web === "object"
        ? ((chunk as Record<string, unknown>).web as Record<string, unknown>)
        : null;

    const uri = typeof web?.uri === "string" ? web.uri.trim() : "";
    const title = typeof web?.title === "string" ? web.title.trim() : "";

    if (!uri || !title || seen.has(uri)) {
      continue;
    }

    seen.add(uri);
    citations.push({ title, uri });
  }

  return {
    webCitations: citations,
    groundingQueries: Array.isArray(groundingMetadata?.webSearchQueries)
      ? groundingMetadata.webSearchQueries.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : [],
  };
}

export function isGeminiWebSearchConfigured() {
  return readGeminiApiKeys().length > 0;
}

export async function runGeminiWebSearch(prompt: string): Promise<GeminiWebSearchResult> {
  const apiKeys = readGeminiApiKeys();
  if (apiKeys.length === 0) {
    throw new Error("Gemini web search is not configured");
  }

  const model = process.env.GEMINI_WEB_MODEL || DEFAULT_GEMINI_MODEL;
  let lastError: Error | null = null;

  for (const apiKey of apiKeys) {
    const response = await fetch(
      `${GEMINI_API_HOST}/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text:
                  "Bạn là trợ lý cho người dùng nói tiếng Việt. Khi dùng Google Search grounding, chỉ trả lời điều có thể suy ra từ kết quả web đã ground. Nếu kết quả chưa đủ chắc chắn, nói rõ giới hạn và hỏi đúng một câu follow-up ngắn để người dùng thu hẹp yêu cầu. Không được giả vờ đó là dữ liệu nội bộ.",
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          tools: [
            {
              google_search: {},
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 800,
          },
        }),
      },
    );

    if (!response.ok) {
      const retryable = response.status === 401 || response.status === 403 || response.status === 429;
      lastError = new Error(`Gemini web search failed with status ${response.status}`);
      if (retryable) {
        continue;
      }
      throw lastError;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const candidate = Array.isArray(payload.candidates) && payload.candidates.length > 0
      ? (payload.candidates[0] as Record<string, unknown>)
      : null;

    const content =
      candidate && typeof candidate.content === "object"
        ? (candidate.content as Record<string, unknown>)
        : null;
    const output = readTextPart(content?.parts);

    if (!output) {
      lastError = new Error("Gemini web search returned no answer text");
      continue;
    }

    const { groundingQueries, webCitations } = parseWebCitations(candidate);

    return {
      output,
      citations: webCitations.map(normalizeCitation),
      groundingQueries,
      webCitations,
      model,
    };
  }

  throw lastError ?? new Error("Gemini web search failed without a usable API key");
}
