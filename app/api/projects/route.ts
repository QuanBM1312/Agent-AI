import { NextResponse } from "next/server";
import { db as prisma } from "@/lib/db";
import { getCurrentUserWithRole, requireRole } from "@/lib/auth-utils";

interface ProjectItemInput {
  model_name: string;
  quantity?: number;
  warranty_start_date?: string | null;
  warranty_end_date?: string | null;
  serials?: string[];
}

interface ProjectPayload {
  customer_id?: string;
  name?: string;
  address?: string | null;
  contact_person?: string | null;
  contact_position?: string | null;
  input_contract_no?: string | null;
  input_contract_date?: string | null;
  output_contract_no?: string | null;
  output_contract_date?: string | null;
  items?: ProjectItemInput[];
  personnel_ids?: string[];
  id?: string;
}

export async function GET(req: Request) {
  try {
    const currentUser = await getCurrentUserWithRole();
    if (!currentUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!["Admin", "Manager", "Sales"].includes(currentUser.role)) {
      return NextResponse.json(
        { error: "Forbidden: You do not have access to project lists" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customer_id");

    if (!customerId) {
      return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
    }

    const projects = await prisma.projects.findMany({
      where: {
        customer_id: customerId,
        ...(currentUser.role === "Sales"
          ? {
              project_personnel: {
                some: {
                  user_id: currentUser.id,
                },
              },
            }
          : {}),
      },
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
    const body = (await req.json()) as ProjectPayload;
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
          create: items?.map((item) => ({
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
    const body = (await req.json()) as ProjectPayload;
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

      if (personnel_ids && personnel_ids.length > 0) {
        await tx.project_personnel.createMany({
          data: personnel_ids.map((userId) => ({
            project_id: id,
            user_id: userId,
          })),
        });
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
