import { NextRequest, NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";
import {
  buildChatStagePlan,
  ChatRequestKind,
  createServerTimingHeader,
  inferRouteHint,
  serializeErrorForClient,
} from "@/lib/chat-observability";
import { isTenantDatabaseBoundaryError } from "@/lib/db-runtime";
import {
  isGeminiWebSearchConfigured,
  runGeminiWebSearch,
} from "@/lib/gemini-web-search";
import { getSupabaseAdmin } from "@/lib/supabase";

const N8N_TIMEOUT_MS = 25_000;

interface LocalChatResolution {
  output: string;
  routeHint: string;
  citations?: string[];
}

type RequestResolutionMeta = Record<string, unknown> & {
  webSearchPendingPrompt?: string;
  webSearchUsed?: boolean;
  webSearchProvider?: string;
  webSearchQueries?: string[];
  webSearchModel?: string;
};

function normalizeIntentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isGreetingPrompt(value: string) {
  const normalized = normalizeIntentText(value);
  if (!normalized) {
    return false;
  }

  const hasGreeting = /^(xin chao|chao ban|chao|hello|hi|hey|alo)\b/.test(normalized);
  const asksForHelp = /\b(giup gi|ho tro|co the giup|can giup)\b/.test(normalized);
  const hasSpecificTask = /\b(tom tat|du an|serial|quy dinh|tai lieu|bao nhieu|ai phu trach|file|dinh kem|upload|hinh anh|giong noi|khach hang|noi bo)\b/.test(
    normalized
  );

  return (hasGreeting || asksForHelp) && !hasSpecificTask && normalized.length <= 120;
}

function isAttachmentSummaryRequest(value: string, hasInlineText: boolean) {
  if (!hasInlineText) {
    return false;
  }

  const normalized = normalizeIntentText(value);
  return /\b(doc|tom tat|tom luoc|y chinh|rut gon|file|dinh kem)\b/.test(normalized);
}

function buildAttachmentSummary(text: string): string {
  const lineCandidates = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 24);
  const sentenceCandidates = text
    .replace(/\r?\n+/g, " ")
    .split(/[.!?]\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24);
  const candidates = [...lineCandidates, ...sentenceCandidates];
  const unique: string[] = [];

  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (unique.some((item) => item.toLowerCase() === normalized)) {
      continue;
    }

    unique.push(candidate.replace(/\s+/g, " ").slice(0, 220));

    if (unique.length === 3) {
      break;
    }
  }

  if (unique.length === 0) {
    return "Tôi đã đọc file đính kèm, nhưng phần văn bản khả dụng quá ngắn để tóm tắt đáng tin cậy.";
  }

  return [
    "Tôi đã đọc phần văn bản trong file đính kèm. Ba ý chính là:",
    ...unique.map((item, index) => `${index + 1}. ${item}`),
  ].join("\n");
}

function isExternalFreshInfoQuery(value: string) {
  const normalized = normalizeIntentText(value);
  if (!normalized) {
    return false;
  }

  const liveSignal =
    /\b(moi nhat|latest|today|hom nay|hien tai|current|cap nhat|vua moi|nam 20\d{2})\b/.test(
      normalized
    );
  const externalTopic =
    /\b(f1|quy dinh|tin tuc|gia vang|ty gia|thoi tiet|lich thi dau|chung khoan|bitcoin|btc|crypto)\b/.test(
      normalized
    );
  const internalSignal = /\b(noi bo|du an|khach hang|serial|he thong|tai lieu)\b/.test(
    normalized
  );

  return !internalSignal && (liveSignal || externalTopic);
}

function isExplicitMissingDataPrompt(value: string) {
  const normalized = normalizeIntentText(value);
  return /\b(khong ton tai trong he thong|khong co trong he thong|khong tim thay trong he thong)\b/.test(
    normalized
  );
}

