import type { Request } from "express";

/** The user attached to the request by AuthGuard. Never contains the password hash. */
export interface AuthUser {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  /** Id of the session row that authenticated this request. */
  sessionId?: string;
}
