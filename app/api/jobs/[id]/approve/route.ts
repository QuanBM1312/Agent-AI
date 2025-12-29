import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth-utils";

/**
 * @swagger
 * /api/jobs/{id}/approve:
 *   post:
 *     summary: Approve a job (Manager/Admin only)
 *     description: Changes job status from "Chờ duyệt" to "Hoàn thành" (QC Workflow - Method A)
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
 *         description: Job approved
 *       403:
 *         description: Forbidden
 *       400:
 *         description: Job is not in pending approval status
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // QC WORKFLOW (Phương án A - Mục 4): Only Manager/Admin can approve
    const currentUser = await requireRole(["Admin", "Manager"]);

    const { id } = await params;

    const job = await db.jobs.findUnique({
      where: { id },
      include: {
        users_jobs_assigned_technician_idTousers: {
          select: {
            department_id: true,
          },
        },
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Manager can only approve jobs in their department
    if (currentUser.role === "Manager") {
      if (!currentUser.department_id) {
        return NextResponse.json(
          { error: "Manager must be assigned to a department to approve jobs" },
          { status: 403 }
        );
      }

      const techDeptId = job.users_jobs_assigned_technician_idTousers?.department_id;

      if (!techDeptId) {
        return NextResponse.json(
          { error: "Cannot approve: Technician is not assigned to any department" },
          { status: 403 }
        );
      }

      if (techDeptId !== currentUser.department_id) {
        return NextResponse.json(
          {
            error: "Forbidden: You can only approve jobs in your department",
          },
          { status: 403 }
        );
      }
    }

    // Verify job is in pending approval status
    if (job.status !== "Ch_duy_t") {
      return NextResponse.json(
        {
          error: `Job is not in pending approval status. Current status: ${job.status}`,
        },
        { status: 400 }
      );
    }

    // Approve: Change status to "Hoàn thành"
    const updatedJob = await db.jobs.update({
      where: { id },
      data: {
        status: "Ho_n_th_nh", // "Hoàn thành" - Completed
        actual_end_time: new Date(),
      },
      include: {
        customers: true,
        users_jobs_assigned_technician_idTousers: {
          select: {
            id: true,
            full_name: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      job: updatedJob,
      message: "Công việc đã được duyệt và hoàn thành",
    });
  } catch (error: any) {
    console.error("Error approving job:", error);

    if (error.message.includes("Forbidden") || error.message.includes("Unauthorized")) {
      return NextResponse.json(
        { error: error.message },
        { status: error.message.includes("Unauthorized") ? 401 : 403 }
      );
    }

    return NextResponse.json(
      { error: "Failed to approve job" },
      { status: 500 }
    );
  }
}
