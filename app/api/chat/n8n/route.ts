import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const type = formData.get("type") as string;

    // Choose Webhook URL based on type
    let n8nUrl = process.env.N8N_WEBHOOK_URL; // Default

    if (type === "voice" && process.env.N8N_WEBHOOK_VOICE) {
      n8nUrl = process.env.N8N_WEBHOOK_VOICE;
    } else if (type === "image" && process.env.N8N_WEBHOOK_IMAGE) {
      n8nUrl = process.env.N8N_WEBHOOK_IMAGE;
    } else if (type === "chat" && process.env.N8N_WEBHOOK_CHAT) {
      n8nUrl = process.env.N8N_WEBHOOK_CHAT;
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

    const data = await n8nResponse.json();
    return NextResponse.json(data);

  } catch (error: any) {
    console.error("Error proxying to n8n:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
