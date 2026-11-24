import { HttpStatus } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

/** Methods that change state. They must declare a JSON body even when they have none (e.g. DELETE). */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF hardening (CLAUDE.md §8): state-changing API requests must be sent as application/json.
 * HTML forms cannot send this content type cross-site without a CORS preflight, which this API never allows.
 * Together with the SameSite=Lax session cookie this blocks cross-site request forgery.
 */
export function jsonOnlyMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    next();
    return;
  }
  const contentType = req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (contentType === "application/json") {
    next();
    return;
  }
  res.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).json({
    statusCode: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    message: "Content-Type must be application/json",
    code: "UNSUPPORTED_MEDIA_TYPE",
  });
}
