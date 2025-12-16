import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
export async function GET(req: Request) {
  try {
    const { getCurrentUserWithRole } = await import("@/lib/auth-utils");
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // SALES RESTRICTION (Per requirements): Sales cannot view customer list
    // "Sales xem được cả tồn kho, không xem được danh sách khách hàng của công ty"
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

    const url = new URL(req.url);
    const search = url.searchParams.get("search");

    let whereClause: any = {};

    if (search) {
      whereClause.OR = [
        { company_name: { contains: search, mode: "insensitive" } },
        { contact_person: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    const customers = await prisma.customers.findMany({
      where: whereClause,
      orderBy: {
        company_name: "asc",
      },
    });

    return NextResponse.json({ customers });
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
    const { requireRole } = await import("@/lib/auth-utils");
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
      },
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
