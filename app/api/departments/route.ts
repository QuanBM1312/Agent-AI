import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";

/**
 * @swagger
 * /api/departments:
 *   get:
 *     summary: Retrieve a list of departments
 *     description: Fetches a list of all departments.
 *     tags: [Departments]
 *     responses:
 *       200:
 *         description: A list of departments.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   name:
 *                     type: string
 */
import { getPaginationParams, formatPaginatedResponse } from "@/lib/pagination";

type DepartmentRow = Record<string, unknown> & {
  full_count: number | bigint | null;
};

export async function GET(req: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const paginationParams = getPaginationParams(req, 20);

    const departmentsResult = await prisma.$queryRaw<DepartmentRow[]>`
      SELECT 
        *,
        COUNT(*) OVER() as full_count
      FROM public.departments
      ORDER BY name ASC
      LIMIT ${paginationParams.limit} OFFSET ${paginationParams.skip}
    `;

    const totalCount = departmentsResult.length > 0 ? Number(departmentsResult[0].full_count) : 0;
    const departments = departmentsResult.map((row) => {
      const { full_count, ...rest } = row;
      void full_count;
      return rest;
    });

    return NextResponse.json(formatPaginatedResponse(departments, totalCount, paginationParams));
  } catch (error) {
    console.error("Failed to fetch departments:", error);
    return NextResponse.json(
      { error: "Unable to fetch departments" },
      { status: 500 }
    );
  }
}

/**
 * @swagger
 * /api/departments:
 *   post:
 *     summary: Create a new department
 *     description: Adds a new department to the database.
 *     tags: [Departments]
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
 *       201:
 *         description: The created department.
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
 *       400:
 *         description: Bad request, missing name.
 */
export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (currentUser.role !== "Admin") {
      return NextResponse.json(
        { error: "Forbidden: Only Admin can create departments" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name } =
      body;

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    const newDepartment = await prisma.departments.create({
      data: {
        name,
      },
    });

    return NextResponse.json(newDepartment, { status: 201 });
  } catch (error) {
    console.error("Failed to create department:", error);
    return NextResponse.json(
      { error: "Unable to create department" },
      { status: 500 }
    );
  }
}
