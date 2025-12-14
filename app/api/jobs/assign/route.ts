import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserWithRole, canAssignToTechnician, requireRole } from "@/lib/auth-utils";

/**
 * @swagger
 * /api/jobs/assign:
 *   post:
 *     summary: Assign a job to a technician
 *     description: Admin can assign to any technician. Manager can only assign to technicians in their department.
 *     tags:
 *       - Jobs
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - technicianId
 *             properties:
 *               jobId:
 *                 type: string
 *               technicianId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Job assigned successfully
 *       403:
 *         description: Forbidden - Cannot assign to technician outside your department
 *       401:
 *         description: Unauthorized
 */
export async function POST(req: NextRequest) {
  try {
    // Require Admin or Manager role
    const currentUser = await requireRole(["Admin", "Manager"]);

    const body = await req.json();
    const { jobId, technicianId } = body;

    if (!jobId || !technicianId) {
      return NextResponse.json(
        { error: "jobId and technicianId are required" },
        { status: 400 }
      );
    }

    // Check if user can assign to this technician
    const canAssign = await canAssignToTechnician(currentUser, technicianId);

    if (!canAssign) {
      return NextResponse.json(
        {
          error:
            "Forbidden: You can only assign jobs to technicians in your department",
        },
        { status: 403 }
      );
    }

    // Update the job
    const updatedJob = await db.jobs.update({
      where: { id: jobId },
      data: {
        assigned_technician_id: technicianId,
        status: "ph_n_c_ng", // "Đã phân công"
      },
      include: {
        users_jobs_assigned_technician_idTousers: {
          select: {
            id: true,
            full_name: true,
            email: true,
          },
        },
        customers: true,
      },
    });

    return NextResponse.json({
      success: true,
      job: updatedJob,
    });
  } catch (error: any) {
    console.error("Error assigning job:", error);

    if (error.message.includes("Unauthorized") || error.message.includes("Forbidden")) {
      return NextResponse.json(
        { error: error.message },
        { status: error.message.includes("Unauthorized") ? 401 : 403 }
      );
    }

    return NextResponse.json(
      { error: "Failed to assign job" },
      { status: 500 }
    );
  }
}
