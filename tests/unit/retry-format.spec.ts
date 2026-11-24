import { expect, test } from "@playwright/test";
import { formatRetryAfter, parseRetryAfter, tooManyRequestsMessage } from "../../apps/web/src/lib/retry.ts";

test.describe("Retry-After handling in the web app", () => {
  test("parses delta-seconds and HTTP dates; ignores missing or invalid values", () => {
    expect(parseRetryAfter("120")).toBe(120);
    expect(parseRetryAfter(" 1 ")).toBe(1);
    expect(parseRetryAfter("0")).toBe(0);
    const now = Date.parse("2026-11-24T10:00:00Z");
    expect(parseRetryAfter("Tue, 24 Nov 2026 10:01:30 GMT", now)).toBe(90);
    expect(parseRetryAfter("Tue, 24 Nov 2026 09:00:00 GMT", now)).toBe(0); // in the past
    for (const invalid of [null, undefined, "", "soon", "-5", "1.5", "2026-11-24", "24 Nov 2026 10:01:30 GMT"]) {
      expect(parseRetryAfter(invalid), String(invalid)).toBeUndefined();
    }
  });

  test("HTTP dates: only real dates in exact IMF-fixdate form are accepted", () => {
    const now = Date.parse("2026-11-24T10:00:00Z");
    // Valid: delay in whole seconds, never negative.
    expect(parseRetryAfter("Wed, 25 Nov 2026 10:00:00 GMT", now)).toBe(86_400);
    expect(parseRetryAfter("Tue, 24 Nov 2026 10:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("Thu, 01 Jan 1970 00:00:00 GMT", now)).toBe(0);
    // Shaped like an HTTP date but not a real one, or not in canonical form: Date.parse would roll these over or
    // accept them; they must be ignored.
    for (const invalid of [
      "Tue, 31 Feb 2026 10:00:00 GMT", // no 31 February (Date.parse: 3 March)
      "Tue, 24 Nov 2026 10:00:60 GMT", // second 60
      "Tue, 24 Nov 2026 25:00:00 GMT", // hour 25
      "Xyz, 24 Nov 2026 10:00:00 GMT", // not a weekday
      "Mon, 24 Nov 2026 10:00:00 GMT", // wrong weekday (24 Nov 2026 is a Tuesday)
      "Tue, 24 nov 2026 10:00:00 GMT", // month not capitalized
      "Tue, 4 Nov 2026 10:00:00 GMT", // day not two digits
      "Tue, 24 Nov 2026 10:00:00 UTC", // not GMT
      "Tuesday, 24-Nov-26 10:00:00 GMT", // obsolete RFC 850 form
      "Tue Nov 24 10:00:00 2026", // obsolete asctime form
    ]) {
      expect(parseRetryAfter(invalid, now), invalid).toBeUndefined();
    }
  });

  test("singular and plural seconds; whole minutes (rounded up) from one minute on", () => {
    expect(formatRetryAfter(1)).toBe("1 second");
    expect(formatRetryAfter(0)).toBe("1 second"); // never "0 seconds"
    expect(formatRetryAfter(0.3)).toBe("1 second");
    expect(formatRetryAfter(2)).toBe("2 seconds");
    expect(formatRetryAfter(59)).toBe("59 seconds");
    expect(formatRetryAfter(60)).toBe("1 minute");
    expect(formatRetryAfter(61)).toBe("2 minutes");
    expect(formatRetryAfter(900)).toBe("15 minutes");
    expect(formatRetryAfter(3600)).toBe("60 minutes");
  });

  test("the 429 message", () => {
    expect(tooManyRequestsMessage(1)).toBe("Too many attempts. Try again in 1 second.");
    expect(tooManyRequestsMessage(42)).toBe("Too many attempts. Try again in 42 seconds.");
    expect(tooManyRequestsMessage(899)).toBe("Too many attempts. Try again in 15 minutes.");
    expect(tooManyRequestsMessage(undefined)).toBe("Too many attempts. Please try again later.");
  });
});
