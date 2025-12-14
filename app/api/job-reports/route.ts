import { NextRequest, NextResponse } from "next/server";
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
  } catch (error: any) {
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
export async function GET(req: NextRequest) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("job_id");

    let whereClause: any = {};

    // Filter by job_id if provided
    if (jobId) {
      whereClause.job_id = jobId;
    }

    // Technicians only see their own reports
    if (currentUser.role === "Technician") {
      whereClause.created_by_user_id = currentUser.id;
    }

    const reports = await db.job_reports.findMany({
      where: whereClause,
      include: {
        users: {
          select: {
            id: true,
            full_name: true,
            email: true,
          },
        },
        jobs: {
          select: {
            id: true,
            job_code: true,
            status: true,
            customers: {
              select: {
                id: true,
                company_name: true,
                contact_person: true,
              },
            },
          },
        },
      },
      orderBy: {
        timestamp: "desc",
      },
    });

    return NextResponse.json({ reports });
  } catch (error: any) {
    console.error("Error fetching reports:", error);
    return NextResponse.json(
      { error: "Failed to fetch reports" },
      { status: 500 }
    );
  }
}