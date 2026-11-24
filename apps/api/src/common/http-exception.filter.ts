import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";
import { RateLimitedException } from "./rate-limit/rate-limited.exception.ts";

/** Error body returned by every API error (CLAUDE.md §10). */
export interface ErrorBody {
  statusCode: number;
  message: string;
  code?: string;
}

/**
 * Normalizes all errors to {statusCode, message, code?}.
 * Unexpected errors are logged and returned as a generic 500 so no internals leak.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("HttpExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (!res.headersSent) {
      if (exception instanceof RateLimitedException) {
        res.setHeader("Retry-After", String(exception.retryAfterSeconds));
      }
      res.status(body.statusCode).json(body);
    }
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      let message = exception.message;
      let code: string | undefined;
      if (typeof response === "string") {
        message = response;
      } else if (typeof response === "object" && response !== null) {
        const r = response as { message?: unknown; code?: unknown };
        if (Array.isArray(r.message)) {
          message = r.message.map(String).join("; ");
        } else if (typeof r.message === "string") {
          message = r.message;
        }
        if (typeof r.code === "string") {
          code = r.code;
        }
      }
      return code === undefined ? { statusCode, message } : { statusCode, message, code };
    }

    // Malformed JSON from the body parser arrives as a plain error with a 4xx status.
    const status = (exception as { status?: unknown; statusCode?: unknown } | null)?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return { statusCode: status, message: status === 400 ? "Malformed request body" : "Bad request" };
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: "Internal server error" };
  }
}
