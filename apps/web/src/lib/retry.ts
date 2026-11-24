/** Helpers for HTTP 429 responses (review M2). Pure functions, unit-tested in tests/unit. */

/**
 * Parses a Retry-After header: delta-seconds ("120") or an HTTP date in IMF-fixdate form, the format servers must
 * send ("Tue, 24 Nov 2026 10:01:30 GMT"). Returns whole seconds (never negative), or undefined when the header is
 * missing or malformed.
 *
 * An HTTP date is accepted only if formatting the parsed time back gives exactly the header value. Date.parse alone
 * is lenient: it accepts values such as "-5" or "1.5" and rolls invalid dates over ("31 Feb" -> 3 Mar, second 60,
 * any weekday name); the round trip rejects all of them.
 */
export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | undefined {
  const value = header?.trim();
  if (!value) {
    return undefined;
  }
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date) || new Date(date).toUTCString() !== value) {
    return undefined;
  }
  return Math.max(0, Math.ceil((date - now) / 1000));
}

/**
 * Human-readable wait: "1 second", "42 seconds"; from one minute on, whole minutes rounded up ("1 minute",
 * "15 minutes", "60 minutes"), so the user never retries too early.
 */
export function formatRetryAfter(seconds: number): string {
  const whole = Math.max(1, Math.ceil(seconds));
  if (whole < 60) {
    return `${whole} ${whole === 1 ? "second" : "seconds"}`;
  }
  const minutes = Math.ceil(whole / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** The message shown for a 429: "Too many attempts. Try again in 15 minutes." */
export function tooManyRequestsMessage(retryAfterSeconds: number | undefined): string {
  return retryAfterSeconds === undefined
    ? "Too many attempts. Please try again later."
    : `Too many attempts. Try again in ${formatRetryAfter(retryAfterSeconds)}.`;
}
