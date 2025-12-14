import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { handleApiError } from "@/lib/api-helper";

const prisma = new PrismaClient();

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
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const session_id = searchParams.get("session_id");

    if (!session_id) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    const messages = await prisma.chat_messages.findMany({
      where: {
        session_id: session_id
      },
      orderBy: {
        timestamp: 'asc' // Tin nhắn cũ nhất lên đầu
      }
    });

    return NextResponse.json(messages);
  } catch (error) {
    return handleApiError(error, "Get Messages Error");
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.session_id || !body.role || !body.content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const newMessage = await prisma.chat_messages.create({
      data: {
        session_id: body.session_id,
        role: body.role, // 'user' hoặc 'assistant'
        content: body.content,
        timestamp: new Date(),
        retrieved_context: body.retrieved_context || {} // Lưu thêm ngữ cảnh nếu có (cho debugging)
      }
    });

    return NextResponse.json(newMessage, { status: 201 });
  } catch (error) {
    return handleApiError(error, "Create Message Error");
  }
}



