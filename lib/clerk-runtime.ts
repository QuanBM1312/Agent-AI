export function isClerkConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
  );
}

export function buildClerkUnavailableResponse() {
  return {
    error: "Authentication is unavailable because Clerk is not configured",
  };
}
