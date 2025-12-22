import { auth, clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { user_role_enum } from "@prisma/client";
import { cache } from "react";

/**
 * Get current authenticated user with role information from database
 * Auto-creates user in database if they don't exist (syncs from Clerk)
 */
export const getCurrentUserWithRole = cache(async () => {
  const { userId, sessionClaims } = await auth();

  if (!userId) {
    return null;
  }

  // Use session claims if available to avoid DB query
  // Note: These must be configured in Clerk Dashboard -> Sessions -> Edit Session Claims
  const role = (sessionClaims?.publicMetadata as Record<string, unknown>)?.role as user_role_enum;
  const departmentId = (sessionClaims?.publicMetadata as Record<string, unknown>)?.department_id as string | undefined;

  // Optimization: If info is in claims, we can return early to avoid a DB trip
  // For now, let's only skip if we HAVE role and department info (or if it's null).
  // We'll still fetch from DB if we need full_name/email, but many APIs don't.
  // Actually, to be safe and compatible with existing code expecting a full object:
  /* if (role) {
    return { id: userId, role, department_id: departmentId, ... };
  } */

  // If we have role and departmentId from claims, and we also have email and full_name from claims,
  // we can construct a user object and return early.
  // This avoids a DB query for common use cases where only these fields are needed.
  if (role && sessionClaims?.email && sessionClaims?.fullName) {
    return {
      id: userId,
      email: sessionClaims.email,
      full_name: sessionClaims.fullName,
      role: role,
      department_id: departmentId || null,
      // Note: The 'departments' object (with id and name) is not available from claims.
      // If that's needed, the DB query is still required.
      departments: departmentId ? { id: departmentId, name: "Unknown Department (from claims)" } : null,
    };
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
      const role = (clerkUser.publicMetadata?.role as string) || 'NOT_ASSIGN';
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
    } catch (error: unknown) {
      const e = error as { code?: string; meta?: { target?: string[] } };
      if (e.code === 'P2002' && e.meta?.target?.includes('email')) {
        console.error(`❌ Auto-create failed: Email already exists.`);
        const clerk = await clerkClient();
        const clerkUser = await clerk.users.getUser(userId);
        const email = clerkUser.emailAddresses[0]?.emailAddress;
        const conflictingUser = await db.users.findUnique({ where: { email: email || "" } });
        if (conflictingUser) {
          console.error(`CONFLICT: Email '${email}' is already used by User ID: ${conflictingUser.id}`);
        }
      } else {
        console.error(`❌ Failed to auto-create user ${userId}:`, error);
      }
      return null;
    }
  }

  return user;
});

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
export function sanitizeJobForTechnician(job: Record<string, unknown>) {
  if (!job || typeof job !== 'object') return job;

  // Remove financial fields
  const sanitized = { ...job };

  // Remove line items pricing
  if (sanitized.job_line_items && Array.isArray(sanitized.job_line_items)) {
    sanitized.job_line_items = sanitized.job_line_items.map((item: Record<string, unknown>) => ({
      ...item,
      unit_price: undefined,
      materials_and_services: (item.materials_and_services as Record<string, unknown>)
        ? {
          ...(item.materials_and_services as Record<string, unknown>),
          price: undefined,
        }
        : undefined,
    }));
  }

  return sanitized;
}