function isGeminiWebSearchConsent(value: string) {
  const normalized = normalizeIntentText(value);
  if (!normalized) {
    return false;
  }

  return /^(co|ok|oke|dong y|tim web di|tim tren web di|search web di|tra web di|google di|tim google di)\b/.test(
    normalized,
  );
}

function shouldOfferGeminiAfterNoResult(chatInput: string, aiContent: string) {
  const normalizedPrompt = normalizeIntentText(chatInput);
  const normalizedAnswer = normalizeIntentText(aiContent);

  if (!normalizedPrompt || !normalizedAnswer) {
    return false;
  }

  const noResultSignal =
    /\b(khong tim thay|khong co thong tin|chua the xac minh|khong the khang dinh|khong co du lieu|du lieu noi bo khong co|khong co ban ghi)\b/.test(
      normalizedAnswer,
    );
  const strongInternalPrompt =
    /\b(noi bo|he thong|khach hang|du an|serial|ma thiet bi|ma hang|ton kho|nhan vien|bao gia)\b/.test(
      normalizedPrompt,
    );

  return noResultSignal && !strongInternalPrompt;
}

function buildGeminiWebOfferResolution(): LocalChatResolution {
  return {
    output:
      "Tôi chưa nên trả lời theo dữ liệu nội bộ cho yêu cầu này. Nếu bạn muốn, tôi có thể dùng một luồng riêng là Gemini Web Search để tìm trên web có grounding và trả lời lại. Hãy trả lời `có` hoặc `tìm trên web` để tôi tiếp tục.",
    routeHint: "gemini_web_offer",
    citations: [],
  };
}

function buildGreetingResolution(): LocalChatResolution {
  return {
    output:
      "Chào bạn. Tôi có thể hỗ trợ tra cứu dữ liệu nội bộ khi hệ thống truy cập được, tóm tắt tài liệu bạn gửi, và giải thích thông tin trong phiên làm việc này. Nếu câu hỏi cần dữ liệu hiện thời ngoài hệ thống hoặc dữ liệu nội bộ chưa xác minh được, tôi sẽ nói rõ giới hạn đó.",
    routeHint: "local_greeting",
  };
}

function buildExternalLimitResolution(): LocalChatResolution {
  return {
    output:
      "Tôi chưa có nguồn web trực tiếp đã xác minh trong tuyến chat này, nên không thể khẳng định thông tin mới nhất ngoài hệ thống. Nếu bạn gửi tài liệu hoặc nguồn cụ thể, tôi có thể tóm tắt và giải thích dựa trên nội dung đó.",
    routeHint: "local_external_limit",
  };
}

function buildMissingDataResolution(): LocalChatResolution {
  return {
    output:
      "Tôi không thể cung cấp số serial cho một thiết bị không tồn tại trong hệ thống. Nếu dữ liệu nội bộ không có bản ghi tương ứng thì câu trả lời đúng phải là không tìm thấy, và tôi sẽ không bịa ra một serial.",
    routeHint: "local_missing_data",
  };
}

function buildInternalUnavailableResolution(): LocalChatResolution {
  return {
    output:
      "Tôi chưa thể xác minh yêu cầu này từ dữ liệu nội bộ vì tuyến tra cứu hiện không phản hồi hoặc vượt quá thời gian chờ. Tôi không muốn suy đoán khi chưa kiểm chứng được dữ liệu.",
    routeHint: "local_internal_unavailable",
  };
}

function resolveLocalShortcut(params: {
  chatInput: string;
  inlinedAttachmentText: string;
}): LocalChatResolution | null {
  const { chatInput, inlinedAttachmentText } = params;

  if (isGreetingPrompt(chatInput)) {
    return buildGreetingResolution();
  }

  if (isAttachmentSummaryRequest(chatInput, inlinedAttachmentText.length > 0)) {
    return {
      output: buildAttachmentSummary(inlinedAttachmentText),
      routeHint: "local_attachment_summary",
    };
  }

  if (isExplicitMissingDataPrompt(chatInput)) {
    return buildMissingDataResolution();
  }

  return null;
}

