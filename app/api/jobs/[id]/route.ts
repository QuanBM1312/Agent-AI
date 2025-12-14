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
  } catch (error: any) {
    console.error("Error fetching job:", error);
    return NextResponse.json(
      { error: "Failed to fetch job" },
      { status: 500 }
    );
  }
}
