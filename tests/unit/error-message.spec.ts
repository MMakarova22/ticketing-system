import { expect, test } from "@playwright/test";
import { ApiError, errorMessage } from "../../apps/web/src/api/client.ts";

// errorMessage() decides what the auth screens show for a failed request (review M2): only a 429 is rewritten.
test.describe("errorMessage()", () => {
  test("429 with Retry-After: when to try again", () => {
    expect(errorMessage(new ApiError(429, "Too many requests. Try again in 900 seconds.", "RATE_LIMITED", 900))).toBe(
      "Too many attempts. Try again in 15 minutes.",
    );
    expect(errorMessage(new ApiError(429, "Too many requests.", "RATE_LIMITED", 1))).toBe(
      "Too many attempts. Try again in 1 second.",
    );
  });

  test("429 without Retry-After: try again later", () => {
    expect(errorMessage(new ApiError(429, "Too many requests.", "RATE_LIMITED"))).toBe(
      "Too many attempts. Please try again later.",
    );
  });

  test("other API errors keep their own message, even if they carry a Retry-After value", () => {
    expect(errorMessage(new ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS"))).toBe(
      "Invalid email or password",
    );
    expect(errorMessage(new ApiError(400, "password must be at least 8 characters", "VALIDATION_ERROR"))).toBe(
      "password must be at least 8 characters",
    );
    expect(errorMessage(new ApiError(503, "Database is unavailable", "DATABASE_UNAVAILABLE", 30))).toBe(
      "Database is unavailable",
    );
  });

  test("network error (status 0) keeps its message", () => {
    const message = "Cannot reach the server. Check your connection and try again.";
    expect(errorMessage(new ApiError(0, message))).toBe(message);
  });

  test("a plain Error that is not an ApiError keeps its message", () => {
    expect(errorMessage(new Error("Something else went wrong"))).toBe("Something else went wrong");
  });
});
