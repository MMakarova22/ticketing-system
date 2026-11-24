import type { NextFunction, Request, Response } from "express";

/**
 * Minimal security headers on every response: API (including errors), SPA static files and index.html.
 * Deliberately small: the CSP only forbids framing (clickjacking); it does not restrict scripts or styles.
 */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  next();
}
