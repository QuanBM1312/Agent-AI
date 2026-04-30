import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";

// Singleton db used

/**
 * @swagger
 * /api/departments/{id}:
 *   get:
 *     summary: Retrieve a single department
 *     description: Fetches a single department by its ID.
 *     tags: [Departments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the department to retrieve.
 *     responses:
 *       200:
 *         description: A single department.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *       404:
 *         description: Department not found.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const department = await prisma.departments.findUnique({
      where: {
        id: id as string,
      },
    });

    if (!department) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    return NextResponse.json(department);
  } catch (error) {
    console.error("Error fetching department:", error);
    return NextResponse.json(
      { error: "Failed to fetch department" },
      { status: 500 }
    );
  }
}

/**
 * @swagger
 * /api/departments/{id}:
 *   patch:
 *     summary: Update a department
 *     description: Updates a department's name by its ID.
 *     tags: [Departments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the department to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: The updated department.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *       404:
 *         description: Department not found.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (currentUser.role !== "Admin") {
      return NextResponse.json(
        { error: "Forbidden: Only Admin can update departments" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { id } = await params;

    const updatedDepartment = await prisma.departments.update({
      where: { id },
      data: body,
    });

    if (!updatedDepartment) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    return NextResponse.json(updatedDepartment);
  } catch (error) {
    console.error("Error updating department:", error);
    return NextResponse.json(
      { error: "Failed to update department" },
      { status: 500 }
    );
  }
}

/**
 * @swagger
 * /api/departments/{id}:
 *   delete:
 *     summary: Delete a department
 *     description: Deletes a department by its ID.
 *     tags: [Departments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the department to delete.
 *     responses:
 *       204:
 *         description: Department deleted successfully.
 *       500:
 *         description: Server error.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (currentUser.role !== "Admin") {
      return NextResponse.json(
        { error: "Forbidden: Only Admin can delete departments" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const deletedDepartment = await prisma.departments.delete({
      where: { id },
    });

    if (!deletedDepartment) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    return NextResponse.json(deletedDepartment, { status: 204 });
  } catch (error) {
    console.error("Error deleting department:", error);
    return NextResponse.json(
      { error: "Failed to delete department" },
      { status: 500 }
    );
  }
}
