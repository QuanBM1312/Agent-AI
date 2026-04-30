import { NextResponse } from "next/server";
import { v4 as uuidv4 } from 'uuid';
import { handleApiError } from "@/lib/api-helper";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";
import { isTenantDatabaseBoundaryError } from "@/lib/db-runtime";

/**
 * @swagger
 * /api/chat/sessions:
 *   get:
 *     summary: List chat sessions
 *     tags: [Chat]
 *     parameters:
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *         description: Filter by User ID
 *     responses:
 *       200:
 *         description: List of sessions
 *   post:
 *     summary: Create a new chat session
 *     tags: [Chat]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user_id
 *             properties:
 *               user_id:
 *                 type: string
 *                 format: uuid
 *               summary:
 *                 type: string
 *     responses:
 *       201:
 *         description: Session created
 */
import { getPaginationParams, formatPaginatedResponse } from "@/lib/pagination";

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const paginationParams = getPaginationParams(request);

    let sessions: Array<{
      id: string;
      summary: string | null;
      created_at: Date;
      chat_messages: Array<{ content: string }>;
    }> = [];
    let totalCount = 0;

    try {
      [sessions, totalCount] = await prisma.$transaction([
        prisma.chat_sessions.findMany({
          where: {
            user_id: currentUser.id,
          },
          orderBy: {
            created_at: "desc",
          },
          skip: paginationParams.skip,
          take: paginationParams.limit,
          select: {
            id: true,
            summary: true,
            created_at: true,
            chat_messages: {
              orderBy: {
                timestamp: "desc",
              },
              take: 1,
              select: {
                content: true,
              },
            },
          },
        }),
        prisma.chat_sessions.count({
          where: {
            user_id: currentUser.id,
          },
        }),
      ]);
    } catch (error) {
      if (!isTenantDatabaseBoundaryError(error)) {
        throw error;
      }

      return NextResponse.json(
        { error: "Chat sessions are temporarily unavailable" },
        { status: 503 }
      );
    }

    const formattedSessions = sessions.map((session) => ({
      id: session.id,
      title: session.summary || "New Chat",
      updatedAt: session.created_at,
      preview: session.chat_messages[0]?.content || "No messages yet",
    }));

    return NextResponse.json(formatPaginatedResponse(formattedSessions, totalCount, paginationParams));
  } catch (error) {
    return handleApiError(error, "Get Sessions Error");
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    let newSession;

    try {
      newSession = await prisma.chat_sessions.create({
        data: {
          id: uuidv4(),
          user_id: currentUser.id,
          summary: body.summary || "New Chat",
          created_at: new Date()
        }
      });
    } catch (error) {
      if (!isTenantDatabaseBoundaryError(error)) {
        throw error;
      }

      newSession = {
        id: uuidv4(),
        user_id: currentUser.id,
        summary: body.summary || "New Chat",
        created_at: new Date(),
        degraded: true,
      };
    }

    return NextResponse.json(newSession, { status: 201 });
  } catch (error) {
    console.error("Failed to create session:", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
