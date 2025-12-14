import { auth, clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { user_role_enum } from "@prisma/client";

/**
 * Get current authenticated user with role information from database
 * Auto-creates user in database if they don't exist (syncs from Clerk)
 */
export async function getCurrentUserWithRole() {
  const { userId } = await auth();

  if (!userId) {
    return null;
  }

  // Try to find user in database
  let user = await db.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      full_name: true,
      role: true,
      department_id: true,
      departments: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  // If user doesn't exist in DB, create them automatically from Clerk data
  if (!user) {
    try {
      console.log(`⚠️ User ${userId} not found in database, fetching from Clerk...`);

      const client = await clerkClient();
      const clerkUser = await client.users.getUser(userId);

      const email = clerkUser.emailAddresses[0]?.emailAddress || '';
      const fullName = `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim();
      const role = (clerkUser.publicMetadata?.role as string) || 'Technician';
      const departmentId = clerkUser.publicMetadata?.department_id as string | undefined;

      user = await db.users.create({
        data: {
          id: userId,
          email: email,
          full_name: fullName || email, // Fallback to email if no name
          role: role as user_role_enum,
          department_id: departmentId || null,
        },
        select: {
          id: true,
          email: true,
          full_name: true,
          role: true,
          department_id: true,
          departments: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      console.log(`✅ Auto-created user ${userId} in database with role: ${role}`);
    } catch (error: any) {
      if (error.code === 'P2002' && error.meta?.target?.includes('email')) {
        console.error(`❌ Auto-create failed: Email already exists.`);

        // Attempt to find the conflicting user to show details
        const email = (await (await clerkClient()).users.getUser(userId)).emailAddresses[0]?.emailAddress;
        const conflictingUser = await db.users.findUnique({ where: { email } });

        console.error(`CONFLICT: Email '${email}' is already used by existing User ID: ${conflictingUser?.id}`);
        console.error(`SOLUTION: Delete the old user from the database or update their ID.`);
      } else {
        console.error(`❌ Failed to auto-create user ${userId}:`, error);
      }
      return null;
    }
  }

  return user;
}

/**
 * Check if current user has one of the allowed roles
 * @throws Error if user is not authenticated or doesn't have required role
 */
export async function requireRole(allowedRoles: user_role_enum[]) {
  const user = await getCurrentUserWithRole();

  if (!user) {
    throw new Error("Unauthorized: User not authenticated");
  }

  if (!allowedRoles.includes(user.role)) {
    throw new Error(
      `Forbidden: User role '${user.role}' is not authorized. Required: ${allowedRoles.join(", ")}`
    );
  }

  return user;
}

/**
 * Check if user can assign job to a technician
 * Admin can assign to anyone, Manager can only assign to their department
 */
export async function canAssignToTechnician(
  currentUser: Awaited<ReturnType<typeof getCurrentUserWithRole>>,
  technicianId: string
): Promise<boolean> {
  if (!currentUser) return false;

  // Admin can assign to anyone
  if (currentUser.role === "Admin") {
    return true;
  }

  // Manager can only assign to technicians in their department
  if (currentUser.role === "Manager") {
    const technician = await db.users.findUnique({
      where: { id: technicianId },
      select: { department_id: true, role: true },
    });

    if (!technician || technician.role !== "Technician") {
      return false;
    }

    return technician.department_id === currentUser.department_id;
  }

  return false;
}

/**
 * Filter financial data from job object for Technician role
 */
export function sanitizeJobForTechnician(job: any) {
  if (!job) return job;

  // Remove financial fields
  const sanitized = { ...job };

  // Remove line items pricing
  if (sanitized.job_line_items) {
    sanitized.job_line_items = sanitized.job_line_items.map((item: any) => ({
      ...item,
      unit_price: undefined,
      materials_and_services: item.materials_and_services
        ? {
          ...item.materials_and_services,
          price: undefined,
        }
        : undefined,
    }));
  }

  return sanitized;
}
