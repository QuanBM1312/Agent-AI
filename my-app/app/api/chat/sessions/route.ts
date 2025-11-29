import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

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
    const { searchParams } = new URL(request.url);
    const user_id = searchParams.get("user_id");

    if (!user_id) {
        return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const sessions = await prisma.chat_sessions.findMany({
      where: {
        user_id: user_id
      },
      orderBy: {
        created_at: 'desc'
      },
      take: 20 // Lấy 20 session gần nhất
    });

    return NextResponse.json(sessions);
  } catch (error) {
    console.error("Failed to fetch sessions:", error);
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.user_id) {
        return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const newSession = await prisma.chat_sessions.create({
      data: {
        user_id: body.user_id,
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


