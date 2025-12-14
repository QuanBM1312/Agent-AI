import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from 'uuid';
import { handleApiError } from "@/lib/api-helper";

const prisma = new PrismaClient();

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
export async function GET(request: Request) {
  try {
    // Import auth utils to get current user and auto-create if needed
    const { getCurrentUserWithRole } = await import("@/lib/auth-utils");
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessions = await prisma.chat_sessions.findMany({
      where: {
        user_id: currentUser.id
      },
      orderBy: {
        created_at: 'desc'
      },
      include: {
        chat_messages: {
          take: 1,
          orderBy: {
            timestamp: 'desc'
          }
        }
      }
    });

    const formattedSessions = sessions.map(session => ({
      id: session.id,
      title: session.summary || "New Chat",
      updatedAt: session.created_at, // Using created_at as we don't have updated_at yet
      preview: session.chat_messages[0]?.content || "No messages yet"
    }));

    return NextResponse.json(formattedSessions);
  } catch (error) {
    return handleApiError(error, "Get Sessions Error");
  }
}

export async function POST(request: Request) {
  try {
    // Import auth utils to get current user and auto-create if needed
    const { getCurrentUserWithRole } = await import("@/lib/auth-utils");
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



