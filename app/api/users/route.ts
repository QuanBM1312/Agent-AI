import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getCurrentUserWithRole } from "@/lib/auth-utils";

const prisma = new PrismaClient();

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Retrieve a list of users
 *     description: Fetches a list of all users.
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: A list of users.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   full_name:
 *                     type: string
 *                   email:
 *                     type: string
 *                   role:
 *                     type: string
 *                   department:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       name:
 *                         type: string
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const roleFilter = searchParams.get('role');

    // Use shared auth util that returns department_id
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // RBAC: Only Admin and Manager can list users
    if (!["Admin", "Manager"].includes(currentUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let whereClause: any = {};

    // Filter by requested role (e.g., ?role=Technician)
    if (roleFilter) {
      whereClause.role = roleFilter;
    }

    // Manager Scope: Restrict to their own department
    if (currentUser.role === "Manager") {
      if (!currentUser.department_id) {
        // Should not happen for valid managers, but safety check
        return NextResponse.json({ users: [] });
      }
      whereClause.department_id = currentUser.department_id;
    }

    const users = await prisma.users.findMany({
      where: whereClause,
      select: {
        id: true,
        full_name: true,
        email: true,
        role: true,
        department_id: true,
        departments: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        full_name: "asc",
      },
    });

    return NextResponse.json(users); // Return array directly (or object {users} depending on convention, previous was array)
  } catch (error) {
    console.error("Failed to fetch users:", error);
    return NextResponse.json(
      { error: "Unable to fetch users" },
      { status: 500 }
    );
  }
}

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create a new user
 *     description: Adds a new user to the database.
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *               - full_name
 *             properties:
 *               id:
 *                 type: string
 *               full_name:
 *                 type: string
 *               email: string
 *               role: string
 *               department_id: string
 *     responses:
 *       201:
 *         description: The created user.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 full_name:
 *                   type: string
 *                 email:
 *                   type: string
 *                   format: email
 *                 role:
 *                   type: string
 *                 department_id:
 *                   type: string
 *                   format: uuid
 *       400:
 *         description: Bad request, missing full_name.
 */
export async function POST(request: Request) {
  try {
    // For POST /api/users, typically only Admin can create users directly here
    // But check requirements: User Management says "Only Admin can view/create users"
    const currentUser = await getCurrentUserWithRole();
    if (!currentUser || currentUser.role !== 'Admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { id, full_name, email, role, department_id } =
      body;

    if (!full_name) {
      return NextResponse.json(
        { error: "full_name is required" },
        { status: 400 }
      );
    }

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const newUser = await prisma.users.create({
      data: {
        id,
        full_name,
        email,
        role,
        department_id,
      },
    });

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error("Failed to create user:", error);
    return NextResponse.json(
      { error: "Unable to create user" },
      { status: 500 }
    );
  }
}

/**
 * @swagger
 * /api/users:
 *   put:
 *     summary: Update a user's role or department
 *     description: Only Admin can update user details.
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *             properties:
 *               id:
 *                 type: string
 *               role:
 *                 type: string
 *               department_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: User updated successfully.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: User not found.
 */
export async function PUT(request: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();
    if (!currentUser || currentUser.role !== 'Admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { id, role, department_id } = body;

    if (!id) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    // Optional: Validate role enum if needed
    // Optional: Validate department existence if needed

    const updatedUser = await prisma.users.update({
      where: { id },
      data: {
        role,
        department_id,
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error("Failed to update user:", error);
    return NextResponse.json(
      { error: "Unable to update user" },
      { status: 500 }
    );
  }
}

/**
 * @swagger
 * /api/users:
 *   delete:
 *     summary: Delete a user
 *     description: Only Admin can delete users.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted successfully.
 *       403:
 *         description: Forbidden.
 */
export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();
    if (!currentUser || currentUser.role !== 'Admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    await prisma.users.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: "User deleted" });
  } catch (error) {
    console.error("Failed to delete user:", error);
    return NextResponse.json(
      { error: "Unable to delete user" },
      { status: 500 }
    );
  }
}
