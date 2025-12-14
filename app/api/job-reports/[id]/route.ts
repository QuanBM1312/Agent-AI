import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth-utils";

/**
 * @swagger
 * /api/job-reports/{id}:
 *   put:
 *     summary: Update a job report (Admin/Manager only)
 *     description: Only Admin and Manager can edit reports (Data Integrity - Method A)
 *     tags:
 *       - Job Reports
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Report updated
 *       403:
 *         description: Forbidden
 *   delete:
 *     summary: Delete a job report (Admin only)
 *     description: Only Admin can delete reports (Data Integrity - Method A)
 *     tags:
 *       - Job Reports
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Report deleted
 *       403:
 *         description: Forbidden
 */

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // DATA INTEGRITY (Phương án A - Mục 5): Only Admin/Manager can edit
    await requireRole(["Admin", "Manager"]);

    const { id } = await params;
    const body = await req.json();

    const updatedReport = await db.job_reports.update({
      where: { id },
      data: {
        problem_summary: body.problem_summary,
        actions_taken: body.actions_taken,
        image_urls: body.image_urls,
        voice_message_url: body.voice_message_url,
        customer_ref: body.customer_ref,
      },
    });

    return NextResponse.json({
      success: true,
      report: updatedReport,
    });
  } catch (error: any) {
    console.error("Error updating report:", error);

    if (error.message.includes("Forbidden")) {
      return NextResponse.json(
        {
          error:
            "Chỉ Admin/Manager mới được phép chỉnh sửa báo cáo (Data Integrity Policy)",
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: "Failed to update report" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // DATA INTEGRITY (Phương án A - Mục 5): Only Admin can delete
    await requireRole(["Admin"]);

    const { id } = await params;

    await db.job_reports.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: "Report deleted successfully",
    });
  } catch (error: any) {
    console.error("Error deleting report:", error);

    if (error.message.includes("Forbidden")) {
      return NextResponse.json(
        {
          error: "Chỉ Admin mới được phép xóa báo cáo (Data Integrity Policy)",
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: "Failed to delete report" },
      { status: 500 }
    );
  }
}
