import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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

type InventoryProductRow = {
  product_id: bigint;
  product_code: string;
  model_name: string;
  unit: string;
  opening: number | string;
  total_in: number | string;
  total_out: number | string;
  full_count: bigint | number;
};

function parseInventoryQuantity(value: unknown, fieldName: string) {
  if (value === undefined) return undefined;
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error(`INVALID_${fieldName}`);
  }
  return quantity;
}

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
      ? await db.$queryRaw<InventoryProductRow[]>`
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
      : await db.$queryRaw<InventoryProductRow[]>`
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
    const inventory = products.map((product) => {
      const { full_count, ...p } = product;
      void full_count;
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
  } catch (error: unknown) {
    console.error("Error creating product:", error);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
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

    const productId = BigInt(product_id);
    const requestedOpeningQty = parseInventoryQuantity(opening_qty, "OPENING_QTY");
    const requestedTotalIn = parseInventoryQuantity(total_in, "TOTAL_IN");
    const requestedTotalOut = parseInventoryQuantity(total_out, "TOTAL_OUT");

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const today = new Date().getDate();

    const updatedProduct = await db.$transaction(async (tx) => {
      const [currentOpening, currentMovements] = await Promise.all([
        tx.inventory_month_opening.findUnique({
          where: {
            year_month_product_id: {
              year: currentYear,
              month: currentMonth,
              product_id: productId,
            },
          },
        }),
        tx.inventory_daily_movement.aggregate({
          where: {
            product_id: productId,
            year: currentYear,
            month: currentMonth,
          },
          _sum: {
            in_qty: true,
            out_qty: true,
          },
        }),
      ]);

      const currentOpeningQty = Number(currentOpening?.opening_qty || 0);
      const currentSumIn = Number(currentMovements._sum.in_qty || 0);
      const currentSumOut = Number(currentMovements._sum.out_qty || 0);

      const nextOpeningQty = requestedOpeningQty ?? currentOpeningQty;
      const nextTotalIn = requestedTotalIn ?? currentSumIn;
      const nextTotalOut = requestedTotalOut ?? currentSumOut;
      const nextStock = nextOpeningQty + nextTotalIn - nextTotalOut;

      if (nextStock < 0) {
        throw new Error("NEGATIVE_STOCK");
      }

      const product = await tx.dim_product.update({
        where: { product_id: productId },
        data: {
          product_code,
          model_name,
          unit,
        },
      });

      if (requestedOpeningQty !== undefined) {
        await tx.inventory_month_opening.upsert({
          where: {
            year_month_product_id: {
              year: currentYear,
              month: currentMonth,
              product_id: productId,
            },
          },
          update: {
            opening_qty: requestedOpeningQty,
            updated_at: new Date(),
          },
          create: {
            year: currentYear,
            month: currentMonth,
            product_id: productId,
            opening_qty: requestedOpeningQty,
            note: "Cập nhật thủ công",
          },
        });
      }

      if (requestedTotalIn !== undefined || requestedTotalOut !== undefined) {
        const diffIn = requestedTotalIn !== undefined ? requestedTotalIn - currentSumIn : 0;
        const diffOut = requestedTotalOut !== undefined ? requestedTotalOut - currentSumOut : 0;

        if (diffIn !== 0 || diffOut !== 0) {
          const existingToday = await tx.inventory_daily_movement.findUnique({
            where: {
              year_month_day_product_id: {
                year: currentYear,
                month: currentMonth,
                day: today,
                product_id: productId,
              },
            },
          });

          if (existingToday) {
            const nextTodayIn = Number(existingToday.in_qty || 0) + diffIn;
            const nextTodayOut = Number(existingToday.out_qty || 0) + diffOut;
            if (nextTodayIn < 0 || nextTodayOut < 0) {
              throw new Error("NEGATIVE_DAILY_MOVEMENT");
            }

            await tx.inventory_daily_movement.update({
              where: {
                year_month_day_product_id: {
                  year: currentYear,
                  month: currentMonth,
                  day: today,
                  product_id: productId,
                },
              },
              data: {
                in_qty: nextTodayIn,
                out_qty: nextTodayOut,
                note: (existingToday.note ? existingToday.note + "; " : "") + "Điều chỉnh kiểm kê tháng",
                updated_at: new Date(),
              },
            });
          } else {
            if (diffIn < 0 || diffOut < 0) {
              throw new Error("NEGATIVE_DAILY_MOVEMENT");
            }

            await tx.inventory_daily_movement.create({
              data: {
                year: currentYear,
                month: currentMonth,
                day: today,
                product_id: productId,
                in_qty: diffIn,
                out_qty: diffOut,
                note: "Điều chỉnh kiểm kê tháng",
              },
            });
          }
        }
      }

      return product;
    });

    return NextResponse.json({ data: { ...updatedProduct, product_id: updatedProduct.product_id.toString() } });
  } catch (error: unknown) {
    console.error("Error updating product:", error);
    if (error instanceof Error && error.message === "NEGATIVE_STOCK") {
      return NextResponse.json({ error: "Tồn kho không được âm" }, { status: 400 });
    }
    if (error instanceof Error && error.message.startsWith("INVALID_")) {
      return NextResponse.json({ error: "Số lượng tồn kho không hợp lệ" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "NEGATIVE_DAILY_MOVEMENT") {
      return NextResponse.json(
        { error: "Không thể giảm tổng nhập/xuất thấp hơn phần đã ghi nhận trong các ngày trước" },
        { status: 400 }
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Mã sản phẩm đã tồn tại" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update product" }, { status: 500 });
  }
}
