import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * @swagger
 * /api/knowledge/sources:
 *   get:
 *     summary: List knowledge sources
 *     tags: [Knowledge Base]
 *     responses:
 *       200:
 *         description: List of sources
 *   post:
 *     summary: Add a knowledge source
 *     tags: [Knowledge Base]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - drive_name
 *               - drive_file_id
 *             properties:
 *               drive_name:
 *                 type: string
 *               drive_file_id:
 *                 type: string
 *     responses:
 *       201:
 *         description: Source added
 */
export async function GET() {
  try {
    const sources = await prisma.knowledge_sources.findMany({
      orderBy: { created_at: 'desc' }
    });
    return NextResponse.json(sources);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch sources" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    let data: any = {};

    // Nếu là Web URL (từ chức năng "Thêm nguồn")
    if (body.source_url) {
      const url = body.source_url;
      let pageTitle = body.source_name || url; // Mặc định là user input hoặc URL

      try {
        // Fetch URL để lấy metadata (title)
        const res = await fetch(url, { 
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeBot/1.0)' } 
        });
        if (res.ok) {
          const html = await res.text();
          // Regex đơn giản để lấy nội dung thẻ <title>
          const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (match && match[1]) {
            pageTitle = match[1].trim();
          }
        }
      } catch (err) {
        console.error("Error fetching URL metadata:", err);
        // Nếu lỗi fetch thì vẫn giữ title mặc định và tiếp tục lưu
      }

      data = {
        drive_file_id: url,          // Lưu URL vào drive_file_id
        drive_name: pageTitle,       // Lưu Title lấy được vào drive_name
        sheet_name: "WEB_URL",       // Đánh dấu loại (tận dụng trường sheet_name)
        hash: body.refresh_frequency // Tận dụng trường hash để lưu frequency
      };
    } else {
      // Logic cũ cho Google Drive/Sheet
      data = {
        drive_file_id: body.drive_file_id,
        drive_name: body.drive_name,
        hash: body.hash,
        sheet_name: body.sheet_name,
      };
    }

    const newSource = await prisma.knowledge_sources.create({
      data: data
    });

    return NextResponse.json(newSource, { status: 201 });
  } catch (error) {
    console.error("Failed to add source:", error);
    return NextResponse.json({ error: "Failed to add source" }, { status: 500 });
  }
}


