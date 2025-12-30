import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole, requireRole } from "@/lib/auth-utils";

export async function GET(req: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customer_id");

    if (!customerId) {
      return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
    }

    const projects = await prisma.projects.findMany({
      where: { customer_id: customerId },
      include: {
        project_items: {
          include: {
            project_serials: true
          }
        },
        project_personnel: {
          include: {
            users: {
              select: {
                id: true,
                full_name: true,
                role: true
              }
            }
          }
        }
      },
      orderBy: { created_at: "desc" }
    });

    return NextResponse.json(projects);
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return NextResponse.json({ error: "Unable to fetch projects" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requireRole(["Admin", "Manager", "Sales"]);
    const body = await req.json();
    const {
      customer_id,
      name,
      address,
      contact_person,
      contact_position,
      input_contract_no,
      input_contract_date,
      output_contract_no,
      output_contract_date,
      items,
      personnel_ids
    } = body;

    if (!customer_id || !name) {
      return NextResponse.json({ error: "customer_id and name are required" }, { status: 400 });
    }

    const project = await prisma.projects.create({
      data: {
        customer_id,
        name,
        address,
        contact_person,
        contact_position,
        input_contract_no,
        input_contract_date: input_contract_date ? new Date(input_contract_date) : null,
        output_contract_no,
        output_contract_date: output_contract_date ? new Date(output_contract_date) : null,
        project_items: {
          create: items?.map((item: any) => ({
            model_name: item.model_name,
            quantity: item.quantity || 1,
            warranty_start_date: item.warranty_start_date ? new Date(item.warranty_start_date) : null,
            warranty_end_date: item.warranty_end_date ? new Date(item.warranty_end_date) : null,
            project_serials: {
              create: item.serials?.map((sn: string) => ({
                serial_number: sn
              }))
            }
          }))
        },
        project_personnel: {
          create: personnel_ids?.map((userId: string) => ({
            user_id: userId
          }))
        }
      },
      include: {
        project_items: {
          include: {
            project_serials: true
          }
        },
        project_personnel: {
          include: {
            users: true
          }
        }
      }
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error("Failed to create project:", error);
    return NextResponse.json({ error: "Unable to create project" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    await requireRole(["Admin", "Manager", "Sales"]);
    const body = await req.json();
    const {
      id,
      name,
      address,
      contact_person,
      contact_position,
      input_contract_no,
      input_contract_date,
      output_contract_no,
      output_contract_date,
      items,
      personnel_ids
    } = body;

    if (!id) {
      return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
    }

    // Use a transaction to ensure data consistency
    const updatedProject = await prisma.$transaction(async (tx) => {
      // 1. Update basic project info
      await tx.projects.update({
        where: { id },
        data: {
          name,
          address,
          contact_person,
          contact_position,
          input_contract_no,
          input_contract_date: input_contract_date ? new Date(input_contract_date) : null,
          output_contract_no,
          output_contract_date: output_contract_date ? new Date(output_contract_date) : null,
          updated_at: new Date()
        }
      });

      // 2. Simple strategy for items/serials: Delete existing and recreate
      // This is easier for nested equipment updates unless we want to do complex diffing
      await tx.project_items.deleteMany({
        where: { project_id: id }
      });

      await tx.project_personnel.deleteMany({
        where: { project_id: id }
      });

      // 3. Re-create items and serials
      if (items && items.length > 0) {
        for (const item of items) {
          await tx.project_items.create({
            data: {
              project_id: id,
              model_name: item.model_name,
              quantity: item.quantity || 1,
              warranty_start_date: item.warranty_start_date ? new Date(item.warranty_start_date) : null,
              warranty_end_date: item.warranty_end_date ? new Date(item.warranty_end_date) : null,
              project_serials: {
                create: item.serials?.filter((sn: string) => sn.trim() !== "").map((sn: string) => ({
                  serial_number: sn
                }))
              }
            }
          });
        }
      }

      // Return the updated project with relations
      return await tx.projects.findUnique({
        where: { id },
        include: {
          project_items: {
            include: {
              project_serials: true
            }
          },
          project_personnel: {
            include: {
              users: true
            }
          }
        }
      });
    });

    return NextResponse.json(updatedProject);
  } catch (error) {
    console.error("Failed to update project:", error);
    return NextResponse.json({ error: "Unable to update project" }, { status: 500 });
  }
}
