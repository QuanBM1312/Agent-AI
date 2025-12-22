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
import { getPaginationParams, formatPaginatedResponse } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  try {
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
    const paginationParams = getPaginationParams(req, 20);

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    // 1. Fetch Products with optimized Raw SQL to aggregate stock in 1 query
    const productsResult = search
      ? await db.$queryRaw<any[]>`
          SELECT 
            p.product_id, 
            p.product_code, 
            p.model_name, 
            p.unit,
            COALESCE(CAST(o.opening_qty AS FLOAT), 0) as opening,
            COALESCE(CAST(SUM(m.in_qty) AS FLOAT), 0) as total_in,
            COALESCE(CAST(SUM(m.out_qty) AS FLOAT), 0) as total_out,
            COUNT(*) OVER() as full_count
          FROM public.dim_product p
          LEFT JOIN public.inventory_month_opening o ON p.product_id = o.product_id 
            AND o.year = ${currentYear} AND o.month = ${currentMonth}
          LEFT JOIN public.inventory_daily_movement m ON p.product_id = m.product_id 
            AND m.year = ${currentYear} AND m.month = ${currentMonth}
          WHERE (p.model_name ILIKE ${`%${search}%`} OR p.product_code ILIKE ${`%${search}%`})
          GROUP BY p.product_id, p.product_code, p.model_name, p.unit, o.opening_qty
          ORDER BY p.model_name ASC
          LIMIT ${paginationParams.limit} OFFSET ${paginationParams.skip}
        `
      : await db.$queryRaw<any[]>`
          SELECT 
            p.product_id, 
            p.product_code, 
            p.model_name, 
            p.unit,
            COALESCE(CAST(o.opening_qty AS FLOAT), 0) as opening,
            COALESCE(CAST(SUM(m.in_qty) AS FLOAT), 0) as total_in,
            COALESCE(CAST(SUM(m.out_qty) AS FLOAT), 0) as total_out,
            COUNT(*) OVER() as full_count
          FROM public.dim_product p
          LEFT JOIN public.inventory_month_opening o ON p.product_id = o.product_id 
            AND o.year = ${currentYear} AND o.month = ${currentMonth}
          LEFT JOIN public.inventory_daily_movement m ON p.product_id = m.product_id 
            AND m.year = ${currentYear} AND m.month = ${currentMonth}
          GROUP BY p.product_id, p.product_code, p.model_name, p.unit, o.opening_qty
          ORDER BY p.model_name ASC
          LIMIT ${paginationParams.limit} OFFSET ${paginationParams.skip}
        `;

    const totalCount = Number(productsResult[0]?.full_count || 0);
    const products = productsResult;

    // 2. Map Raw SQL result to expected response format
    const inventory = products.map((p: any) => {
      const currentStock = p.opening + p.total_in - p.total_out;

      return {
        id: p.product_code,
        item_code: p.product_code,
        name: p.model_name,
        unit: p.unit,
        quantity: currentStock,
        details: {
          opening: p.opening,
          in: p.total_in,
          out: p.total_out
        }
      };
    });

    return NextResponse.json(formatPaginatedResponse(inventory, totalCount, paginationParams));
  } catch (error: unknown) {
    console.error("Error fetching inventory:", error);
    return NextResponse.json(
      { error: "Failed to fetch inventory" },
      { status: 500 }
    );
  }
}
