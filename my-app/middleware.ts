import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Define public routes that don't require Clerk authentication
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  '/docs(.*)',
  '/',
  '/api/chat/internal', // Often public or handled via API key
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

export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;

  // 1. API Key Validation for specific routes
  if (API_KEY_PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
    // Only protect state-changing methods (POST, PUT, DELETE, PATCH)
    if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
      const apiKey = req.headers.get("x-api-key");
      const validApiKey = process.env.API_SECRET_KEY;

      if (!validApiKey) {
        console.warn("WARNING: API_SECRET_KEY is not set. API is unprotected.");
      } else if (apiKey !== validApiKey) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid API Key" },
          { status: 401 }
        );
      }
    }
    // If API Key checks pass (or it's a GET request), allow access
    // We don't call auth.protect() here because these are machine-to-machine
    return NextResponse.next();
  }

  // 2. Clerk Authentication for everything else
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
