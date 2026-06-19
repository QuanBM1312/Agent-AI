import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";

// Singleton db used

/**
 * @swagger
 * /api/customers/{id}:
 *   get:
 *     summary: Retrieve a single customer
 *     description: Fetches a single customer by their ID.
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the customer to retrieve.
 *     responses:
 *       200:
 *         description: A single customer.
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
 *       404:
 *         description: Customer not found.
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

    if (!["Admin", "Manager"].includes(currentUser.role)) {
      return NextResponse.json(
        { error: "Forbidden: You do not have access to customer details" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const customer = await prisma.customers.findUnique({
      where: {
        id: id as string,
      },
      include: {
        contacts: {
          orderBy: [
            { is_primary: "desc" },
            { created_at: "asc" }
          ]
        }
      }
    }
    );
    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    return NextResponse.json(customer);
  } catch (error) {
    console.error("Error fetching customer:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer" },
      { status: 500 }
    );
  }
}

/**
 * @swagger
 * /api/customers/{id}:
 *   patch:
 *     summary: Update a customer
 *     description: Updates a customer's information by their ID.
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the customer to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
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
 *       200:
 *         description: The updated customer.
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
 *       404:
 *         description: Customer not found.
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

    if (!["Admin", "Manager", "Sales"].includes(currentUser.role)) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to update customers" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const allowedData: Record<string, unknown> = {};

    if (body.company_name !== undefined) allowedData.company_name = body.company_name || null;
    if (body.contact_person !== undefined) allowedData.contact_person = body.contact_person;
    if (body.phone !== undefined) allowedData.phone = body.phone || null;
    if (body.address !== undefined) allowedData.address = body.address || null;
    if (body.customer_type !== undefined) allowedData.customer_type = body.customer_type || null;

    if (Object.keys(allowedData).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    const updatedCustomer = await prisma.customers.update({
      where: {
        id: id as string,
      },
      data: allowedData,
    });
    if (!updatedCustomer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    return NextResponse.json(updatedCustomer);
  } catch (error) {
    console.error("Error updating customer:", error);
    return NextResponse.json(
      { error: "Failed to update customer" },
      { status: 500 }
    );
  }
}

/**
 * @swagger
 * /api/customers/{id}:
 *   delete:
 *     summary: Delete a customer
 *     description: Deletes a customer by their ID.
 *     tags: [Customers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the customer to delete.
 *     responses:
 *       204:
 *         description: Customer deleted successfully.
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

    if (!["Admin", "Manager"].includes(currentUser.role)) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to delete customers" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const deletedCustomer = await prisma.customers.delete({
      where: {
        id: id as string,
      },
    });
    if (!deletedCustomer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }
    return NextResponse.json(deletedCustomer, { status: 204 });
  } catch (error) {
    console.error("Error deleting customer:", error);
    return NextResponse.json(
      { error: "Failed to delete customer" },
      { status: 500 }
    );
  }
}
