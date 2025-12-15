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

    const { searchParams } = new URL(request.url); // Extract params if needed

    console.log(`[Messages API] POST received. Session: ${body.session_id}, Content: "${body.content.substring(0, 20)}..."`);

    // --- DEDUPLICATION CHECK ---
    // Fetch last 5 messages for this session to compare in memory
    const recentMessages = await prisma.chat_messages.findMany({
      where: {
        session_id: body.session_id,
        role: body.role, // Match role
      },
      orderBy: {
        timestamp: 'desc'
      },
      take: 5
    });

    console.log(`[Messages API] Recent messages found: ${recentMessages.length}`);
    recentMessages.forEach(m => {
      console.log(` - ID: ${m.id}, Content: "${m.content.substring(0, 20)}...", TimeDiff: ${Date.now() - new Date(m.timestamp).getTime()}ms`);
    });

    const duplicateMessage = recentMessages.find(msg => {
      const contentMatch = msg.content.trim() === body.content.trim();
      const timeMatch = (new Date().getTime() - new Date(msg.timestamp).getTime() < 60000);
      if (contentMatch && timeMatch) {
        console.log(`   -> Match found! ID: ${msg.id}`);
        return true;
      }
      return false;
    });

    if (duplicateMessage) {
      console.log(`[Messages API] Duplicate detected (Memory Check), skipping creation. ID: ${duplicateMessage.id}`);
      return NextResponse.json(duplicateMessage, { status: 200 });
    }
    // ---------------------------

    const newMessage = await prisma.chat_messages.create({
      data: {
        session_id: body.session_id,
        role: body.role, // 'user' hoặc 'assistant'
        content: body.content,
        timestamp: new Date(),
        retrieved_context: { ...(body.retrieved_context || {}), source: 'messages_api' } // Tag source
      }
    });

    return NextResponse.json(newMessage, { status: 201 });
  } catch (error) {
    return handleApiError(error, "Create Message Error");
  }
}



