import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth-utils";

/**
 * @swagger
 * /api/contacts/{id}:
 *   put:
 *     summary: Update a contact
 *     description: Updates contact information
 *     tags:
 *       - Contacts
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Contact updated
 *       403:
 *         description: Forbidden
 *   delete:
 *     summary: Delete a contact
 *     description: Deletes a contact
 *     tags:
 *       - Contacts
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Contact deleted
 *       403:
 *         description: Forbidden
 */

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        await requireRole(["Admin", "Manager", "Sales"]);

        const { id } = await params;
        const body = await req.json();
        const { name, title, phone, email, is_primary, customer_id } = body;

        // If setting as primary, unset other primary contacts for this customer
        if (is_primary && customer_id) {
            await db.contacts.updateMany({
                where: {
                    customer_id,
                    id: { not: id }
                },
                data: { is_primary: false }
            });
        }

        const updatedContact = await db.contacts.update({
            where: { id },
            data: {
                name,
                title,
                phone,
                email,
                is_primary
            }
        });

        return NextResponse.json({
            success: true,
            contact: updatedContact
        });
    } catch (error: any) {
        console.error("Error updating contact:", error);

        if (error.message?.includes("Forbidden") || error.message?.includes("Unauthorized")) {
            return NextResponse.json(
                { error: error.message },
                { status: error.message.includes("Unauthorized") ? 401 : 403 }
            );
        }

        return NextResponse.json(
            { error: "Failed to update contact" },
            { status: 500 }
        );
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        await requireRole(["Admin", "Manager"]);

        const { id } = await params;

        await db.contacts.delete({
            where: { id }
        });

        return NextResponse.json({
            success: true,
            message: "Contact deleted successfully"
        });
    } catch (error: any) {
        console.error("Error deleting contact:", error);

        if (error.message?.includes("Forbidden") || error.message?.includes("Unauthorized")) {
            return NextResponse.json(
                { error: error.message },
                { status: error.message.includes("Unauthorized") ? 401 : 403 }
            );
        }

        return NextResponse.json(
            { error: "Failed to delete contact" },
            { status: 500 }
        );
    }
}
