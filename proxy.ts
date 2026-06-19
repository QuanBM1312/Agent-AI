import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  buildClerkUnavailableResponse,
  isClerkConfigured,
} from "@/lib/clerk-runtime";

// Define public routes that don't require Clerk authentication
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/version",
  "/docs(.*)",
  "/",
  "/api/chat/internal", // Often public or handled via API key
  "/api/chat/n8n",
  "/api/knowledge/upload",
  // Add other public routes here
]);

// API routes that are protected by API Key (for n8n/server-to-server)
// We treat these as "public" for Clerk (so no redirect to login),
// but verify the API Key manually.
const API_KEY_PROTECTED_ROUTES = [
  "/api/job-reports",
  "/api/calendar-events",
  "/api/knowledge/sources",
  "/api/jobs",
];

const clerkProxy = clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;

  // 1. API Key Validation for specific routes
  if (API_KEY_PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
    const apiKey = req.headers.get("x-api-key");

    // If API Key is provided, validate it (Machine-to-Machine)
    if (apiKey) {
      const validApiKey = process.env.CLERK_SECRET_KEY;
      if (apiKey !== validApiKey) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid API Key" },
          { status: 401 }
        );
      }

      // Valid API Key -> Allow access (skip Clerk auth below)
      return NextResponse.next();
    }

    // No API key: require the normal signed-in user path instead of leaving the route public.
    await auth.protect();
    return NextResponse.next();
  }

  // 2. Clerk Authentication for everything else
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

function handleWhenClerkUnavailable(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  if (API_KEY_PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
    const apiKey = req.headers.get("x-api-key");
    const validApiKey = process.env.CLERK_SECRET_KEY;

    if (!validApiKey) {
      return NextResponse.json(buildClerkUnavailableResponse(), { status: 503 });
    }

    if (apiKey !== validApiKey) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid API Key" },
        { status: 401 }
      );
    }

    return NextResponse.next();
  }

  return NextResponse.json(buildClerkUnavailableResponse(), { status: 503 });
}

export default async function proxy(req: NextRequest, event: NextFetchEvent) {
  if (!isClerkConfigured()) {
    return handleWhenClerkUnavailable(req);
  }

  return clerkProxy(req, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
