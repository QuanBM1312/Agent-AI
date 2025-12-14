import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

export async function handleApiError(error: any, contextStr: string = "API Error") {
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

  return NextResponse.json(
    { error: "Internal Server Error", details: error.message || "Unknown error" },
    { status: 500 }
  );
}
