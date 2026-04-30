import { NextResponse } from 'next/server';
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";
import {
  createServerTimingHeader,
  inferRouteHint,
  serializeErrorForClient,
} from "@/lib/chat-observability";
import { isTenantDatabaseBoundaryError } from "@/lib/db-runtime";

const N8N_TIMEOUT_MS = 25_000;

/**
 * @swagger
 * /api/chat/internal:
 *   post:
 *     summary: Send a message to the n8n RAG agent
 *     description: This endpoint forwards a user's message and session ID to the main n8n workflow for processing and returns the agent's response.
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               chatInput:
 *                 type: string
 *                 description: The user's message.
 *                 example: "What is the F1 regulation for 2025?"
 *               sessionId:
 *                 type: string
 *                 description: A unique ID for each chat session to maintain context.
 *                 example: "user123-convo456"
 *             required:
 *               - chatInput
 *               - sessionId
 *     responses:
 *       200:
 *         description: Successful response from the n8n agent.
 *       400:
 *         description: Invalid request due to missing `chatInput` or `sessionId`.
 *       500:
 *         description: Server error, e.g., unable to connect to n8n.
 */
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  const serverTiming: Array<{ name: string; durationMs: number }> = [];
  const mark = (name: string, sinceMs: number) => {
    serverTiming.push({ name, durationMs: performance.now() - sinceMs });
  };
  const jsonWithMeta = (
    body: Record<string, unknown>,
    status: number,
    routeHint: string,
  ) => {
    const durationMs = performance.now() - startedAt;
    const response = NextResponse.json(
      {
        ...body,
        _meta: {
          ...(typeof body._meta === "object" && body._meta !== null
            ? (body._meta as Record<string, unknown>)
            : {}),
          requestId,
          durationMs,
          routeHint,
          serverTiming,
        },
      },
      { status },
    );

    response.headers.set("x-chat-request-id", requestId);
    response.headers.set("x-chat-duration-ms", durationMs.toFixed(1));
    response.headers.set("x-chat-route-hint", routeHint);
    response.headers.set("server-timing", createServerTimingHeader(serverTiming));

    return response;
  };

  try {
    const authStartedAt = performance.now();
    const currentUser = await getCurrentUserWithRole();
    mark("auth", authStartedAt);

    if (!currentUser) {
      return jsonWithMeta(
        { message: 'Unauthorized', requestId },
        401,
        "auth_failed",
      );
    }

    const parseStartedAt = performance.now();
    const { chatInput, sessionId } = await request.json();
    mark("parse_body", parseStartedAt);

    if (!chatInput || !sessionId) {
      return jsonWithMeta(
        { message: 'Missing chatInput or sessionId', requestId },
        400,
        "invalid_request",
      );
    }

    const sessionStartedAt = performance.now();
    let session;

    try {
      session = await prisma.chat_sessions.findUnique({
        where: { id: sessionId },
        select: { id: true, user_id: true },
      });

      if (session && session.user_id !== currentUser.id) {
        return jsonWithMeta(
          { message: 'Forbidden: You do not own this chat session', requestId },
          403,
          "forbidden",
        );
      }

      if (!session) {
        await prisma.chat_sessions.create({
          data: {
            id: sessionId,
            user_id: currentUser.id,
            summary: chatInput.substring(0, 50),
            created_at: new Date(),
          },
        });
      }
    } catch (error) {
      if (!isTenantDatabaseBoundaryError(error)) {
        throw error;
      }

      return jsonWithMeta(
        {
          message: "Chat session is temporarily unavailable",
          details: serializeErrorForClient(error),
        },
        503,
        "session_unavailable",
      );
    }
    mark("session", sessionStartedAt);

    const n8nWebhookUrl = process.env.N8N_MAIN_RAG_WEBHOOK_URL;

    if (!n8nWebhookUrl) {
      throw new Error('N8N_MAIN_RAG_WEBHOOK_URL is not defined in environment variables');
    }

    const n8nStartedAt = performance.now();
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, N8N_TIMEOUT_MS);

    let response: Response;

    try {
      response = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-chat-request-id': requestId,
        },
        body: JSON.stringify({
          chatInput,
          sessionId,
          userId: currentUser.id,
        }),
        signal: abortController.signal,
      });
    } catch (error) {
      const routeHint =
        error instanceof Error && error.name === "AbortError"
          ? "n8n_timeout"
          : "n8n_fetch_error";

      return jsonWithMeta(
        {
          message:
            routeHint === "n8n_timeout"
              ? "n8n did not respond before the timeout"
              : "Failed to call n8n agent",
          details: serializeErrorForClient(error),
        },
        502,
        routeHint,
      );
    } finally {
      clearTimeout(timeoutId);
      mark("n8n", n8nStartedAt);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to call n8n agent:', errorText);
      return jsonWithMeta(
        {
          message: 'Failed to call n8n agent',
          details: errorText,
        },
        response.status,
        "n8n_non_ok",
      );
    }

    const responseText = await response.text();

    try {
      const result = JSON.parse(responseText);
      const routeHint =
        typeof result === "object" && result !== null
          ? inferRouteHint(result as Record<string, unknown>, {
              type: "chat",
              hasAttachment: false,
            })
          : "general";

      return jsonWithMeta(
        typeof result === "object" && result !== null
          ? (result as Record<string, unknown>)
          : { output: responseText },
        200,
        routeHint,
      );
    } catch (parseError) {
      console.error('Failed to parse n8n response as JSON:', parseError);
      return jsonWithMeta(
        { message: 'Invalid response format from n8n', rawResponse: responseText, requestId },
        500,
        "invalid_upstream_response",
      );
    }
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      return jsonWithMeta(
        { message: error.message, requestId },
        500,
        "failed",
      );
    }
    return jsonWithMeta(
      { message: 'An unknown error occurred', requestId },
      500,
      "failed",
    );
  }
}
