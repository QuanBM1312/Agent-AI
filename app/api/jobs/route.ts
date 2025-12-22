import { NextRequest, NextResponse } from "next/server";
import { job_type_enum } from "@prisma/client";
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
      assigned_technician_id, // Legacy single technician (deprecated)
      assigned_technician_ids, // New: array of technician IDs
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

    // Validate technician assignments if provided
    const technicianIds = assigned_technician_ids || (assigned_technician_id ? [assigned_technician_id] : []);

    if (technicianIds.length > 0) {
      for (const techId of technicianIds) {
        const canAssign = await canAssignToTechnician(currentUser, techId);
        if (!canAssign) {
          return NextResponse.json(
            { error: `Forbidden: You cannot assign jobs to technician ${techId}` },
            { status: 403 }
          );
        }
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
        job_type: jobTypeMap[job_type] as job_type_enum, // Map to Prisma Enum
        scheduled_start_time: scheduled_start_time
          ? new Date(scheduled_start_time)
          : null,
        scheduled_end_time: scheduled_end_time
          ? new Date(scheduled_end_time)
          : null,
        notes,
        created_by_user_id: currentUser.id,
        status: "ph_n_c_ng",
        assigned_technician_id: technicianIds[0] || null, // Keep first technician for backward compatibility
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

    // Create job_technicians entries for all assigned technicians
    if (technicianIds.length > 0) {
      await db.job_technicians.createMany({
        data: technicianIds.map((techId: string) => ({
          job_id: newJob.id,
          technician_id: techId,
        })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json(
      {
        success: true,
        job: newJob,
        message: "Job created successfully",
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Error creating job:", error);

    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
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
import { getPaginationParams, formatPaginatedResponse } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const paginationParams = getPaginationParams(req);
    const url = new URL(req.url);
    const search = url.searchParams.get("search");
    const status = url.searchParams.get("status");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");

    // Role-based filter
    let roleFilterSql = "";
    if (currentUser.role === "Technician") {
      roleFilterSql = ` AND assigned_technician_id = '${currentUser.id}'`;
    } else if (currentUser.role === "Manager" && currentUser.department_id) {
      roleFilterSql = ` AND EXISTS (
        SELECT 1 FROM public.users u 
        WHERE u.id = jobs.assigned_technician_id 
        AND u.department_id = '${currentUser.department_id}'
      )`;
    }

    // Build the dynamic WHERE clause
    let filterSql = "WHERE 1=1" + (roleFilterSql || "");
    if (status) filterSql += ` AND status = '${status}'`;
    if (startDate) filterSql += ` AND scheduled_start_time >= '${startDate}'`;
    if (endDate) filterSql += ` AND scheduled_start_time <= '${endDate}'`;
    if (search) {
      filterSql += ` AND (
        job_code ILIKE '%${search}%' OR 
        notes ILIKE '%${search}%' OR
        EXISTS (
          SELECT 1 FROM public.customers c 
          WHERE c.id = j.customer_id 
          AND (c.company_name ILIKE '%${search}%' OR c.contact_person ILIKE '%${search}%' OR c.phone ILIKE '%${search}%')
        )
      )`;
    }

    // Main Query using Raw SQL
    const jobsResult = await db.$queryRaw<any[]>`
      WITH filtered_jobs AS (
        SELECT 
          j.*,
          COUNT(*) OVER() as full_count
        FROM public.jobs j
        ${db.$queryRawUnsafe(filterSql)}
        ORDER BY j.scheduled_start_time DESC
        LIMIT ${paginationParams.limit} OFFSET ${paginationParams.skip}
      )
      SELECT 
        j.*,
        c.company_name as customer_company_name,
        c.contact_person as customer_contact_person,
        c.phone as customer_phone,
        c.address as customer_address,
        u_tech.full_name as tech_full_name,
        u_tech.email as tech_email,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'id', li.id,
            'quantity', li.quantity,
            'materials_and_services', jsonb_build_object(
              'id', ms.id,
              'name', ms.name,
              'unit', ms.unit
            )
          ))
          FROM public.job_line_items li
          JOIN public.materials_and_services ms ON li.material_service_id = ms.id
          WHERE li.job_id = j.id
        ) as line_items,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'users', jsonb_build_object(
              'id', u.id,
              'full_name', u.full_name
            )
          ))
          FROM public.job_technicians jt
          JOIN public.users u ON jt.technician_id = u.id
          WHERE jt.job_id = j.id
        ) as technicians
      FROM filtered_jobs j
      LEFT JOIN public.customers c ON j.customer_id = c.id
      LEFT JOIN public.users u_tech ON j.assigned_technician_id = u_tech.id
    `;

    const totalCount = Number(jobsResult[0]?.full_count || 0);

    // Map Raw SQL result to expected response format (sanitize if needed)
    const jobs = jobsResult.map((j: any) => {
      const mappedJob = {
        ...j,
        customers: {
          id: j.customer_id,
          company_name: j.customer_company_name,
          contact_person: j.customer_contact_person,
          phone: j.customer_phone,
          address: j.customer_address,
        },
        users_jobs_assigned_technician_idTousers: j.tech_full_name ? {
          id: j.assigned_technician_id,
          full_name: j.tech_full_name,
          email: j.tech_email,
        } : null,
        job_line_items: j.line_items || [],
        job_technicians: j.technicians || [],
      };

      // Sales restriction
      if (currentUser.role === "Sales") {
        mappedJob.customers = {
          id: j.customer_id,
          company_name: j.customer_company_name,
        };
      }

      // Technician restriction
      if (currentUser.role === "Technician") {
        return sanitizeJobForTechnician(mappedJob);
      }

      return mappedJob;
    });

    return NextResponse.json(formatPaginatedResponse(jobs, totalCount, paginationParams));
  } catch (error: unknown) {
    console.error("Error fetching jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}
