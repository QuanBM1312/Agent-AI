export function readErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isTenantDatabaseBoundaryError(error: unknown) {
  const message = readErrorMessage(error);
  return message.includes("Tenant or user not found");
}
