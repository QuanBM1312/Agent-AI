import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserWithRole } from "@/lib/auth-utils";

/**
 * @swagger
 * /api/inventory:
 *   get:
 *     summary: Get inventory (materials and services)
 *     description: Sales can view inventory. Technicians cannot.
 *     tags:
 *       - Inventory
 *     responses:
 *       200:
 *         description: List of materials and services
 *       403:
 *         description: Forbidden
 */
export async function GET(req: NextRequest) {
  try {
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Technicians cannot view inventory (based on requirements)
    if (currentUser.role === "Technician") {
      return NextResponse.json(
        {
          error:
            "Forbidden: Technicians do not have access to inventory",
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    const search = searchParams.get("search");

    let whereClause: any = {};

    if (type) {
      whereClause.type = type;
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { item_code: { contains: search, mode: "insensitive" } },
      ];
    }

    const items = await db.materials_and_services.findMany({
      where: whereClause,
      orderBy: {
        name: "asc",
      },
    });

    return NextResponse.json({ items });
  } catch (error: any) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json(
      { error: "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}
