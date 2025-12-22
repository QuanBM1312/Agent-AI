import { NextResponse } from "next/server";
import { v4 as uuidv4 } from 'uuid';
import { handleApiError } from "@/lib/api-helper";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";

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

    // Fetch sessions with latest message in 1 query
    const sessionsResult = await prisma.$queryRaw<any[]>`
      SELECT 
        s.*,
        COUNT(*) OVER() as full_count,
        (
          SELECT content 
          FROM public.chat_messages m 
          WHERE m.session_id = s.id 
          ORDER BY m.timestamp DESC 
          LIMIT 1
        ) as preview
      FROM public.chat_sessions s
      WHERE s.user_id = ${currentUser.id}
      ORDER BY s.created_at DESC
      LIMIT ${paginationParams.limit} OFFSET ${paginationParams.skip}
    `;

    const totalCount = Number(sessionsResult[0]?.full_count || 0);

    const formattedSessions = sessionsResult.map(session => ({
      id: session.id,
      title: session.summary || "New Chat",
      updatedAt: session.created_at,
      preview: session.preview || "No messages yet"
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

    const newSession = await prisma.chat_sessions.create({
      data: {
        id: uuidv4(),
        user_id: currentUser.id,
        summary: body.summary || "New Chat",
        created_at: new Date()
      }
    });

    return NextResponse.json(newSession, { status: 201 });
  } catch (error) {
    console.error("Failed to create session:", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}



