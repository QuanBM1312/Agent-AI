import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

export async function handleApiError(error: unknown, contextStr: string = "API Error") {
  console.error(`[${contextStr}]`, error);

  // Prisma Connection Error
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientKnownRequestError
  ) {
    // Check for specific connection issues or general initialization failures
    // Note: error.message usually contains "Can't reach database server"
    if (error.message.includes("Can't reach database server")) {
      return NextResponse.json(
        {
          error: "Service Temporarily Unavailable",
          details: "Database connection failed. Please try again later."
        },
        { status: 503 }
      );
    }
  }

  const details = error instanceof Error ? error.message : "Unknown error";

  return NextResponse.json(
    { error: "Internal Server Error", details },
    { status: 500 }
  );
}
