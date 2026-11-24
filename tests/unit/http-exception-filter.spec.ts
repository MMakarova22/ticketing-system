import type { ArgumentsHost } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import { expect, test } from "@playwright/test";
import { HttpExceptionFilter } from "../../apps/api/src/common/http-exception.filter.ts";
import { RateLimitedException } from "../../apps/api/src/common/rate-limit/rate-limited.exception.ts";

/** Minimal Express-like response that records what the filter sends. */
function fakeHost() {
  const sent: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    headersSent: false,
    setHeader(name: string, value: string) {
      sent.headers[name.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  return { host, sent };
}

test.describe("HttpExceptionFilter", () => {
  test("a RateLimitedException becomes 429 RATE_LIMITED with a Retry-After header", () => {
    const { host, sent } = fakeHost();
    new HttpExceptionFilter().catch(new RateLimitedException(37), host);
    expect(sent.status).toBe(429);
    expect(sent.body).toEqual({ statusCode: 429, message: "Too many requests. Try again in 37 seconds.", code: "RATE_LIMITED" });
    expect(sent.headers["retry-after"]).toBe("37");
  });

  test("other errors get no Retry-After header", () => {
    const { host, sent } = fakeHost();
    new HttpExceptionFilter().catch(new BadRequestException({ message: "bad", code: "VALIDATION_ERROR" }), host);
    expect(sent.status).toBe(400);
    expect(sent.headers["retry-after"]).toBeUndefined();
  });
});
