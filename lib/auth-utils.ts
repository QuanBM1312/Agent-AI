import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import type { User } from "@clerk/backend";
import { db } from "@/lib/db";
import { user_role_enum } from "@prisma/client";
import { cache } from "react";
import { isClerkConfigured } from "@/lib/clerk-runtime";

const VALID_USER_ROLES = new Set<user_role_enum>([
  "Admin",
  "Manager",
  "Technician",
  "Sales",
  "NOT_ASSIGN",
]);

type AuthUser = {
  id: string;
  email: string;
  full_name: string;
  role: user_role_enum;
  department_id: string | null;
  departments: { id: string; name: string } | null;
};

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return null;
}

function coerceRole(value: unknown): user_role_enum | null {
  return typeof value === "string" && VALID_USER_ROLES.has(value as user_role_enum)
    ? (value as user_role_enum)
    : null;
}

function buildFullName(firstName?: string | null, lastName?: string | null) {
  return pickString(`${firstName || ""} ${lastName || ""}`.trim());
}

function toAuthUser(input: {
  userId: string;
  role: user_role_enum;
  departmentId?: string | null;
  email?: string | null;
  fullName?: string | null;
}): AuthUser {
  const email = pickString(input.email, `${input.userId}@clerk.local`) || `${input.userId}@clerk.local`;
  const full_name = pickString(input.fullName, email, "Authenticated User") || "Authenticated User";
  const department_id = pickString(input.departmentId) || null;

  return {
    id: input.userId,
    email,
    full_name,
    role: input.role,
    department_id,
    departments: department_id
      ? { id: department_id, name: "Unknown Department (from Clerk)" }
      : null,
  };
}

function extractClaimUser(sessionClaims: Record<string, unknown> | null | undefined) {
  const publicMetadata = (sessionClaims?.publicMetadata as Record<string, unknown> | undefined) || {};

  return {
    role: coerceRole(publicMetadata.role),
    departmentId: pickString(publicMetadata.department_id),
    email: pickString(
      sessionClaims?.email,
      sessionClaims?.email_address,
      sessionClaims?.primaryEmailAddress,
    ),
    fullName:
      pickString(
        sessionClaims?.fullName,
        sessionClaims?.full_name,
        buildFullName(
          pickString(sessionClaims?.firstName, sessionClaims?.first_name, sessionClaims?.given_name),
          pickString(sessionClaims?.lastName, sessionClaims?.last_name, sessionClaims?.family_name),
        ),
      ),
  };
}

function extractClerkUser(user: User | null) {
  if (!user) {
    return null;
  }

  return {
    role: coerceRole(user.publicMetadata?.role),
    departmentId: pickString(user.publicMetadata?.department_id),
    email: pickString(user.primaryEmailAddress?.emailAddress, user.emailAddresses[0]?.emailAddress),
    fullName: pickString(buildFullName(user.firstName, user.lastName), user.fullName),
  };
}

/**
 * Get current authenticated user with role information from database
 * Auto-creates user in database if they don't exist (syncs from Clerk)
 */
export const getCurrentUserWithRole = cache(async () => {
  if (!isClerkConfigured()) {
    return null;
  }

  const { userId, sessionClaims } = await auth();

  if (!userId) {
    return null;
  }

  const claimUser = extractClaimUser((sessionClaims as Record<string, unknown> | null | undefined) || null);

  // If claims already carry role, avoid touching the DB on the hot auth path.
  if (claimUser.role) {
    if (claimUser.email && claimUser.fullName) {
      return toAuthUser({
        userId,
        role: claimUser.role,
        departmentId: claimUser.departmentId,
        email: claimUser.email,
        fullName: claimUser.fullName,
      });
    }

    const clerkUser = extractClerkUser(await currentUser());
    return toAuthUser({
      userId,
      role: claimUser.role,
      departmentId: claimUser.departmentId ?? clerkUser?.departmentId,
      email: claimUser.email ?? clerkUser?.email,
      fullName: claimUser.fullName ?? clerkUser?.fullName,
    });
  }

  const clerkBackedUser = extractClerkUser(await currentUser());

  if (clerkBackedUser?.role) {
    return toAuthUser({
      userId,
      role: clerkBackedUser.role,
      departmentId: clerkBackedUser.departmentId,
      email: clerkBackedUser.email,
      fullName: clerkBackedUser.fullName,
    });
  }

  let user: AuthUser | null = null;
  try {
    const dbUser = await db.users.findUnique({
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

    user = dbUser
      ? {
          ...dbUser,
          full_name: pickString(dbUser.full_name, dbUser.email, "Authenticated User") || "Authenticated User",
        }
      : null;
  } catch (error) {
    console.error("[auth] failed to query user from database", { userId, error });
    if (claimUser.role) {
      return toAuthUser({
        userId,
        role: claimUser.role,
        departmentId: claimUser.departmentId,
        email: claimUser.email,
        fullName: claimUser.fullName,
      });
    }
    if (clerkBackedUser) {
      return toAuthUser({
        userId,
        role: clerkBackedUser.role ?? "NOT_ASSIGN",
        departmentId: clerkBackedUser.departmentId,
        email: clerkBackedUser.email,
        fullName: clerkBackedUser.fullName,
      });
    }
    throw error;
  }

  // If user doesn't exist in DB, create them automatically from Clerk data
  if (!user) {
    try {
      console.warn("[auth] user missing from database; attempting Clerk backfill", { userId });

      const client = await clerkClient();
      const clerkUser = extractClerkUser(await client.users.getUser(userId));
      const role = clerkUser?.role || "NOT_ASSIGN";
      const departmentId = clerkUser?.departmentId;
      const email = clerkUser?.email || "";
      const fullName = clerkUser?.fullName || email;

      const createdUser = await db.users.create({
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

      user = {
        ...createdUser,
        full_name: pickString(createdUser.full_name, createdUser.email, "Authenticated User") || "Authenticated User",
      };

      console.info("[auth] auto-created missing database user", { userId, role });
    } catch (error: unknown) {
      const e = error as { code?: string; meta?: { target?: string[] } };
      if (e.code === "P2002" && e.meta?.target?.includes("email")) {
        console.error("[auth] auto-create failed because email already exists", { userId });
        const clerk = await clerkClient();
        const clerkUser = await clerk.users.getUser(userId);
        const email = clerkUser.emailAddresses[0]?.emailAddress;
        const conflictingUser = await db.users.findUnique({ where: { email: email || "" } });
        if (conflictingUser) {
          console.error("[auth] found conflicting user during Clerk backfill", {
            userId,
            conflictingUserId: conflictingUser.id,
          });
        }
      } else {
        console.error("[auth] failed to auto-create missing database user", { userId, error });
      }
      if (claimUser.role) {
        return toAuthUser({
          userId,
          role: claimUser.role,
          departmentId: claimUser.departmentId,
          email: claimUser.email,
          fullName: claimUser.fullName,
        });
      }
      if (clerkBackedUser) {
        return toAuthUser({
          userId,
          role: clerkBackedUser.role ?? "NOT_ASSIGN",
          departmentId: clerkBackedUser.departmentId,
          email: clerkBackedUser.email,
          fullName: clerkBackedUser.fullName,
        });
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
