import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";

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
import { getPaginationParams, formatPaginatedResponse } from "@/lib/pagination";

type CalendarEventRow = Record<string, unknown> & {
  full_count: number | bigint | null;
};

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const paginationParams = getPaginationParams(request, 20);

    const eventsResult = await prisma.$queryRaw<CalendarEventRow[]>`
      SELECT 
        *,
        COUNT(*) OVER() as full_count
      FROM public.calendar_events
      ORDER BY start_time ASC
      LIMIT ${paginationParams.limit} OFFSET ${paginationParams.skip}
    `;

    const totalCount = Number(eventsResult[0]?.full_count || 0);
    const events = eventsResult.map((row) => {
      const { full_count, ...rest } = row;
      void full_count;
      return rest;
    });

    return NextResponse.json(formatPaginatedResponse(events, totalCount, paginationParams));
  } catch {
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    // Logic: Trong tương lai, đoạn này sẽ gọi Google Calendar API để tạo event
    // const googleEvent = await googleCalendar.events.insert(...)

    const newEvent = await prisma.calendar_events.create({
      data: {
        title: body.title,
        start_time: new Date(body.start_time),
        end_time: new Date(body.end_time),
        description: body.description,
        created_by_user_id: currentUser.id,
        // google_event_id: googleEvent.id // Lưu lại ID của Google
      }
    });
    return NextResponse.json(newEvent, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}
