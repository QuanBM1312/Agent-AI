import { getCurrentUserWithRole } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const user = await getCurrentUserWithRole();

    if (!user) {
      return NextResponse.json(
        { error: "User not authenticated or not found" },
        { status: 401 }
      );
    }

    let dbUser = null;
    let dbLookupError = null;

    try {
      dbUser = await db.users.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          role: true,
          department_id: true,
        },
      });
    } catch (error) {
      dbLookupError = error instanceof Error ? error.message : String(error);
    }

    return NextResponse.json({
      success: true,
      user,
      dbUserPresent: Boolean(dbUser),
      dbUser,
      dbLookupError,
    });
  } catch (error: unknown) {
    console.error("Error in test-auth:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
