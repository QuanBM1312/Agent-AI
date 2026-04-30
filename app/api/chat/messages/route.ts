import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { handleApiError } from "@/lib/api-helper";
import { getCurrentUserWithRole } from "@/lib/auth-utils";
import { isTenantDatabaseBoundaryError } from "@/lib/db-runtime";

/**
 * @swagger
 * /api/chat/messages:
 *   get:
 *     summary: List messages in a session
 *     tags: [Chat]
 *     parameters:
 *       - in: query
 *         name: session_id
 *         schema:
 *           type: string
 *         description: ID of the chat session
 *     responses:
 *       200:
 *         description: List of messages
 *   post:
 *     summary: Add a new message
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - session_id
 *               - role
 *               - content
 *             properties:
 *               session_id:
 *                 type: string
 *                 format: uuid
 *               role:
 *                 type: string
 *                 enum: [user, assistant]
 *               content:
 *                 type: string
 *     responses:
 *       201:
 *         description: Message created
 */
import { getPaginationParams, formatPaginatedResponse } from "@/lib/pagination";

function parseRetrievedContext(value: unknown) {
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
}

function readAgent0ContextId(value: unknown) {
  const context = parseRetrievedContext(value);
  if (!context) {
    return null;
  }

  for (const key of ["agent0ContextId", "agent0_context_id", "context_id", "contextId"]) {
    const field = context[key];
    if (typeof field === "string" && field.trim()) {
      return field;
    }
  }

  const rawAgent0Response =
    context.raw_agent0_response && typeof context.raw_agent0_response === "object"
      ? (context.raw_agent0_response as Record<string, unknown>)
      : null;

  if (!rawAgent0Response) {
    return null;
  }

  for (const key of ["context_id", "contextId"]) {
    const field = rawAgent0Response[key];
    if (typeof field === "string" && field.trim()) {
      return field;
    }
  }

  return null;
}

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const session_id = searchParams.get("session_id");

    if (!session_id) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    let session;

    try {
      session = await prisma.chat_sessions.findFirst({
        where: {
          id: session_id,
          user_id: currentUser.id,
        },
        select: { id: true },
      });
    } catch (error) {
      if (!isTenantDatabaseBoundaryError(error)) {
        throw error;
      }
      return NextResponse.json(
        { error: "Chat history is temporarily unavailable" },
        { status: 503 }
      );
    }

    if (!session) {
      return NextResponse.json({ error: "Chat session not found" }, { status: 404 });
    }

    const paginationParams = getPaginationParams(request, 50);

    let messagesResult: Awaited<ReturnType<typeof prisma.chat_messages.findMany>> = [];
    let totalCount = 0;

    try {
      [messagesResult, totalCount] = await prisma.$transaction([
        prisma.chat_messages.findMany({
          where: {
            session_id,
          },
          orderBy: {
            timestamp: "asc",
          },
          skip: paginationParams.skip,
          take: paginationParams.limit,
        }),
        prisma.chat_messages.count({
          where: {
            session_id,
          },
        }),
      ]);
    } catch (error) {
      if (!isTenantDatabaseBoundaryError(error)) {
        throw error;
      }

      return NextResponse.json(
        { error: "Chat history is temporarily unavailable" },
        { status: 503 }
      );
    }

    const messages = messagesResult.map((message) => {
      const context = parseRetrievedContext(message.retrieved_context);
      const agent0ContextId = readAgent0ContextId(message.retrieved_context);

      return {
        ...message,
        citations: Array.isArray(context?.citations) ? context.citations : undefined,
        requestMeta:
          typeof context?.requestId === "string"
            ? {
                requestId: context.requestId,
                durationMs:
                  typeof context.durationMs === "number" ? context.durationMs : undefined,
                routeHint:
                  typeof context.routeHint === "string" ? context.routeHint : undefined,
                stage:
                  typeof context.stage === "string" ? context.stage : undefined,
                agent0ContextId: agent0ContextId || undefined,
                webSearchUsed:
                  typeof context.webSearchUsed === "boolean"
                    ? context.webSearchUsed
                    : undefined,
                webSearchProvider:
                  typeof context.webSearchProvider === "string"
                    ? context.webSearchProvider
                    : undefined,
                webSearchPendingPrompt:
                  typeof context.webSearchPendingPrompt === "string"
                    ? context.webSearchPendingPrompt
                    : undefined,
              }
            : undefined,
      };
    });

    return NextResponse.json(formatPaginatedResponse(messages, totalCount, paginationParams));
  } catch (error) {
    return handleApiError(error, "Get Messages Error");
  }
}
