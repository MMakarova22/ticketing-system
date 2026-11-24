import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, base64url-encoded. Used for session and email-verification tokens. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this hash is stored in the database; the raw token exists only in the cookie or email link. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