function resolveLocalFailureFallback(params: {
  chatInput: string;
  inlinedAttachmentText: string;
}): LocalChatResolution {
  const shortcut = resolveLocalShortcut(params);
  if (shortcut) {
    return shortcut;
  }

  return buildInternalUnavailableResolution();
}

/**
 * @swagger
 * /api/chat/n8n:
 *   post:
 *     summary: Proxy request to n8n webhook (Multi-modal) with persistence
 *     description: Saves message to DB, forwards to n8n, and saves response.
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               sessionId:
 *                 type: string
 *               userId:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [chat, voice, image]
 *               chatInput:
 *                 type: string
 *               file:
 *                 type: string
 *                 format: binary
 *             required:
 *               - sessionId
 *               - type
 *     responses:
 *       200:
 *         description: Successful response from n8n.
 *       500:
 *         description: Server error.
 */
export async function POST(req: NextRequest) {
  let sessionId: string | undefined;
  let userContent: string | undefined;
  const requestId = req.headers.get("x-chat-request-id") || crypto.randomUUID();
  const startedAt = performance.now();
  const serverTiming: Array<{ name: string; durationMs: number }> = [];
  let responseStagePlan: string[] = [];
  const mark = (name: string, sinceMs: number) => {
    serverTiming.push({ name, durationMs: performance.now() - sinceMs });
  };
  const jsonWithTelemetry = (
    body: Record<string, unknown>,
    status: number,
    routeHint: string,
    extraMeta: Record<string, unknown> = {},
  ) => {
    const durationMs = performance.now() - startedAt;
    const response = NextResponse.json(
      {
        ...body,
        _meta: {
          requestId,
          durationMs,
          routeHint,
          stagePlan: responseStagePlan,
          serverTiming,
          ...extraMeta,
        },
      },
      { status }
    );
    response.headers.set("x-chat-request-id", requestId);
    response.headers.set("x-chat-duration-ms", durationMs.toFixed(1));
    response.headers.set("x-chat-route-hint", routeHint);
    response.headers.set("server-timing", createServerTimingHeader(serverTiming));
    return response;
  };

  const readRetrievedContext = (value: unknown): Record<string, unknown> | null => {
    if (!value) {
      return null;
    }

    if (typeof value === "object") {
      return value as Record<string, unknown>;
    }

    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    }

    return null;
  };

  const readStringField = (
    value: Record<string, unknown> | null,
    keys: string[],
  ): string | null => {
    if (!value) {
      return null;
    }

    for (const key of keys) {
      const field = value[key];
      if (typeof field === "string" && field.trim()) {
        return field;
      }
    }

    return null;
  };

  const readAgent0ContextId = (value: unknown): string | null => {
    const context = readRetrievedContext(value);
    const directContextId = readStringField(context, [
      "agent0ContextId",
      "agent0_context_id",
      "context_id",
      "contextId",
    ]);

    if (directContextId) {
      return directContextId;
    }

    const rawAgent0Response =
      context && typeof context.raw_agent0_response === "object"
        ? (context.raw_agent0_response as Record<string, unknown>)
        : null;

    return readStringField(rawAgent0Response, ["context_id", "contextId"]);
  };

  const readPendingWebSearchPrompt = (value: unknown): string | null => {
    const context = readRetrievedContext(value);
    return readStringField(context, ["webSearchPendingPrompt"]);
  };

  try {
    const textAttachmentExtensions = new Set([
      "txt",
      "md",
      "csv",
      "json",
      "log",
      "xml",
      "yaml",
      "yml",
    ]);
    const canInlineAttachmentText = (file: File) => {
      if (file.type.startsWith("text/")) {
        return true;
      }

      const extension = file.name.split(".").pop()?.toLowerCase();
      return extension ? textAttachmentExtensions.has(extension) : false;
    };

    const authStartedAt = performance.now();
    // Get authenticated user (auto-creates if needed)
    const currentUser = await getCurrentUserWithRole();
    mark("auth", authStartedAt);

    if (!currentUser) {
      return jsonWithTelemetry(
        { error: "Unauthorized. Please log in." },
        401,
        "auth_failed"
      );
    }

    const formStartedAt = performance.now();
    const formData = await req.formData();
    mark("parse_form", formStartedAt);
    sessionId = formData.get("sessionId") as string;
    const type = formData.get("type") as string;
    const chatInput = formData.get("chatInput") as string;
    const clientMessageId =
      (formData.get("clientMessageId") as string | null)?.trim() || requestId;
    const providedAgent0ContextId =
      (formData.get("agent0_context_id") as string | null)?.trim() || null;
    const hasAttachment = Boolean(formData.get("file"));
    const requestType = (type || "chat") as ChatRequestKind;
    const stagePlan = buildChatStagePlan({ type: requestType, hasAttachment });
    responseStagePlan = stagePlan;

    // 1. Validate inputs
    if (!sessionId || !type) {
      return jsonWithTelemetry(
        { error: "Missing sessionId or type" },
        400,
        "invalid_request"
      );
    }

    // Use authenticated user's ID
    const userId = currentUser.id;

    // 3. Ensure Session Exists (Upsert)
    // Chúng ta thử tìm session trước
    const sessionStartedAt = performance.now();
    let session = null;
    let persistenceAvailable = true;

    try {
      session = await prisma.chat_sessions.findUnique({
        where: { id: sessionId },
      });

      if (!session) {
        session = await prisma.chat_sessions.create({
          data: {
            id: sessionId,
            user_id: userId,
            summary: chatInput ? chatInput.substring(0, 50) : "New Conversation",
            created_at: new Date(),
          }
        });
      }
    } catch (error) {
      if (!isTenantDatabaseBoundaryError(error)) {
        console.error("Failed to create session:", error);
        return jsonWithTelemetry(
          { error: "Failed to create session. Ensure userId is valid." },
          500,
          "session_create_failed"
        );
      }

      persistenceAvailable = false;
      console.warn("[chat-persistence-degraded] session bootstrap unavailable", {
        requestId,
        sessionId,
      });
    }

    if (session && session.user_id !== userId) {
      return jsonWithTelemetry(
        { error: "Forbidden: You do not own this chat session." },
        403,
        "forbidden"
      );
    }
    mark("session", sessionStartedAt);

    let recentMessages: Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      retrieved_context: unknown;
      timestamp: Date;
    }> = [];

    if (persistenceAvailable) {
      const duplicateCheckStartedAt = performance.now();
      try {
        recentMessages = await prisma.chat_messages.findMany({
          where: { session_id: sessionId },
          orderBy: { timestamp: "desc" },
          take: 20,
          select: {
            id: true,
            role: true,
            content: true,
            retrieved_context: true,
            timestamp: true,
          },
        });
      } catch (error) {
        if (!isTenantDatabaseBoundaryError(error)) {
          throw error;
        }
        persistenceAvailable = false;
        recentMessages = [];
      }
      mark("duplicate_check", duplicateCheckStartedAt);
    }

    const duplicateUserMessage = recentMessages.find((message) => {
      if (message.role !== "user") {
        return false;
      }

      const context = readRetrievedContext(message.retrieved_context);
      return context?.clientMessageId === clientMessageId;
    });

    if (duplicateUserMessage) {
      const duplicateAssistantMessage = recentMessages.find((message) => {
        if (message.role !== "assistant") {
          return false;
        }

        const context = readRetrievedContext(message.retrieved_context);
        return context?.clientMessageId === clientMessageId;
      });

      if (duplicateAssistantMessage) {
        const context = readRetrievedContext(duplicateAssistantMessage.retrieved_context);
        const replayPayload = {
          output: duplicateAssistantMessage.content,
          citations: Array.isArray(context?.citations) ? context.citations : [],
          _meta: {
            requestId:
              typeof context?.requestId === "string" ? context.requestId : requestId,
            durationMs:
              typeof context?.durationMs === "number" ? context.durationMs : undefined,
            routeHint:
              typeof context?.routeHint === "string"
                ? context.routeHint
                : "duplicate_replay",
            stage:
              typeof context?.stage === "string" ? context.stage : "completed",
          },
          replayed: true,
        };

        return jsonWithTelemetry(replayPayload, 200, "duplicate_replay", {
          agent0ContextId: readAgent0ContextId(context),
        });
      }

      return jsonWithTelemetry(
        {
          message:
            "Yêu cầu này đã được gửi và đang được xử lý. Vui lòng đợi phản hồi hiện có thay vì gửi lại.",
        },
        202,
        "duplicate_inflight"
      );
    }

    const latestAssistantMessage = recentMessages.find(
      (message) => message.role === "assistant"
    );
    const previousAgent0ContextId =
      providedAgent0ContextId ||
      (latestAssistantMessage
        ? readAgent0ContextId(latestAssistantMessage.retrieved_context)
        : null);
    const pendingWebSearchPrompt = latestAssistantMessage
      ? readPendingWebSearchPrompt(latestAssistantMessage.retrieved_context)
      : null;
    const geminiWebSearchEnabled = isGeminiWebSearchConfigured();

    // 4. Save User Message
    // First, handle file upload if present
    let fileUrl = null;
    const file = formData.get("file") as File | null;
    let fileBuffer: Buffer | null = null;
    let inlinedAttachmentText = "";

    if (file && canInlineAttachmentText(file)) {
      try {
        const bytes = await file.arrayBuffer();
        fileBuffer = Buffer.from(bytes);
        inlinedAttachmentText = fileBuffer
          .toString("utf8")
          .replace(/\u0000/g, "")
          .trim()
          .slice(0, 12000);
      } catch (error) {
        console.warn("[chat-attachment-inline-text-failed]", {
          requestId,
          sessionId,
          fileName: file.name,
          error: serializeErrorForClient(error),
        });
      }
    }

    if (file) {
      const uploadStartedAt = performance.now();
      try {
        const supabaseAdmin = getSupabaseAdmin();
        if (!fileBuffer) {
          const bytes = await file.arrayBuffer();
          fileBuffer = Buffer.from(bytes);
        }
        const timestamp = Date.now();
        const filename = `${timestamp}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

        const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

        // Ensure bucket exists (Self-healing)
        const { data: buckets } = await supabaseAdmin.storage.listBuckets();
        if (!buckets?.find(b => b.name === bucket)) {
          await supabaseAdmin.storage.createBucket(bucket, { public: true });
        }

        const { error: uploadError } = await supabaseAdmin
          .storage
          .from(bucket)
          .upload(filename, fileBuffer, { contentType: file.type });

        if (!uploadError) {
          const { data: { publicUrl } } = supabaseAdmin
            .storage
            .from(bucket)
            .getPublicUrl(filename);
          fileUrl = publicUrl;
        }
      } catch (e) {
        console.error("Chat File Upload Error:", e);
      }
      mark("upload", uploadStartedAt);
    }

    userContent = chatInput || "";
    if (type === "voice") userContent = userContent || "[Voice Message]";
    if (type === "image") userContent = userContent || "[Image Upload]";

    if (persistenceAvailable) {
      const saveUserMessageStartedAt = performance.now();
      try {
        await prisma.chat_messages.create({
          data: {
            session_id: sessionId,
            role: "user",
            content: userContent,
            file_url: fileUrl,
            file_type: type, // 'image' or 'voice'
            timestamp: new Date(),
            retrieved_context: {
              source: "chat_n8n",
              clientMessageId,
              requestId,
              type: requestType,
              hasAttachment,
            },
          }
        });
      } catch (error) {
        if (!isTenantDatabaseBoundaryError(error)) {
          throw error;
        }
        persistenceAvailable = false;
      }
      mark("persist_user_message", saveUserMessageStartedAt);
    }

    const persistAssistantResponse = async (
      resolution: LocalChatResolution,
      extraContext: Record<string, unknown> = {},
    ) => {
      if (!persistenceAvailable) {
        return;
      }

      const saveAssistantMessageStartedAt = performance.now();
      try {
        await prisma.chat_messages.create({
          data: {
            session_id: sessionId!,
            role: "assistant",
            content: resolution.output,
            timestamp: new Date(),
            retrieved_context: {
              source: "chat_n8n",
              clientMessageId,
              requestId,
              type: requestType,
              hasAttachment,
              routeHint: resolution.routeHint,
              stage: "completed",
              durationMs: performance.now() - startedAt,
              citations: resolution.citations ?? [],
              ...extraContext,
            },
          }
        });
      } catch (error) {
        if (!isTenantDatabaseBoundaryError(error)) {
          throw error;
        }
        persistenceAvailable = false;
      }
      mark("persist_assistant_message", saveAssistantMessageStartedAt);
    };

    const persistAndReturnResolution = async (
      resolution: LocalChatResolution,
      extraContext: RequestResolutionMeta = {},
    ) => {
      const totalDurationMs = performance.now() - startedAt;
      await persistAssistantResponse(resolution, extraContext);

      console.info("[chat-request-metric]", JSON.stringify({
        requestId,
        sessionId,
        type: requestType,
        hasAttachment,
        routeHint: resolution.routeHint,
        persistenceAvailable,
        durationMs: totalDurationMs,
        stagePlan,
        outcome: "ok",
        ...extraContext,
      }));

      return jsonWithTelemetry(
        {
          output: resolution.output,
          citations: resolution.citations ?? [],
        },
        200,
        resolution.routeHint,
        extraContext,
      );
    };

    if (
      requestType === "chat" &&
      !hasAttachment &&
      geminiWebSearchEnabled &&
      pendingWebSearchPrompt &&
      isGeminiWebSearchConsent(userContent)
    ) {
      const geminiStartedAt = performance.now();
      try {
        const webResult = await runGeminiWebSearch(pendingWebSearchPrompt);
        mark("gemini_web_search", geminiStartedAt);

        return await persistAndReturnResolution(
          {
            output: webResult.output,
            routeHint: "gemini_web_search",
            citations: webResult.citations,
          },
          {
            webSearchUsed: true,
            webSearchProvider: "gemini_google_search",
            webSearchQueries: webResult.groundingQueries,
            webSearchModel: webResult.model,
          },
        );
      } catch (error) {
        mark("gemini_web_search", geminiStartedAt);

        return await persistAndReturnResolution(
          {
            output:
              "Tôi đã thử bật luồng Gemini Web Search nhưng lần này không lấy được kết quả ổn định. Bạn có thể thử lại với câu hỏi cụ thể hơn hoặc gửi nguồn muốn tôi đọc trực tiếp.",
            routeHint: "gemini_web_search_failed",
          },
          {
            webSearchUsed: true,
            webSearchProvider: "gemini_google_search",
            webSearchPendingPrompt: pendingWebSearchPrompt,
            degradedReason: serializeErrorForClient(error),
          },
        );
      }
    }

    if (
      requestType === "chat" &&
      !hasAttachment &&
      isExternalFreshInfoQuery(userContent)
    ) {
      if (geminiWebSearchEnabled) {
        return await persistAndReturnResolution(
          buildGeminiWebOfferResolution(),
          {
            webSearchPendingPrompt: userContent,
            webSearchProvider: "gemini_google_search",
          },
        );
      }

      return await persistAndReturnResolution(buildExternalLimitResolution());
    }

    const localShortcut = resolveLocalShortcut({
      chatInput: userContent,
      inlinedAttachmentText,
    });

    if (localShortcut) {
      return await persistAndReturnResolution(localShortcut);
    }

    // 5. Forward to n8n
    const n8nUrl = process.env.N8N_MAIN_RAG_WEBHOOK_URL;

    if (!n8nUrl) {
      // Development Fallback
      if (process.env.NODE_ENV === 'development') {
        const durationMs = performance.now() - startedAt;
        const fakeResponse = {
          text: `[DEV MODE] Received: ${userContent}. (Configure N8N_HOST in .env to use real AI)`
        };

        if (persistenceAvailable) {
          try {
            await prisma.chat_messages.create({
              data: {
                session_id: sessionId,
                role: "assistant",
                content: fakeResponse.text,
                timestamp: new Date(),
                retrieved_context: {
                  source: "chat_n8n",
                  clientMessageId,
                  requestId,
                  type: requestType,
                  hasAttachment,
                  routeHint: "dev_fallback",
                  stage: "completed",
                  durationMs,
                  citations: [],
                },
              }
            });
          } catch (error) {
            if (!isTenantDatabaseBoundaryError(error)) {
              throw error;
            }
            persistenceAvailable = false;
          }
        }
        return NextResponse.json(fakeResponse);
      }

      throw new Error("N8N Webhook URL not configured");
    }

    const effectiveChatInput =
      inlinedAttachmentText.length > 0
        ? `${chatInput || "Đây là nội dung file đính kèm cần xử lý."}\n\n[ATTACHED_FILE_TEXT_BEGIN]\n${inlinedAttachmentText}\n[ATTACHED_FILE_TEXT_END]`
        : chatInput;

    const outgoingFormData = new FormData();
    outgoingFormData.append("sessionId", sessionId);
    outgoingFormData.append("type", type);
    outgoingFormData.append("clientMessageId", clientMessageId);
    if (effectiveChatInput) outgoingFormData.append("chatInput", effectiveChatInput);
    if (previousAgent0ContextId) {
      outgoingFormData.append("agent0_context_id", previousAgent0ContextId);
    }
    if (file) outgoingFormData.append("file", file);
    if (fileUrl) outgoingFormData.append("fileUrl", fileUrl); // Provide URL to n8n as well

    const n8nStartedAt = performance.now();
    const n8nAbortController = new AbortController();
    const n8nTimeoutId = setTimeout(() => {
      n8nAbortController.abort();
    }, N8N_TIMEOUT_MS);
    let n8nResponse: Response;

    try {
      n8nResponse = await fetch(n8nUrl, {
        method: "POST",
        body: outgoingFormData,
        headers: {
          "x-chat-request-id": requestId,
        },
        signal: n8nAbortController.signal,
      });
    } catch (error) {
      mark("n8n", n8nStartedAt);

      const degradedResolution = resolveLocalFailureFallback({
        chatInput: userContent,
        inlinedAttachmentText,
      });
      const totalDurationMs = performance.now() - startedAt;
      const fallbackReason =
        error instanceof Error && error.name === "AbortError"
          ? "n8n_timeout"
          : "n8n_fetch_error";
      await persistAssistantResponse(degradedResolution, {
        degradedFrom: fallbackReason,
        degradedReason: serializeErrorForClient(error),
      });

      console.warn("[chat-request-degraded]", {
        requestId,
        sessionId,
        routeHint: degradedResolution.routeHint,
        fallbackReason,
        durationMs: totalDurationMs,
      });

      return jsonWithTelemetry(
        {
          output: degradedResolution.output,
          citations: degradedResolution.citations ?? [],
        },
        200,
        degradedResolution.routeHint,
        { degradedFrom: fallbackReason }
      );
    } finally {
      clearTimeout(n8nTimeoutId);
    }

    mark("n8n", n8nStartedAt);

    if (!n8nResponse.ok) {
      const errText = await n8nResponse.text();
      const degradedResolution = resolveLocalFailureFallback({
        chatInput: userContent,
        inlinedAttachmentText,
      });
      const totalDurationMs = performance.now() - startedAt;
      await persistAssistantResponse(degradedResolution, {
        degradedFrom: "n8n_non_ok",
        degradedReason: `n8n responded with ${n8nResponse.status}: ${errText}`,
      });

      console.warn("[chat-request-degraded]", {
        requestId,
        sessionId,
        routeHint: degradedResolution.routeHint,
        fallbackReason: "n8n_non_ok",
        upstreamStatus: n8nResponse.status,
        durationMs: totalDurationMs,
      });

      return jsonWithTelemetry(
        {
          output: degradedResolution.output,
          citations: degradedResolution.citations ?? [],
        },
        200,
        degradedResolution.routeHint,
        {
          degradedFrom: "n8n_non_ok",
          upstreamStatus: n8nResponse.status,
        }
      );
    }

    const text = await n8nResponse.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { text: text };
    }

    // 6. Save AI Response
    const normalizedData =
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown>)
        : { text };
    const aiContent =
      typeof normalizedData.output === "string"
        ? normalizedData.output
        : typeof normalizedData.text === "string"
          ? normalizedData.text
          : typeof normalizedData.message === "string"
            ? normalizedData.message
            : JSON.stringify(normalizedData);
    const citations = normalizedData.citations;
    const routeHint = inferRouteHint(normalizedData, {
      type: requestType,
      hasAttachment,
    });
    const agent0ContextId = readAgent0ContextId(normalizedData);
    const totalDurationMs = performance.now() - startedAt;

    if (
      requestType === "chat" &&
      !hasAttachment &&
      geminiWebSearchEnabled &&
      shouldOfferGeminiAfterNoResult(userContent, aiContent)
    ) {
      return await persistAndReturnResolution(
        buildGeminiWebOfferResolution(),
        {
          webSearchPendingPrompt: userContent,
          webSearchProvider: "gemini_google_search",
        },
      );
    }

    if (persistenceAvailable) {
      const saveAssistantMessageStartedAt = performance.now();
      try {
        await prisma.chat_messages.create({
          data: {
            session_id: sessionId,
            role: "assistant",
            content: aiContent,
            timestamp: new Date(),
            retrieved_context: {
              source: "chat_n8n",
              clientMessageId,
              requestId,
              type: requestType,
              hasAttachment,
              routeHint,
              stage: "completed",
              durationMs: totalDurationMs,
              citations: Array.isArray(citations) ? citations : [],
              ...(agent0ContextId ? { agent0ContextId } : {}),
            },
          }
        });
      } catch (error) {
        if (!isTenantDatabaseBoundaryError(error)) {
          throw error;
        }
        persistenceAvailable = false;
      }
      mark("persist_assistant_message", saveAssistantMessageStartedAt);
    }

    console.info("[chat-request-metric]", JSON.stringify({
      requestId,
      sessionId,
      type: requestType,
      hasAttachment,
      routeHint,
      persistenceAvailable,
      durationMs: totalDurationMs,
      stagePlan,
      outcome: "ok",
    }));

    return jsonWithTelemetry(normalizedData, 200, routeHint, {
      ...(agent0ContextId ? { agent0ContextId } : {}),
    });

  } catch (error: unknown) {
    const routeHint = "failed";
    console.error("[Chat API Error]", {
      requestId,
      sessionId,
      message: serializeErrorForClient(error),
      durationMs: performance.now() - startedAt,
    });
    return jsonWithTelemetry(
      {
        error: "Internal Server Error",
        details: serializeErrorForClient(error),
        requestId,
        stage: "failed",
      },
      500,
      routeHint
    );
  }
}
