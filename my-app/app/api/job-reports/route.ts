import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { triggerN8nWorkflow } from "@/lib/n8n";

const prisma = new PrismaClient();

/**
 * @swagger
 * /api/job-reports:
 *   get:
 *     summary: Retrieve job reports
 *     description: Fetches job reports. Can be filtered by job_id or created_by_user_id.
 *     tags: [Job Reports]
 *     parameters:
 *       - in: query
 *         name: job_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter reports by Job ID
 *       - in: query
 *         name: created_by_user_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter reports by Technician/User ID
 *     responses:
 *       200:
 *         description: List of job reports
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   problem_summary:
 *                     type: string
 *                   actions_taken:
 *                     type: string
 *                   image_urls:
 *                     type: array
 *                     items:
 *                       type: string
 *                   voice_message_url:
 *                     type: string
 *                   timestamp:
 *                     type: string
 *                     format: date-time
 *                   jobs:
 *                     type: object
 *                     properties:
 *                       job_code:
 *                         type: string
 *                   users:
 *                     type: object
 *                     properties:
 *                       full_name:
 *                         type: string
 *       500:
 *         description: Server error
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const job_id = searchParams.get("job_id");
    const created_by_user_id = searchParams.get("created_by_user_id");

    const whereClause: any = {};
    if (job_id) whereClause.job_id = job_id;
    if (created_by_user_id) whereClause.created_by_user_id = created_by_user_id;

    const reports = await prisma.job_reports.findMany({
      where: whereClause,
      include: {
        jobs: {
          select: {
            job_code: true, // Lấy thêm mã công việc để hiển thị cho rõ
          },
        },
        users: {
          select: {
            full_name: true, // Lấy tên người báo cáo
          },
        },
      },
      orderBy: {
        timestamp: "desc", // Báo cáo mới nhất lên đầu
      },
    });

    return NextResponse.json(reports);
  } catch (error) {
    console.error("Failed to fetch job reports:", error);
    return NextResponse.json(
      { error: "Unable to fetch job reports" },
      { status: 500 }
    );
  }
}

/**
 * @swagger
 * /api/job-reports:
 *   post:
 *     summary: Create a new job report
 *     tags: [Job Reports]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - created_by_user_id
 *             properties:
 *               job_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *               customer_ref:
 *                 type: string
 *                 description: "Tên khách hàng (nếu không có Job ID)"
 *               created_by_user_id:
 *                 type: string
 *                 format: uuid
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
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      job_id,
      customer_ref, // Trường mới
      created_by_user_id,
      problem_summary,
      actions_taken,
      image_urls,
      voice_message_url,
    } = body;

    // Validation: Cần ít nhất Job ID HOẶC Tên khách hàng
    if (!created_by_user_id) {
        return NextResponse.json({ error: "created_by_user_id is required" }, { status: 400 });
    }

    if (!job_id && !customer_ref) {
      return NextResponse.json(
        { error: "Either job_id OR customer_ref is required" },
        { status: 400 }
      );
    }

    const newReport = await prisma.job_reports.create({
      data: {
        job_id: job_id || null, // Chấp nhận null
        customer_ref: customer_ref || null,
        created_by_user_id,
        problem_summary,
        actions_taken,
        image_urls: image_urls || [],
        voice_message_url,
      },
    });

    // Gọi n8n để xử lý tiếp (Gửi thông báo, phân tích AI...)
    triggerN8nWorkflow("process-new-report", {
      report_id: newReport.id,
      technician_id: newReport.created_by_user_id,
      summary: newReport.problem_summary,
      timestamp: newReport.timestamp,
      customer_ref: newReport.customer_ref
    });

    return NextResponse.json(newReport, { status: 201 });
  } catch (error) {
    console.error("Failed to create job report:", error);
    return NextResponse.json(
      { error: "Unable to create job report" },
      { status: 500 }
    );
  }
}