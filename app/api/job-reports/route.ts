import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUserWithRole, requireRole } from "@/lib/auth-utils";

/**
 * @swagger
 * /api/job-reports:
 *   post:
 *     summary: Submit a job report
 *     description: Technician submits report with mandatory image or voice. Job status changes to "Chờ duyệt".
 *     tags:
 *       - Job Reports
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - job_id
 *             properties:
 *               job_id:
 *                 type: string
 *               problem_summary:
 *                 type: string
 *               actions_taken:
 *                 type: string
 *               image_urls:
 *                 type: array
 *                 items:
 *                   type: string
 *               voice_message_url:
 *                 type: string
 *               customer_ref:
 *                 type: string
 *     responses:
 *       201:
 *         description: Report submitted successfully
 *       400:
 *         description: Validation error - Image or voice required
 *       401:
 *         description: Unauthorized
 */
export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      job_id,
      problem_summary,
      actions_taken,
      image_urls = [],
      voice_message_url,
      customer_ref,
    } = body;

    if (!job_id) {
      return NextResponse.json(
        { error: "job_id is required" },
        { status: 400 }
      );
    }

    // VALIDATION: Mandatory Image OR Voice (Phương án A - Mục 7)
    if (image_urls.length === 0 && !voice_message_url) {
      return NextResponse.json(
        {
          error:
            "Báo cáo phải có ít nhất 1 hình ảnh hoặc 1 đoạn voice. Vui lòng bổ sung.",
        },
        { status: 400 }
      );
    }

    // Verify job exists and user has access
    const job = await db.jobs.findUnique({
      where: { id: job_id },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Technicians can only report on their assigned jobs
    if (
      currentUser.role === "Technician" &&
      job.assigned_technician_id !== currentUser.id
    ) {
      return NextResponse.json(
        { error: "Forbidden: You can only report on your assigned jobs" },
        { status: 403 }
      );
    }

    // Create the report
    const report = await db.job_reports.create({
      data: {
        job_id,
        created_by_user_id: currentUser.id,
        problem_summary,
        actions_taken,
        image_urls,
        voice_message_url,
        customer_ref,
      },
      include: {
        users: {
          select: {
            id: true,
            full_name: true,
            email: true,
          },
        },
      },
    });

    // QC WORKFLOW (Phương án A - Mục 4): Change job status to "Chờ duyệt"
    await db.jobs.update({
      where: { id: job_id },
      data: {
        status: "Ch_duy_t", // "Chờ duyệt" - Pending Approval
      },
    });

    return NextResponse.json(
      {
        success: true,
        report,
        message: "Báo cáo đã được gửi và đang chờ duyệt",
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error creating job report:", error);
    return NextResponse.json(
      { error: "Failed to create report" },
      { status: 500 }
    );
  }
}

/**
 * @swagger
 * /api/job-reports:
 *   get:
 *     summary: Get job reports
 *     description: Returns reports based on user role and permissions
 *     tags:
 *       - Job Reports
 *     responses:
 *       200:
 *         description: List of reports
 *       401:
 *         description: Unauthorized
 */
import { getPaginationParams, formatPaginatedResponse } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const paginationParams = getPaginationParams(req);
    const url = new URL(req.url);
    const jobId = url.searchParams.get("job_id");
    const search = url.searchParams.get("search");

    // Build the dynamic WHERE clause fragments
    const fragments: Prisma.Sql[] = [];
    if (jobId) fragments.push(Prisma.sql` AND j_rep.job_id = ${jobId}::uuid`);
    
    // Permission Logic
    if (currentUser.role === "Technician") {
      fragments.push(Prisma.sql` AND j_rep.created_by_user_id = ${currentUser.id}`);
    } else if (currentUser.role === "Manager" && currentUser.department_id) {
       fragments.push(Prisma.sql` AND u.department_id = ${currentUser.department_id}::uuid`);
    }

    if (search) {
      const searchPattern = `%${search}%`;
      fragments.push(Prisma.sql` AND (
        j_rep.problem_summary ILIKE ${searchPattern} OR 
        j_rep.actions_taken ILIKE ${searchPattern} OR
        j.job_code ILIKE ${searchPattern} OR
        c.company_name ILIKE ${searchPattern}
      )`);
    }

    const filterFragment = fragments.length > 0 ? Prisma.join(fragments, "") : Prisma.empty;

    const reportsResult = await db.$queryRaw<any[]>`
      SELECT 
        j_rep.*,
        COUNT(*) OVER() as full_count,
        u.full_name as creator_full_name,
        u.email as creator_email,
        j.job_code,
        j.status as job_status,
        c.company_name as customer_company_name,
        c.contact_person as customer_contact_person
      FROM public.job_reports j_rep
      LEFT JOIN public.users u ON j_rep.created_by_user_id = u.id
      LEFT JOIN public.jobs j ON j_rep.job_id = j.id
      LEFT JOIN public.customers c ON j.customer_id = c.id
      WHERE 1=1${filterFragment}
      ORDER BY j_rep.timestamp DESC
      LIMIT ${paginationParams.limit} OFFSET ${paginationParams.skip}
    `;

    const totalCount = reportsResult.length > 0 ? Number(reportsResult[0].full_count) : 0;

    const reports = reportsResult.map(({ full_count: _, ...r }) => ({
      ...r,
      users: {
        id: r.created_by_user_id,
        full_name: r.creator_full_name,
        email: r.creator_email,
      },
      jobs: {
        id: r.job_id,
        job_code: r.job_code,
        status: r.job_status,
        customers: {
          id: r.customer_id,
          company_name: r.customer_company_name,
          contact_person: r.customer_contact_person,
        },
      },
    }));

    return NextResponse.json(formatPaginatedResponse(reports, totalCount, paginationParams));
  } catch (error: unknown) {
    console.error("Error fetching job reports:", error);
    return NextResponse.json(
      { error: "Failed to fetch job reports" },
      { status: 500 }
    );
  }
}