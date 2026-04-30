import { user_role_enum, type PrismaClient } from "@prisma/client";

const VALID_USER_ROLES = new Set<user_role_enum>([
  "Admin",
  "Manager",
  "Technician",
  "Sales",
  "NOT_ASSIGN",
]);

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function buildFullName(firstName?: string | null, lastName?: string | null) {
  return pickString(`${firstName || ""} ${lastName || ""}`.trim());
}

function coerceRole(value: unknown) {
  return typeof value === "string" && VALID_USER_ROLES.has(value as user_role_enum)
    ? (value as user_role_enum)
    : "NOT_ASSIGN";
}

export type ClerkUserSyncInput = {
  id: string;
  emailAddresses?: Array<{ email_address?: string | null; emailAddress?: string | null }> | null;
  firstName?: string | null;
  first_name?: string | null;
  lastName?: string | null;
  last_name?: string | null;
  publicMetadata?: Record<string, unknown> | null;
  public_metadata?: Record<string, unknown> | null;
};

export function normalizeClerkUserForDb(data: ClerkUserSyncInput) {
  const publicMetadata = data.publicMetadata || data.public_metadata || null;
  const email =
    pickString(
      data.emailAddresses?.[0]?.email_address,
      data.emailAddresses?.[0]?.emailAddress,
    ) || `${data.id}@clerk.local`;
  const fullName =
    buildFullName(
      data.firstName ?? data.first_name ?? null,
      data.lastName ?? data.last_name ?? null,
    ) || email;

  return {
    id: data.id,
    email,
    full_name: fullName,
    role: coerceRole(publicMetadata?.role),
    department_id: pickString(publicMetadata?.department_id) || null,
  };
}

export async function upsertClerkUser(
  prisma: PrismaClient,
  data: ClerkUserSyncInput,
) {
  const normalized = normalizeClerkUserForDb(data);

  return prisma.users.upsert({
    where: { id: normalized.id },
    update: {
      email: normalized.email,
      full_name: normalized.full_name,
      role: normalized.role,
      department_id: normalized.department_id,
    },
    create: normalized,
  });
}

export async function deleteClerkUser(
  prisma: PrismaClient,
  userId: string,
) {
  return prisma.users.delete({
    where: { id: userId },
  }).catch((error: unknown) => {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: string }).code === "string"
        ? (error as { code: string }).code
        : null;
    if (code !== "P2025") {
      throw error;
    }
    return null;
  });
}
