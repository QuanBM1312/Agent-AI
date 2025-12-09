import { NextRequest, NextResponse } from "next/server";

/**
 * @swagger
 * /api/chat/n8n:
 *   post:
 *     summary: Proxy request to n8n webhook (Multi-modal)
 *     description: Forwards chat messages, voice recordings, or images to the configured n8n workflow.
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
 *                 description: Unique session ID.
 *               type:
 *                 type: string
 *                 enum: [chat, voice, image]
 *                 description: Type of message.
 *               chatInput:
 *                 type: string
 *                 description: Text message content (optional for voice/image).
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Audio file (for type='voice') or Image file (for type='image').
 *             required:
 *               - sessionId
 *               - type
 *     responses:
 *       200:
 *         description: Successful response from n8n.
 *       500:
 *         description: Server error or n8n configuration missing.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const type = formData.get("type") as string;

    // Choose Webhook URL based on type
    let n8nUrl = process.env.N8N_HOST; // Default

    if (type === "image" && process.env.N8N_WEBHOOK_IMAGE) {
      n8nUrl = process.env.N8N_WEBHOOK_IMAGE;
    } else {
      n8nUrl = process.env.N8N_MAIN_RAG_WEBHOOK_URL;
    }

    if (!n8nUrl) {
      return NextResponse.json(
        { error: "N8N Webhook URL not configured for this type" },
        { status: 500 }
      );
    }

    // Forward to n8n
    // Note: We need to reconstruct formData to send it downstream? 
    // Or just pass the fields. fetch can accept formData directly in body.
    // However, when reading from req.formData(), it consumes the stream.
    // We can create a new FormData to send outgoing.

    const outgoingFormData = new FormData();
    // Copy all entries
    for (const [key, value] of Array.from(formData.entries())) {
      outgoingFormData.append(key, value);
    }

    const n8nResponse = await fetch(n8nUrl, {
      method: "POST",
      body: outgoingFormData,
      // headers: { ... } // fetch with FormData automatically sets Content-Type to multipart
    });

    if (!n8nResponse.ok) {
      throw new Error(`n8n responded with ${n8nResponse.status}`);
    }

    const text = await n8nResponse.text();
    console.log("n8n Raw Response:", text); // Debug logging

    if (!text.trim()) {
      return NextResponse.json({});
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn("Expected JSON from n8n but got plain text/html. Wrapping as text.");
      data = { text: text };
    }

    return NextResponse.json(data);

  } catch (error: any) {
    console.error("Error proxying to n8n:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
