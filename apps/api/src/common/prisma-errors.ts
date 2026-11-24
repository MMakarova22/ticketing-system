/** Helpers for recognizing Prisma "known request" errors by their stable error codes. */

function prismaCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** A unique constraint was violated (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return prismaCode(error) === "P2002";
}

/** A foreign key constraint was violated (P2003), e.g. deleting a row that is still referenced. */
export function isForeignKeyViolation(error: unknown): boolean {
  return prismaCode(error) === "P2003";
}

/** The record to update or delete does not exist (P2025). */
export function isRecordNotFound(error: unknown): boolean {
  return prismaCode(error) === "P2025";
}
