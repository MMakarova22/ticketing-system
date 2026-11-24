/**
 * In-process fixed-window rate limiter (review M2). Pure TypeScript without Nest imports, so it can be unit-tested
 * with a fake clock.
 *
 * NOT distributed: counters live in this process's memory, are not shared between instances and are lost on restart.
 * With N instances behind a load balancer the effective limit is up to N times the configured one.
 */

/** At most `limit` requests per `windowMs` for one key. */
export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests still allowed in the current window after this one (0 when blocked). */
  remaining: number;
  /** Whole seconds until the window resets (at least 1); meaningful when blocked, for Retry-After. */
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  /** Hard cap on tracked keys (memory bound). Default 100,000. */
  maxKeys?: number;
  /** Interval of the background sweep of expired windows; null disables the timer (tests). Default 60 s. */
  sweepIntervalMs?: number | null;
  /** Clock, injectable for tests. Default Date.now. */
  now?: () => number;
}

export const DEFAULT_MAX_KEYS = 100_000;
export const DEFAULT_SWEEP_INTERVAL_MS = 60_000;

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  /** Insertion order = window start order (a new window re-inserts its key), so the first key is the oldest. */
  private readonly windows = new Map<string, Window>();
  private readonly maxKeys: number;
  private readonly now: () => number;
  private readonly timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: RateLimiterOptions = {}) {
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
    if (!Number.isInteger(this.maxKeys) || this.maxKeys < 1) {
      throw new RangeError("maxKeys must be a positive integer");
    }
    this.now = options.now ?? Date.now;
    const interval = options.sweepIntervalMs === undefined ? DEFAULT_SWEEP_INTERVAL_MS : options.sweepIntervalMs;
    if (interval !== null) {
      this.timer = setInterval(() => this.sweep(), interval);
      // Never keep the process alive just for housekeeping.
      this.timer.unref();
    }
  }

  /**
   * Counts one request for `key` under `rule`. A blocked request is not counted, so a client that keeps retrying
   * while blocked does not extend its own block beyond the current window.
   */
  consume(key: string, rule: RateLimitRule): RateLimitDecision {
    assertRule(rule);
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      if (window) {
        this.windows.delete(key); // re-inserted below, as the newest key
      } else {
        this.makeRoom();
      }
      window = { count: 0, resetAt: now + rule.windowMs };
      this.windows.set(key, window);
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    if (window.count >= rule.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    window.count += 1;
    return { allowed: true, remaining: rule.limit - window.count, retryAfterSeconds };
  }

  /** Forgets a key (for example the per-email login counter after a successful login). */
  reset(key: string): void {
    this.windows.delete(key);
  }

  /** Removes every expired window. Runs on the timer; callable directly. Returns how many were removed. */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Number of tracked keys. */
  get size(): number {
    return this.windows.size;
  }

  /** Stops the sweep timer and drops all state (module shutdown). */
  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.windows.clear();
  }

  /**
   * Keeps the map below maxKeys before a new key is added by dropping the oldest windows (the first keys). O(1) per
   * insert even when full, so a flood of new keys cannot turn this into a full scan per request; expired windows
   * are removed by the periodic sweep. Evicting can only make a limit more permissive for the evicted key; it never
   * blocks anyone.
   */
  private makeRoom(): void {
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.maxKeys) {
        break;
      }
      this.windows.delete(key);
    }
  }
}

function assertRule(rule: RateLimitRule): void {
  if (!Number.isInteger(rule.limit) || rule.limit < 1 || !Number.isInteger(rule.windowMs) || rule.windowMs < 1) {
    throw new RangeError("A rate-limit rule needs a positive integer limit and windowMs");
  }
}
