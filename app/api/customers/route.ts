import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole, requireRole } from "@/lib/auth-utils";

/**
 * @swagger
 * /api/customers:
 *   get:
 *     summary: Get customers list
 *     description: Admin and Manager can view full customer list. Sales CANNOT view customer list (per requirements).
 *     tags: [Customers]
 *     responses:
 *       200:
 *         description: A list of customers.
 *       403:
 *         description: Forbidden - Sales cannot view customer list
 */
import { getPaginationParams, formatPaginatedResponse } from "@/lib/pagination";

export async function GET(req: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // SALES RESTRICTION (Per requirements): Sales cannot view customer list
    if (currentUser.role === "Sales") {
      return NextResponse.json(
        {
          error:
            "Forbidden: Sales role does not have access to customer list",
        },
        { status: 403 }
      );
    }

    // Technicians also cannot view customer list
    if (currentUser.role === "Technician") {
      return NextResponse.json(
        {
          error:
            "Forbidden: Technicians do not have access to customer list",
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");
    const paginationParams = getPaginationParams(req, 20);

    const where = search
      ? {
        OR: [
          { company_name: { contains: search, mode: "insensitive" as const } },
          { contact_person: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search, mode: "insensitive" as const } },
        ],
      }
      : {};

    const [customers, totalCount] = await Promise.all([
      prisma.customers.findMany({
        where,
        include: {
          contacts: {
            orderBy: [
              { is_primary: "desc" },
              { created_at: "asc" }
            ]
          }
        },
        orderBy: { company_name: "asc" },
        skip: paginationParams.skip,
        take: paginationParams.limit,
      }),
      prisma.customers.count({ where }),
    ]);

    return NextResponse.json(formatPaginatedResponse(customers, totalCount, paginationParams));
  } catch (error) {
    console.error("Failed to fetch customers:", error);
    return NextResponse.json(
      { error: "Unable to fetch customers" },
      { status: 500 }
    );
  }
}


/**
 * @swagger
 * /api/customers:
 *   post:
 *     summary: Create a new customer
 *     description: Adds a new customer to the database.
 *     tags: [Customers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - company_name
 *             properties:
 *               company_name:
 *                 type: string
 *               contact_person:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               customer_type:
 *                 type: string
 *     responses:
 *       201:
 *         description: The created customer.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 company_name:
 *                   type: string
 *                 contact_person:
 *                   type: string
 *                 phone:
 *                   type: string
 *                 address:
 *                   type: string
 *                 customer_type:
 *                   type: string
 *       400:
 *         description: Bad request, missing company_name.
 */
export async function POST(request: Request) {
  try {
    await requireRole(["Admin", "Manager", "Sales"]);

    const body = await request.json();
    const { company_name, contact_person, phone, address, customer_type } =
      body;

    if (!company_name) {
      return NextResponse.json(
        { error: "company_name is required" },
        { status: 400 }
      );
    }

    const newCustomer = await prisma.customers.create({
      data: {
        company_name,
        contact_person,
        phone,
        address,
        customer_type,
        contacts: contact_person ? {
          create: {
            name: contact_person,
            phone: phone,
            title: body.contact_title, // Optional title from request
            is_primary: true
          }
        } : undefined
      },
      include: {
        contacts: true
      }
    });

    return NextResponse.json(newCustomer, { status: 201 });
  } catch (error) {
    console.error("Failed to create customer:", error);
    return NextResponse.json(
      { error: "Unable to create customer" },
      { status: 500 }
    );
  }
}
