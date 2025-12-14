import { getCurrentUserWithRole } from "@/lib/auth-utils";
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

    return NextResponse.json({
      success: true,
      user: user,
    });
  } catch (error: any) {
    console.error("Error in test-auth:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
