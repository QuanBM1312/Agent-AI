import { NextResponse } from "next/server";
import {PrismaClient} from "@prisma/client";

const prisma = new PrismaClient();

/**
 * @swagger
 * /api/customers:
 *   get:
 *     summary: Retrieve a list of customers
 *     description: Fetches a list of all customers.
 *     tags: [Customers]
 *     responses:
 *       200:
 *         description: A list of customers.
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
 *                   company_name:
 *                     type: string
 *                   contact_person:
 *                     type: string
 *                   phone:
 *                     type: string
 *                   address:
 *                     type: string
 *                   customer_type:
 *                     type: string
 */
export async function GET() {
  try {
    const customers = await prisma.customers.findMany({
      orderBy: {
        company_name: "asc",
      },
    });
    return NextResponse.json(customers);
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
