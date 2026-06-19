import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { isTenantDatabaseBoundaryError } from "@/lib/db-runtime";

export async function handleApiError(error: unknown, contextStr: string = "API Error") {
  console.error(`[${contextStr}]`, error);
  const errorMessage = error instanceof Error ? error.message : "";

  // Prisma Connection Error
  if (
    isTenantDatabaseBoundaryError(error) ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientKnownRequestError
  ) {
    // Check for specific connection issues or general initialization failures
    // Note: error.message usually contains "Can't reach database server"
    if (
      isTenantDatabaseBoundaryError(error) ||
      errorMessage.includes("Can't reach database server")
    ) {
      return NextResponse.json(
        {
          error: "Service Temporarily Unavailable",
          details: "Database connection failed. Please try again later."
        },
        { status: 503 }
      );
    }
  }

  const details = errorMessage || "Unknown error";

  return NextResponse.json(
    { error: "Internal Server Error", details },
    { status: 500 }
  );
}
