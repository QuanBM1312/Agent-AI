import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserWithRole, requireRole } from "@/lib/auth-utils";

/**
 * @swagger
 * /api/contacts:
 *   get:
 *     summary: Get contacts for a customer
 *     description: Returns all contacts for a specific customer
 *     tags:
 *       - Contacts
 *     parameters:
 *       - in: query
 *         name: customer_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of contacts
 *       401:
 *         description: Unauthorized
 */
export async function GET(req: NextRequest) {
    try {
        const currentUser = await getCurrentUserWithRole();

        if (!currentUser) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const customerId = searchParams.get("customer_id");

        if (!customerId) {
            return NextResponse.json(
                { error: "customer_id is required" },
                { status: 400 }
            );
        }

        const contacts = await db.contacts.findMany({
            where: { customer_id: customerId },
            orderBy: [
                { is_primary: "desc" },
                { created_at: "asc" }
            ]
        });

        return NextResponse.json({ data: contacts });
    } catch (error) {
        console.error("Failed to fetch contacts:", error);
        return NextResponse.json(
            { error: "Unable to fetch contacts" },
            { status: 500 }
        );
    }
}

/**
 * @swagger
 * /api/contacts:
 *   post:
 *     summary: Create a new contact
 *     description: Adds a new contact for a customer
 *     tags:
 *       - Contacts
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - customer_id
 *               - name
 *             properties:
 *               customer_id:
 *                 type: string
 *               name:
 *                 type: string
 *               title:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               is_primary:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Contact created
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
export async function POST(req: NextRequest) {
    try {
        await requireRole(["Admin", "Manager", "Sales"]);

        const body = await req.json();
        const { customer_id, name, title, phone, email, is_primary } = body;

        if (!customer_id || !name) {
            return NextResponse.json(
                { error: "customer_id and name are required" },
                { status: 400 }
            );
        }

        // If setting as primary, unset other primary contacts for this customer
        if (is_primary) {
            await db.contacts.updateMany({
                where: { customer_id },
                data: { is_primary: false }
            });
        }

        const newContact = await db.contacts.create({
            data: {
                customer_id,
                name,
                title,
                phone,
                email,
                is_primary: is_primary || false
            }
        });

        return NextResponse.json(newContact, { status: 201 });
    } catch (error: any) {
        console.error("Failed to create contact:", error);

        if (error.message?.includes("Forbidden") || error.message?.includes("Unauthorized")) {
            return NextResponse.json(
                { error: error.message },
                { status: error.message.includes("Unauthorized") ? 401 : 403 }
            );
        }

        return NextResponse.json(
            { error: "Unable to create contact" },
            { status: 500 }
        );
    }
}
