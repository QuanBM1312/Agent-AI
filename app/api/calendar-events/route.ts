import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * @swagger
 * /api/calendar-events:
 *   get:
 *     summary: List calendar events
 *     tags: [Calendar]
 *     responses:
 *       200:
 *         description: List of events
 *   post:
 *     summary: Create a calendar event
 *     tags: [Calendar]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               start_time:
 *                 type: string
 *                 format: date-time
 *               end_time:
 *                 type: string
 *                 format: date-time
 *               description:
 *                 type: string
 *               created_by_user_id:
 *                 type: string
 *     responses:
 *       201:
 *         description: Event created
 */
export async function GET(request: Request) {
  try {
    const events = await prisma.calendar_events.findMany({
      orderBy: { start_time: 'asc' }
    });
    return NextResponse.json(events);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Logic: Trong tương lai, đoạn này sẽ gọi Google Calendar API để tạo event
    // const googleEvent = await googleCalendar.events.insert(...)
    
    const newEvent = await prisma.calendar_events.create({
      data: {
        title: body.title,
        start_time: new Date(body.start_time),
        end_time: new Date(body.end_time),
        description: body.description,
        created_by_user_id: body.created_by_user_id,
        // google_event_id: googleEvent.id // Lưu lại ID của Google
      }
    });
    return NextResponse.json(newEvent, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}


