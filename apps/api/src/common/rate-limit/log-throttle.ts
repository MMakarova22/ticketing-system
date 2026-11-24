/**
 * Throttles log lines (review M2): `shouldLog(key, windowMs)` is true for the first call per key and then false until
 * `windowMs` has passed. The rate-limit service uses it so a client that keeps hammering a blocked endpoint produces
 * one warning per policy and bucket per rate-limit window, not one per request. Keys are a fixed, small set
 * ("login:email", "register:ip", ...), so the map cannot grow. Pure module with an injectable clock for unit tests.
 */
export class LogThrottle {
  private readonly nextAllowedAt = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  shouldLog(key: string, windowMs: number): boolean {
    const now = this.now();
    const next = this.nextAllowedAt.get(key);
    if (next !== undefined && now < next) {
      return false;
    }
    this.nextAllowedAt.set(key, now + windowMs);
    return true;
  }
}
