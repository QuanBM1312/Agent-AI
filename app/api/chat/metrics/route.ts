import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { handleApiError } from "@/lib/api-helper";
import { getCurrentUserWithRole } from "@/lib/auth-utils";
import { ChatRequestMetric, ChatStageKey } from "@/lib/chat-observability";
import { isTenantDatabaseBoundaryError } from "@/lib/db-runtime";

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

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");

    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    let session;

    try {
      session = await prisma.chat_sessions.findFirst({
        where: {
          id: sessionId,
          user_id: currentUser.id,
        },
        select: { id: true },
      });
    } catch (error) {
      if (!isTenantDatabaseBoundaryError(error)) {
        throw error;
      }
      return NextResponse.json(
        { error: "Chat telemetry is temporarily unavailable" },
        { status: 503 }
      );
    }

    if (!session) {
      return NextResponse.json({ error: "Chat session not found" }, { status: 404 });
    }

    let messages: Array<{
      timestamp: Date;
      retrieved_context: unknown;
    }> = [];

    try {
      messages = await prisma.chat_messages.findMany({
        where: {
          session_id: sessionId,
          role: "assistant",
        },
        orderBy: { timestamp: "desc" },
        take: 25,
        select: {
          timestamp: true,
          retrieved_context: true,
        },
      });
    } catch (error) {
      if (!isTenantDatabaseBoundaryError(error)) {
        throw error;
      }

      return NextResponse.json(
        { error: "Chat telemetry is temporarily unavailable" },
        { status: 503 }
      );
    }

    const metrics = messages.flatMap((message) => {
      const context = parseRetrievedContext(message.retrieved_context);

      if (!context || typeof context.requestId !== "string") {
        return [];
      }

      return [
        {
          requestId: context.requestId,
          sessionId,
          type:
            context.type === "voice" || context.type === "image" ? context.type : "chat",
          hasAttachment: Boolean(context.hasAttachment),
          latencyMs:
            typeof context.durationMs === "number" ? context.durationMs : 0,
          routeHint:
            typeof context.routeHint === "string" ? context.routeHint : "persisted",
          outcome: context.stage === "failed" ? "error" : "ok",
          stage:
            typeof context.stage === "string"
              ? (context.stage as ChatStageKey)
              : "completed",
          timestamp: message.timestamp.toISOString(),
        } satisfies ChatRequestMetric,
      ];
    });

    return NextResponse.json({ data: metrics });
  } catch (error) {
    return handleApiError(error, "Get Chat Metrics Error");
  }
}
