import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserWithRole, sanitizeJobForTechnician } from "@/lib/auth-utils";

/**
 * @swagger
 * /api/jobs/{id}:
 *   get:
 *     summary: Get job details
 *     description: Returns job details. Financial data is hidden for Technicians.
 *     tags:
 *       - Jobs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job details
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Cannot access this job
 *       404:
 *         description: Job not found
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const job = await db.jobs.findUnique({
      where: { id },
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
        job_technicians: {
          include: {
            users: {
              select: {
                id: true,
                full_name: true,
              },
            },
          },
        },
        job_reports: {
          include: {
            users: {
              select: {
                id: true,
                full_name: true,
                email: true,
              },
            },
          },
          orderBy: {
            timestamp: "desc",
          },
        },
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Technicians can only view their assigned jobs
    if (currentUser.role === "Technician") {
      if (job.assigned_technician_id !== currentUser.id) {
        return NextResponse.json(
          { error: "Forbidden: You can only view your assigned jobs" },
          { status: 403 }
        );
      }

      // Sanitize financial data
      const sanitizedJob = sanitizeJobForTechnician(job);
      return NextResponse.json({ job: sanitizedJob });
    }

    // Manager can only view jobs in their department
    if (currentUser.role === "Manager" && currentUser.department_id) {
      const assignedTech = job.users_jobs_assigned_technician_idTousers;
      if (assignedTech && assignedTech.departments?.id !== currentUser.department_id) {
        return NextResponse.json(
          { error: "Forbidden: You can only view jobs in your department" },
          { status: 403 }
        );
      }
    }

    // Admin and authorized Manager/Sales see full data
    return NextResponse.json({ job });
  } catch (error: unknown) {
    console.error("Error fetching job:", error);
    return NextResponse.json(
      { error: "Failed to fetch job" },
      { status: 500 }
    );
  }
}

/**
 * @swagger
 * /api/jobs/{id}:
 *   patch:
 *     summary: Update job details
 *     description: Admin and Manager can update jobs.
 *     tags:
 *       - Jobs
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Job updated successfully
 *       400:
 *         description: Bad request
 *       403:
 *         description: Forbidden
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUserWithRole();
    if (!currentUser || !["Admin", "Manager"].includes(currentUser.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const {
      job_code,
      customer_id,
      job_type,
      scheduled_start_time,
      scheduled_end_time,
      notes,
      status,
      assigned_technician_ids
    } = body;

    const jobTypeMap: Record<string, string> = {
      "Lắp đặt mới": "L_p___t_m_i",
      "Bảo hành": "B_o_h_nh",
      "Sửa chữa": "S_a_ch_a",
    };

    const statusMap: Record<string, string> = {
      "Mới": "ph_n_c_ng",
      "Đang xử lý": "Ch_duy_t",
      "Hoàn thành": "Ho_n_th_nh"
    };

    // Update job in a transaction to handle technicians
    const updatedJob = await db.$transaction(async (tx: unknown) => {
      const data: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transaction = tx as any;
      if (job_code) data.job_code = job_code;
      if (customer_id) data.customer_id = customer_id;
      if (job_type && jobTypeMap[job_type]) data.job_type = jobTypeMap[job_type];
      if (scheduled_start_time) data.scheduled_start_time = new Date(scheduled_start_time);
      if (scheduled_end_time) data.scheduled_end_time = new Date(scheduled_end_time);
      if (notes !== undefined) data.notes = notes;
      if (status) data.status = statusMap[status] || status;

      // Handle technicians
      if (assigned_technician_ids !== undefined) {
        // Remove old associations
        await transaction.job_technicians.deleteMany({
          where: { job_id: id }
        });

        // Add new associations
        if (assigned_technician_ids.length > 0) {
          await transaction.job_technicians.createMany({
            data: assigned_technician_ids.map((techId: string) => ({
              job_id: id,
              technician_id: techId
            }))
          });
          // Update the legacy back-link for compatibility
          data.assigned_technician_id = assigned_technician_ids[0];
        } else {
          data.assigned_technician_id = null;
        }
      }

      return await transaction.jobs.update({
        where: { id },
        data,
        include: {
          customers: true,
          users_jobs_assigned_technician_idTousers: {
            select: { id: true, full_name: true, email: true }
          }
        }
      });
    });

    return NextResponse.json({ success: true, job: updatedJob });
  } catch (error: unknown) {
    console.error("Error updating job:", error);
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
  }
}
