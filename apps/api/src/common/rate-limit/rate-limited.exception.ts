import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * 429 Too Many Requests (review M2). Body: {statusCode: 429, message: "Too many requests. Try again in N seconds."
 * ("1 second" when N = 1), code: "RATE_LIMITED"}. The global HttpExceptionFilter adds the `Retry-After: N` header.
 * The body is the same whichever limit was reached, so it never reveals anything about an account.
 */
export class RateLimitedException extends HttpException {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
    super(
      { message: `Too many requests. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`, code: "RATE_LIMITED" },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    this.retryAfterSeconds = seconds;
  }
}
