
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log("Seeding inventory data...");

    // 1. Create Products
    const products = [
        { product_code: "DH-001", model_name: "Daikin Inverter 1HP 2024", unit: "Bộ" },
        { product_code: "DH-002", model_name: "Panasonic Inverter 1.5HP", unit: "Bộ" },
        { product_code: "OG-001", model_name: "Ống đồng Thái Lan 6/10", unit: "Mét" },
        { product_code: "day-dien-01", model_name: "Dây điện Cadivi 2.5", unit: "Mét" },
        { product_code: "gas-32", model_name: "Gas R32", unit: "Bình" },
    ];

    for (const p of products) {
        const existing = await prisma.dim_product.findUnique({
            where: { product_code: p.product_code },
        });

        if (!existing) {
            await prisma.dim_product.create({
                data: p,
            });
            console.log(`Created product: ${p.model_name}`);
        }
    }

    // Reload products to get IDs
    const dbProducts = await prisma.dim_product.findMany();

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    // 2. Create Month Opening (Safe logic: if not exists)
    for (const p of dbProducts) {
        // Check if opening exists
        const existingOpening = await prisma.inventory_month_opening.findUnique({
            where: {
                year_month_product_id: {
                    year: currentYear,
                    month: currentMonth,
                    product_id: p.product_id
                }
            }
        });

        if (!existingOpening) {
            // Random opening stock 10-50
            const qty = Math.floor(Math.random() * 40) + 10;
            await prisma.inventory_month_opening.create({
                data: {
                    year: currentYear,
                    month: currentMonth,
                    product_id: p.product_id,
                    opening_qty: qty,
                    note: "Tồn đầu kỳ giả lập"
                }
            });
            console.log(`Set opening stock for ${p.product_code}: ${qty}`);
        }
    }

    // 3. Create Daily Movements (Some random in/out)
    const today = new Date().getDate();

    for (const p of dbProducts) {
        // Create movement for today
        const existingMovement = await prisma.inventory_daily_movement.findUnique({
            where: {
                year_month_day_product_id: {
                    year: currentYear,
                    month: currentMonth,
                    day: today,
                    product_id: p.product_id
                }
            }
        });

        if (!existingMovement) {
            const inQty = Math.floor(Math.random() * 5); // 0-5
            const outQty = Math.floor(Math.random() * 3); // 0-2

            await prisma.inventory_daily_movement.create({
                data: {
                    year: currentYear,
                    month: currentMonth,
                    day: today,
                    product_id: p.product_id,
                    in_qty: inQty,
                    out_qty: outQty,
                    note: "Phát sinh trong ngày"
                }
            });
            console.log(`Registered movement for ${p.product_code}: +${inQty} / -${outQty}`);
        }
    }

    console.log("Inventory seeding completed.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
