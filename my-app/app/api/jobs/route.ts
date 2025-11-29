import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * @swagger
 * /api/jobs:
 *   get:
 *     summary: List jobs
 *     tags: [Jobs]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by job status (e.g., M_i, ph_n_c_ng, ang_th_c_hi_n, Ho_n_th_nh)
 *       - in: query
 *         name: technician_id
 *         schema:
 *           type: string
 *         description: Filter by assigned technician ID
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by scheduled start date (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: List of jobs
 *   post:
 *     summary: Create a new job
 *     tags: [Jobs]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - job_code
 *               - customer_id
 *               - status
 *             properties:
 *               job_code:
 *                 type: string
 *               customer_id:
 *                 type: string
 *                 format: uuid
 *               assigned_technician_id:
 *                 type: string
 *                 format: uuid
 *               status:
 *                 type: string
 *                 enum: [M_i, ph_n_c_ng, ang_th_c_hi_n, Ho_n_th_nh, Treo]
 *               scheduled_start_time:
 *                 type: string
 *                 format: date-time
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Job created
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const technician_id = searchParams.get("technician_id");
    const dateStr = searchParams.get("date");

    const whereClause: any = {};
    if (status) whereClause.status = status;
    if (technician_id) whereClause.assigned_technician_id = technician_id;
    
    if (dateStr) {
      // Filter by date range for that specific day
      const start = new Date(dateStr);
      const end = new Date(dateStr);
      end.setDate(end.getDate() + 1);
      
      whereClause.scheduled_start_time = {
        gte: start,
        lt: end,
      };
    }

    const jobs = await prisma.jobs.findMany({
      where: whereClause,
      include: {
        customers: {
          select: {
            company_name: true,
            contact_person: true,
            address: true
          }
        },
        users_jobs_assigned_technician_idTousers: {
            select: {
                full_name: true,
                email: true
            }
        }
      },
      orderBy: {
        scheduled_start_time: 'asc', // Công việc sắp tới lên đầu
      },
    });

    return NextResponse.json(jobs);
  } catch (error) {
    console.error("Failed to fetch jobs:", error);
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Validation cơ bản
    if (!body.job_code || !body.customer_id) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const newJob = await prisma.jobs.create({
      data: {
        job_code: body.job_code,
        customer_id: body.customer_id,
        assigned_technician_id: body.assigned_technician_id,
        status: body.status || 'M_i', // Mặc định là Mới
        scheduled_start_time: body.scheduled_start_time ? new Date(body.scheduled_start_time) : null,
        notes: body.notes
      }
    });

    return NextResponse.json(newJob, { status: 201 });
  } catch (error) {
    console.error("Failed to create job:", error);
    return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
  }
}

