import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserWithRole, sanitizeJobForTechnician, canAssignToTechnician } from "@/lib/auth-utils";

/**
 * @swagger
 * /api/jobs:
 *   post:
 *     summary: Create a new job
 *     description: Admin and Manager can create new jobs. Job is created with status "Mới" (New).
 *     tags:
 *       - Jobs
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - job_code
 *               - customer_id
 *               - job_type
 *             properties:
 *               job_code:
 *                 type: string
 *               customer_id:
 *                 type: string
 *               job_type:
 *                 type: string
 *                 enum: ["Lắp đặt mới", "Bảo hành", "Sửa chữa"]
 *               scheduled_start_time:
 *                 type: string
 *                 format: date-time
 *               scheduled_end_time:
 *                 type: string
 *                 format: date-time
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Job created successfully
 *       400:
 *         description: Bad request - Missing required fields
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Only Admin and Manager can create jobs
 */
export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // RBAC: Only Admin and Manager can create jobs
    if (!["Admin", "Manager"].includes(currentUser.role)) {
      return NextResponse.json(
        { error: "Forbidden: Only Admin and Manager can create jobs" },
        { status: 403 }
      );
    }

    const body = await req.json();
    console.log("POST /api/jobs payload:", body);

    const {
      job_code,
      customer_id,
      job_type,
      scheduled_start_time,
      scheduled_end_time,
      notes,
      assigned_technician_id, // Extract new field
    } = body;

    // Validate required fields
    if (!job_code || !customer_id || !job_type) {
      console.log("Missing required fields:", { job_code, customer_id, job_type });
      return NextResponse.json(
        { error: "job_code, customer_id, and job_type are required" },
        { status: 400 }
      );
    }

    // Validate job_type enum
    const validJobTypes = ["Lắp đặt mới", "Bảo hành", "Sửa chữa"];
    if (!validJobTypes.includes(job_type)) {
      console.log("Invalid job_type:", job_type);
      return NextResponse.json(
        {
          error: `Invalid job_type. Must be one of: ${validJobTypes.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate technician assignment if provided
    if (assigned_technician_id) {
      const canAssign = await canAssignToTechnician(currentUser, assigned_technician_id);
      if (!canAssign) {
        return NextResponse.json(
          { error: "Forbidden: You cannot assign jobs to this technician" },
          { status: 403 }
        );
      }
    }

    // Map display string to Prisma Enum Key
    const jobTypeMap: Record<string, string> = {
      "Lắp đặt mới": "L_p___t_m_i",
      "Bảo hành": "B_o_h_nh",
      "Sửa chữa": "S_a_ch_a",
    };

    // Check if customer exists
    const customer = await db.customers.findUnique({
      where: { id: customer_id },
    });

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    // Create the job
    const newJob = await db.jobs.create({
      data: {
        job_code,
        customer_id,
        job_type: jobTypeMap[job_type] as any, // Map to Prisma Enum Key
        scheduled_start_time: scheduled_start_time
          ? new Date(scheduled_start_time)
          : null,
        scheduled_end_time: scheduled_end_time
          ? new Date(scheduled_end_time)
          : null,
        notes,
        created_by_user_id: currentUser.id,
        status: "M_i", // "Mới" - New job status
        assigned_technician_id: assigned_technician_id || null, // Atomic assignment
      },
      include: {
        customers: true,
        users_jobs_created_by_user_idTousers: {
          select: {
            id: true,
            full_name: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        job: newJob,
        message: "Job created successfully",
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Error creating job:", error);

    // Handle unique constraint violation (duplicate job_code)
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Job code already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create job" },
      { status: 500 }
    );
  }
}

/**
 * @swagger
 * /api/jobs:
 *   get:
 *     summary: Get jobs list
 *     description: Returns jobs based on user role. Technicians only see their assigned jobs with financial data hidden.
 *     tags:
 *       - Jobs
 *     responses:
 *       200:
 *         description: List of jobs
 *       401:
 *         description: Unauthorized
 */
export async function GET(req: NextRequest) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let jobs;

    // Technicians only see their assigned jobs
    if (currentUser.role === "Technician") {
      jobs = await db.jobs.findMany({
        where: {
          assigned_technician_id: currentUser.id,
        },
        include: {
          customers: true,
          job_line_items: {
            include: {
              materials_and_services: true,
            },
          },
          users_jobs_assigned_technician_idTousers: {
            select: {
              id: true,
              full_name: true,
              email: true,
            },
          },
        },
        orderBy: {
          scheduled_start_time: "desc",
        },
      });

      // Sanitize financial data for technicians
      jobs = jobs.map((job: any) => sanitizeJobForTechnician(job));
    }
    // Sales: Can see jobs but with limited customer info (based on requirements)
    else if (currentUser.role === "Sales") {
      jobs = await db.jobs.findMany({
        include: {
          customers: {
            select: {
              id: true,
              company_name: true,
              // Hide contact details from Sales
            },
          },
          job_line_items: {
            include: {
              materials_and_services: true,
            },
          },
        },
        orderBy: {
          scheduled_start_time: "desc",
        },
      });
    }
    // Admin and Manager see everything
    else {
      // Manager only sees jobs in their department
      const whereClause =
        currentUser.role === "Manager" && currentUser.department_id
          ? {
            users_jobs_assigned_technician_idTousers: {
              department_id: currentUser.department_id,
            },
          }
          : {};

      jobs = await db.jobs.findMany({
        where: whereClause,
        include: {
          customers: true,
          job_line_items: {
            include: {
              materials_and_services: true,
            },
          },
          users_jobs_assigned_technician_idTousers: {
            select: {
              id: true,
              full_name: true,
              email: true,
              departments: true,
            },
          },
        },
        orderBy: {
          scheduled_start_time: "desc",
        },
      });
    }

    return NextResponse.json({ jobs });
  } catch (error: any) {
    console.error("Error fetching jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}
