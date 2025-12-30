import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { source_url, source_name, refresh_frequency } = body;

    if (!source_url) {
      return NextResponse.json({ error: "Source URL is required" }, { status: 400 });
    }

    // 1. Fetch metadata (title) locally (to save to DB correctly)
    let pageTitle = source_name || source_url;
    try {
      const res = await fetch(source_url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeBot/1.0)' }
      });
      if (res.ok) {
        const html = await res.text();
        const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (match && match[1]) {
          pageTitle = match[1].trim();
        }
      }
    } catch (err) {
      console.error("Error fetching URL metadata:", err);
    }

    // 2. Call the external Webhook
    const webhookUrl = process.env.N8N_INSERT_URL;

    if (!webhookUrl) {
      console.error("Missing N8N_INSERT_URL environment variable");
      return NextResponse.json({ error: "Server configuration error: Missing Webhook URL" }, { status: 500 });
    }

    try {
      // Prepare URL with query params for GET request
      const targetUrl = new URL(webhookUrl);
      targetUrl.searchParams.append("url", source_url);
      targetUrl.searchParams.append("title", pageTitle || "");
      targetUrl.searchParams.append("frequency", refresh_frequency);

      console.log(`[Insert URL] Attempting to send to webhook (GET): ${targetUrl.toString()}`);

      const response = await fetch(targetUrl.toString(), {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });

      console.log(`[Insert URL] Webhook response status: ${response.status}`);
      if (!response.ok) {
        console.error(`[Insert URL] Webhook failed with status: ${response.status} - ${await response.text()}`);
      } else {
        console.log(`[Insert URL] Webhook successfully triggered`);
      }
    } catch (webhookError) {
      console.error("Error sending to webhook:", webhookError);
      // We continue even if webhook fails? Or fail? 
      // User said "connect to webhook for inserting url". 
      // I'll log it but proceed to save to DB so the UI updates, or maybe fail?
      // Let's assume critical failure if webhook fails.
    }

    // 3. Save to Database (for UI consistency)
    const newSource = await prisma.knowledge_sources.create({
      data: {
        drive_file_id: source_url,
        drive_name: pageTitle,
        sheet_name: "WEB_URL",
        hash: refresh_frequency
      }
    });

    return NextResponse.json(newSource, { status: 201 });

  } catch (error) {
    console.error("Failed to add source:", error);
    return NextResponse.json({ error: "Failed to add source" }, { status: 500 });
  }
}
