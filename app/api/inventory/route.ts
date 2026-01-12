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

    const totalCount = productsResult.length > 0 ? Number(productsResult[0].full_count) : 0;
    const products = productsResult;

    // 2. Map Raw SQL result to expected response format
    const inventory = products.map(({ full_count: _, ...p }) => {
      const currentStock = Number(p.opening) + Number(p.total_in) - Number(p.total_out);

      return {
        id: p.product_id.toString(),
        item_code: p.product_code,
        name: p.model_name,
        unit: p.unit,
        quantity: currentStock,
        details: {
          opening: Number(p.opening),
          in: Number(p.total_in),
          out: Number(p.total_out)
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

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentUserWithRole();
    if (!currentUser || currentUser.role === "Technician") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { product_code, model_name, unit, opening_qty } = await req.json();

    if (!product_code || !model_name || !unit) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 1. Create Product
    const newProduct = await db.dim_product.create({
      data: {
        product_code,
        model_name,
        unit,
      },
    });

    // 2. Initialize opening stock for current month if provided
    if (opening_qty !== undefined) {
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;

      await db.inventory_month_opening.create({
        data: {
          year: currentYear,
          month: currentMonth,
          product_id: newProduct.product_id,
          opening_qty: Number(opening_qty),
          note: "Khởi tạo khi tạo sản phẩm mới",
        },
      });
    }

    return NextResponse.json({ data: newProduct });
  } catch (error: any) {
    console.error("Error creating product:", error);
    if (error.code === 'P2002') {
      return NextResponse.json({ error: "Mã sản phẩm đã tồn tại" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const currentUser = await getCurrentUserWithRole();
    if (!currentUser || currentUser.role === "Technician") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { product_id, product_code, model_name, unit, opening_qty, total_in, total_out } = await req.json();

    if (!product_id) {
      return NextResponse.json({ error: "Missing product_id" }, { status: 400 });
    }

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const today = new Date().getDate();

    // 1. Update Product Details
    const updatedProduct = await db.dim_product.update({
      where: { product_id: BigInt(product_id) },
      data: {
        product_code,
        model_name,
        unit,
      },
    });

    // 2. Adjust opening stock
    if (opening_qty !== undefined) {
      await db.inventory_month_opening.upsert({
        where: {
          year_month_product_id: {
            year: currentYear,
            month: currentMonth,
            product_id: BigInt(product_id)
          }
        },
        update: {
          opening_qty: Number(opening_qty),
          updated_at: new Date()
        },
        create: {
          year: currentYear,
          month: currentMonth,
          product_id: BigInt(product_id),
          opening_qty: Number(opening_qty),
          note: "Cập nhật thủ công",
        },
      });
    }

    // 3. Adjust In/Out Movements
    if (total_in !== undefined || total_out !== undefined) {
      // Find current monthly totals
      const currentMovements = await db.inventory_daily_movement.aggregate({
        where: {
          product_id: BigInt(product_id),
          year: currentYear,
          month: currentMonth,
        },
        _sum: {
          in_qty: true,
          out_qty: true,
        },
      });

      const currentSumIn = Number(currentMovements._sum.in_qty || 0);
      const currentSumOut = Number(currentMovements._sum.out_qty || 0);

      const diffIn = total_in !== undefined ? Number(total_in) - currentSumIn : 0;
      const diffOut = total_out !== undefined ? Number(total_out) - currentSumOut : 0;

      if (diffIn !== 0 || diffOut !== 0) {
        // Record the discrepancy as a movement today
        const existingToday = await db.inventory_daily_movement.findUnique({
          where: {
            year_month_day_product_id: {
              year: currentYear,
              month: currentMonth,
              day: today,
              product_id: BigInt(product_id)
            }
          }
        });

        if (existingToday) {
          await db.inventory_daily_movement.update({
            where: {
              year_month_day_product_id: {
                year: currentYear,
                month: currentMonth,
                day: today,
                product_id: BigInt(product_id)
              }
            },
            data: {
              in_qty: { increment: diffIn },
              out_qty: { increment: diffOut },
              note: (existingToday.note ? existingToday.note + "; " : "") + "Điều chỉnh kiểm kê tháng",
              updated_at: new Date()
            }
          });
        } else {
          await db.inventory_daily_movement.create({
            data: {
              year: currentYear,
              month: currentMonth,
              day: today,
              product_id: BigInt(product_id),
              in_qty: diffIn,
              out_qty: diffOut,
              note: "Điều chỉnh kiểm kê tháng",
            }
          });
        }
      }
    }

    return NextResponse.json({ data: { ...updatedProduct, product_id: updatedProduct.product_id.toString() } });
  } catch (error: any) {
    console.error("Error updating product:", error);
    if (error.code === 'P2002') {
      return NextResponse.json({ error: "Mã sản phẩm đã tồn tại" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update product" }, { status: 500 });
  }
}
