import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { requireRole } from "@/lib/auth-utils";
import { db } from "@/lib/db";

/**
 * @swagger
 * /api/admin/users:
 *   post:
 *     summary: Create a new user (Admin only)
 *     description: Admin creates user via Clerk and sets role/department in metadata
 *     tags:
 *       - Admin
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - role
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [Admin, Manager, Sales, Technician]
 *               departmentId:
 *                 type: string
 *     responses:
 *       201:
 *         description: User created successfully
 *       403:
 *         description: Forbidden - Admin only
 */
export async function POST(req: NextRequest) {
  try {
    // USER ONBOARDING (Phương án A - Mục 6): Only Admin can create users
    await requireRole(["Admin"]);

    const body = await req.json();
    const { email, password, firstName, lastName, role, departmentId } = body;

    if (!email || !password || !role) {
      return NextResponse.json(
        { error: "email, password, and role are required" },
        { status: 400 }
      );
    }

    // Validate role
    const validRoles = ["Admin", "Manager", "Sales", "Technician"];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role.Must be one of: ${validRoles.join(", ")} ` },
        { status: 400 }
      );
    }

    // If role is Manager or Technician, department is required
    if ((role === "Manager" || role === "Technician") && !departmentId) {
      return NextResponse.json(
        { error: `Department is required for ${role} role` },
        { status: 400 }
      );
    }

    // Verify department exists if provided
    if (departmentId) {
      const department = await db.departments.findUnique({
        where: { id: departmentId },
      });

      if (!department) {
        return NextResponse.json(
          { error: "Department not found" },
          { status: 404 }
        );
      }
    }

    // Create user in Clerk with metadata
    const client = await clerkClient();
    const clerkUser = await client.users.createUser({
      emailAddress: [email],
      password: password,
      firstName: firstName,
      lastName: lastName,
      publicMetadata: {
        role: role,
        department_id: departmentId || null,
      },
    });

    // Webhook will automatically create user in our database
    // with role and department from metadata

    return NextResponse.json(
      {
        success: true,
        message: "User created successfully. They can now sign in.",
        user: {
          id: clerkUser.id,
          email: email,
          role: role,
          departmentId: departmentId,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Error creating user:", error);

    if (error.message?.includes("Forbidden") || error.message?.includes("Unauthorized")) {
      return NextResponse.json(
        { error: "Only Admin can create users" },
        { status: 403 }
      );
    }

    // Clerk-specific errors
    if (error.errors) {
      return NextResponse.json(
        { error: error.errors[0]?.message || "Failed to create user in Clerk" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
}

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get all users (Admin only)
 *     description: Returns list of all users with their roles and departments
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: List of users
 *       403:
 *         description: Forbidden
 */
import { getPaginationParams, formatPaginatedResponse } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  try {
    await requireRole(["Admin"]);

    const paginationParams = getPaginationParams(req);

    const usersResult = await db.$queryRaw<any[]>`
      SELECT 
        u.*,
        COUNT(*) OVER() as full_count,
        d.name as department_name
      FROM public.users u
      LEFT JOIN public.departments d ON u.department_id = d.id
      ORDER BY u.email ASC
      LIMIT ${paginationParams.limit} OFFSET ${paginationParams.skip}
    `;

    const totalCount = Number(usersResult[0]?.full_count || 0);

    const users = usersResult.map(({ full_count: _, department_name, ...rest }) => ({
      ...rest,
      departments: rest.department_id ? {
        id: rest.department_id,
        name: department_name,
      } : null,
    }));

    return NextResponse.json(formatPaginatedResponse(users, totalCount, paginationParams));
  } catch (error: unknown) {
    console.error("Error fetching users:", error);

    if (error instanceof Error && (error.message?.includes("Forbidden") || error.message?.includes("Unauthorized"))) {
      return NextResponse.json(
        { error: "Only Admin can view all users" },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 }
    );
  }
}
