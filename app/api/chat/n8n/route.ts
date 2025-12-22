import { NextRequest, NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";
import { v4 as uuidv4 } from "uuid";
import { handleApiError } from "@/lib/api-helper";

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
  // Define variables outside try block for finally access
  let sessionId: string | undefined;
  let userContent: string | undefined;
  let clientMessageId: string | undefined;

  try {
    // Get authenticated user (auto-creates if needed)
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json(
        { error: "Unauthorized. Please log in." },
        { status: 401 }
      );
    }

    const formData = await req.formData();
    sessionId = formData.get("sessionId") as string;
    const type = formData.get("type") as string;
    const chatInput = formData.get("chatInput") as string;

    // 1. Validate inputs
    if (!sessionId || !type) {
      return NextResponse.json(
        { error: "Missing sessionId or type" },
        { status: 400 }
      );
    }

    // Use authenticated user's ID
    const userId = currentUser.id;

    // 3. Ensure Session Exists (Upsert)
    // Chúng ta thử tìm session trước
    let session = await prisma.chat_sessions.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      // Tạo mới session
      try {
        session = await prisma.chat_sessions.create({
          data: {
            id: sessionId,
            user_id: userId,
            summary: chatInput ? chatInput.substring(0, 50) : "New Conversation",
            created_at: new Date(),
          }
        });
      } catch (e) {
        console.error("Failed to create session:", e);
        // Nếu lỗi này do userId không tồn tại trong bảng users, ta cần báo lỗi rõ ràng
        return NextResponse.json(
          { error: "Failed to create session. Ensure userId is valid." },
          { status: 500 }
        );
      }
    }

    // 4. Save User Message - REMOVED (User requested N8N to handle saving)
    // We only prepare the content variable for N8N forwarding if needed (it uses chatInput/formData directly)
    userContent = chatInput || "";
    if (type === "voice") userContent = "[Voice Message]";
    if (type === "image") userContent = "[Image Upload]";

    // OPTIONAL: If N8N fails to save the user message, there is a risk of data loss here.
    // The user has explicitly accepted this risk to avoid duplication.

    // 5. Forward to n8n
    let n8nUrl = process.env.N8N_HOST;
    if (type === "image" && process.env.N8N_WEBHOOK_IMAGE) {
      n8nUrl = process.env.N8N_WEBHOOK_IMAGE;
    } else {
      n8nUrl = process.env.N8N_MAIN_RAG_WEBHOOK_URL;
    }

    if (!n8nUrl) {
      // Development Fallback: Nếu không có n8n, trả về echo để test
      if (process.env.NODE_ENV === 'development') {
        const fakeResponse = {
          text: `[DEV MODE] Received: ${userContent}. (Configure N8N_HOST in .env to use real AI)`
        };

        // In dev mode without N8N, we MUST save it manually or it won't appear at all.
        await prisma.chat_messages.create({
          data: {
            session_id: sessionId,
            role: "user",
            content: userContent,
            timestamp: new Date(),
            retrieved_context: { source: 'dev_mode' }
          }
        });

        await prisma.chat_messages.create({
          data: {
            session_id: sessionId,
            role: "assistant",
            content: fakeResponse.text,
            timestamp: new Date(),
          }
        });
        return NextResponse.json(fakeResponse);
      }

      throw new Error("N8N Webhook URL not configured");
    }

    const outgoingFormData = new FormData();
    // Copy fields for n8n
    outgoingFormData.append("sessionId", sessionId);
    outgoingFormData.append("type", type);
    if (chatInput) outgoingFormData.append("chatInput", chatInput);

    // Nếu có file, cần append đúng cách
    const file = formData.get("file");
    if (file) {
      outgoingFormData.append("file", file);
    }

    const n8nResponse = await fetch(n8nUrl, {
      method: "POST",
      body: outgoingFormData,
    });

    if (!n8nResponse.ok) {
      // Log text lỗi từ n8n
      const errText = await n8nResponse.text();
      throw new Error(`n8n responded with ${n8nResponse.status}: ${errText}`);
    }

    const text = await n8nResponse.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { text: text };
    }

    // 6. Save AI Response (Keep this as fallback/check)
    const aiContent = data.output || data.text || data.message || JSON.stringify(data);
    const citations = data.citations; // Optional

    // --- RESPONSE DEDUPLICATION ---
    const connection = await prisma.chat_messages.findFirst({
      where: {
        session_id: sessionId,
        role: "assistant",
      },
      orderBy: {
        timestamp: 'desc'
      }
    });

    if (connection && connection.content === aiContent && (new Date().getTime() - new Date(connection.timestamp).getTime() < 10000)) {
      console.log(`[n8n API] Duplicate AI response detected (matched DB), skipping save.`);
    } else {
      await prisma.chat_messages.create({
        data: {
          session_id: sessionId,
          role: "assistant",
          content: aiContent,
          timestamp: new Date(),
          retrieved_context: citations ? JSON.stringify(citations) : undefined
        }
      });
    }
    // ----------------------------

    return NextResponse.json(data);

  } catch (error: any) {
    return handleApiError(error, "Chat API Error");
  }
}
