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
    const { getCurrentUserWithRole } = await import("@/lib/auth-utils");
    const currentUser = await getCurrentUserWithRole();

    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Technicians cannot view inventory
    if (currentUser.role === "Technician") {
      return NextResponse.json(
        {
          error: "Forbidden: Technicians do not have access to inventory",
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");

    let whereClause: any = {};

    if (search) {
      whereClause.OR = [
        { model_name: { contains: search, mode: "insensitive" } },
        { product_code: { contains: search, mode: "insensitive" } },
      ];
    }

    // 1. Fetch Products
    const products = await db.dim_product.findMany({
      where: whereClause,
      orderBy: {
        model_name: "asc",
      },
    });

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    // 2. Fetch Opening Stock (Current Month)
    const openings = await db.inventory_month_opening.findMany({
      where: {
        year: currentYear,
        month: currentMonth,
        product_id: { in: products.map((p: any) => p.product_id) },
      },
    });

    // 3. Fetch Movements (Current Month)
    const movements = await db.inventory_daily_movement.findMany({
      where: {
        year: currentYear,
        month: currentMonth,
        product_id: { in: products.map((p: any) => p.product_id) },
      },
    });

    // 4. Calculate Stock
    const inventory = products.map((p: any) => {
      // Find opening
      const open = openings.find((o: any) => o.product_id === p.product_id);
      const openingQty = open ? Number(open.opening_qty) : 0;

      // Sum movements
      const productMovements = movements.filter((m: any) => m.product_id === p.product_id);
      const totalIn = productMovements.reduce((sum: number, m: any) => sum + Number(m.in_qty), 0);
      const totalOut = productMovements.reduce((sum: number, m: any) => sum + Number(m.out_qty), 0);

      const currentStock = openingQty + totalIn - totalOut;

      return {
        id: p.product_code, // Use code as ID for frontend
        item_code: p.product_code,
        name: p.model_name,
        unit: p.unit,
        quantity: currentStock,
        details: {
          opening: openingQty,
          in: totalIn,
          out: totalOut
        }
      };
    });

    return NextResponse.json({ items: inventory });
  } catch (error: any) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json(
      { error: "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}
