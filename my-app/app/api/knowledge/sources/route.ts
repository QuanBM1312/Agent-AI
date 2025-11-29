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
 *               - source_name
 *               - source_type
 *             properties:
 *               source_name:
 *                 type: string
 *               source_type:
 *                 type: string
 *                 enum: [FILE, GOOGLE_SHEET, WEB_URL]
 *               source_url:
 *                 type: string
 *               refresh_frequency:
 *                 type: string
 *     responses:
 *       201:
 *         description: Source added
 */
export async function GET() {
  try {
    const sources = await prisma.knowledge_sources.findMany({
      orderBy: { last_updated_at: 'desc' }
    });
    return NextResponse.json(sources);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch sources" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Nếu là Google Sheet, chúng ta chỉ lưu URL chứ không upload file
    const newSource = await prisma.knowledge_sources.create({
      data: {
        source_name: body.source_name,
        source_type: body.source_type,
        source_url: body.source_url,
        refresh_frequency: body.refresh_frequency,
        last_updated_at: new Date(),
        // Metadata bổ sung cho việc xử lý sau này
        metadata: body.source_type === 'GOOGLE_SHEET' ? { status: 'pending_sync' } : {} 
      }
    });

    return NextResponse.json(newSource, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to add source" }, { status: 500 });
  }
}


