import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";

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
import { getPaginationParams, formatPaginatedResponse } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const roleFilter = searchParams.get('role');
    const search = searchParams.get('search');

    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // RBAC: Only Admin and Manager can list users
    if (!["Admin", "Manager"].includes(currentUser.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const whereClause: any = {};

    // Search filter
    if (search) {
      whereClause.OR = [
        { full_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Filter by requested role (e.g., ?role=Technician)
    if (roleFilter) {
      whereClause.role = roleFilter;
    }

    let departmentFilterId: string | null = null;
    // Manager Scope: Restrict to their own department
    if (currentUser.role === "Manager") {
      if (!currentUser.department_id) {
        return NextResponse.json({ users: [] });
      }
      departmentFilterId = currentUser.department_id;
    }

    const paginationParams = getPaginationParams(req);
    const currentRole = roleFilter;
    const currentDepartmentId = departmentFilterId || searchParams.get("departmentId");

    const usersResult = search
      ? await prisma.$queryRaw<any[]>`
          SELECT
            u.*,
            COUNT(*) OVER() as full_count,
            d.name as department_name
          FROM public.users u
          LEFT JOIN public.departments d ON u.department_id = d.id
          WHERE (u.full_name ILIKE ${`%${search}%`} OR u.email ILIKE ${`%${search}%`})
          ${currentRole ? Prisma.sql` AND u.role = ${currentRole}::user_role_enum` : Prisma.empty}
          ${currentDepartmentId ? Prisma.sql` AND u.department_id = ${currentDepartmentId}::uuid` : Prisma.empty}
          ORDER BY u.full_name ASC
          LIMIT ${paginationParams.limit} OFFSET ${paginationParams.skip}
        `
      : await prisma.$queryRaw<any[]>`
          SELECT
            u.*,
            COUNT(*) OVER() as full_count,
            d.name as department_name
          FROM public.users u
          LEFT JOIN public.departments d ON u.department_id = d.id
          WHERE 1=1
          ${currentRole ? Prisma.sql` AND u.role = ${currentRole}::user_role_enum` : Prisma.empty}
          ${currentDepartmentId ? Prisma.sql` AND u.department_id = ${currentDepartmentId}::uuid` : Prisma.empty}
          ORDER BY u.full_name ASC
          LIMIT ${paginationParams.limit} OFFSET ${paginationParams.skip}
        `;

    const totalCount = Number(usersResult[0]?.full_count || 0);

    const users = usersResult.map(({ full_count: _, department_name, ...rest }) => ({
      ...rest,
      departments: rest.department_id ? {
        id: rest.department_id,
        name: department_name as string,
      } : null,
    }));

    return NextResponse.json(formatPaginatedResponse(users, totalCount, paginationParams));
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
    const { id, role, department_id, dob, id_card_no, phone_number } = body;

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
        dob: dob ? new Date(dob) : null,
        id_card_no,
        phone_number,
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
