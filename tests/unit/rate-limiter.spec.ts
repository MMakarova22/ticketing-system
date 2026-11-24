import { expect, test } from "@playwright/test";
import {
  DEFAULT_MAX_KEYS,
  type RateLimitRule,
  RateLimiter,
} from "../../apps/api/src/common/rate-limit/rate-limiter.ts";

/** Manually advanced clock. */
function fakeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const FIFTEEN_MINUTES: RateLimitRule = { limit: 3, windowMs: 15 * 60 * 1000 };

function limiter(clock = fakeClock(), maxKeys?: number) {
  return new RateLimiter({ now: clock.now, sweepIntervalMs: null, ...(maxKeys === undefined ? {} : { maxKeys }) });
}

test.describe("RateLimiter (fixed window, fake clock)", () => {
  test("allows exactly `limit` requests per window, then blocks", () => {
    const rl = limiter();
    expect(rl.consume("k", FIFTEEN_MINUTES)).toMatchObject({ allowed: true, remaining: 2 });
    expect(rl.consume("k", FIFTEEN_MINUTES)).toMatchObject({ allowed: true, remaining: 1 });
    expect(rl.consume("k", FIFTEEN_MINUTES)).toMatchObject({ allowed: true, remaining: 0 });
    expect(rl.consume("k", FIFTEEN_MINUTES)).toMatchObject({ allowed: false, remaining: 0 });
    expect(rl.consume("k", FIFTEEN_MINUTES).allowed).toBe(false);
  });

  test("Retry-After is the time left in the window, rounded up, at least 1 second", () => {
    const clock = fakeClock();
    const rl = limiter(clock);
    for (let i = 0; i < 3; i += 1) rl.consume("k", FIFTEEN_MINUTES);

    expect(rl.consume("k", FIFTEEN_MINUTES).retryAfterSeconds).toBe(900);
    clock.advance(1);
    expect(rl.consume("k", FIFTEEN_MINUTES).retryAfterSeconds).toBe(900); // 899.999 s -> 900
    clock.advance(600_000 - 1);
    expect(rl.consume("k", FIFTEEN_MINUTES).retryAfterSeconds).toBe(300);
    clock.advance(299_999);
    expect(rl.consume("k", FIFTEEN_MINUTES)).toMatchObject({ allowed: false, retryAfterSeconds: 1 }); // 1 ms left
  });

  test("a new window starts exactly at the reset time", () => {
    const clock = fakeClock();
    const rl = limiter(clock);
    for (let i = 0; i < 3; i += 1) rl.consume("k", FIFTEEN_MINUTES);
    clock.advance(FIFTEEN_MINUTES.windowMs - 1);
    expect(rl.consume("k", FIFTEEN_MINUTES).allowed).toBe(false);
    clock.advance(1);
    expect(rl.consume("k", FIFTEEN_MINUTES)).toMatchObject({ allowed: true, remaining: 2 });
  });

  test("blocked requests are not counted, so retrying does not extend the block", () => {
    const clock = fakeClock();
    const rl = limiter(clock);
    for (let i = 0; i < 3; i += 1) rl.consume("k", FIFTEEN_MINUTES);
    for (let i = 0; i < 50; i += 1) {
      clock.advance(1000);
      expect(rl.consume("k", FIFTEEN_MINUTES).allowed).toBe(false);
    }
    clock.advance(FIFTEEN_MINUTES.windowMs - 50_000);
    expect(rl.consume("k", FIFTEEN_MINUTES).allowed).toBe(true);
  });

  test("keys are independent; reset() forgets one key", () => {
    const rl = limiter();
    for (let i = 0; i < 3; i += 1) rl.consume("a", FIFTEEN_MINUTES);
    expect(rl.consume("a", FIFTEEN_MINUTES).allowed).toBe(false);
    expect(rl.consume("b", FIFTEEN_MINUTES)).toMatchObject({ allowed: true, remaining: 2 });

    rl.reset("a");
    expect(rl.consume("a", FIFTEEN_MINUTES)).toMatchObject({ allowed: true, remaining: 2 });
    expect(rl.consume("b", FIFTEEN_MINUTES)).toMatchObject({ allowed: true, remaining: 1 });
  });

  test("a burst of synchronous calls never exceeds the limit", () => {
    const rl = limiter();
    const rule = { limit: 10, windowMs: 60_000 };
    const results = Array.from({ length: 1000 }, () => rl.consume("burst", rule));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  test("sweep() removes only expired windows", () => {
    const clock = fakeClock();
    const rl = limiter(clock);
    rl.consume("short", { limit: 1, windowMs: 1000 });
    rl.consume("long", { limit: 1, windowMs: 60_000 });
    clock.advance(999);
    expect(rl.sweep()).toBe(0);
    clock.advance(1);
    expect(rl.sweep()).toBe(1);
    expect(rl.size).toBe(1);
    expect(rl.consume("long", { limit: 1, windowMs: 60_000 }).allowed).toBe(false); // still tracked
  });

  test("at maxKeys the oldest window is evicted (never a newer one); eviction only loosens limits", () => {
    const clock = fakeClock();
    const rl = limiter(clock, 3);
    const rule = { limit: 1, windowMs: 60_000 };
    rl.consume("a", rule);
    clock.advance(10);
    rl.consume("b", rule);
    clock.advance(10);
    rl.consume("c", rule);
    expect(rl.size).toBe(3);

    rl.consume("d", rule); // full: "a" (oldest window) goes
    expect(rl.size).toBe(3);
    expect(rl.consume("b", rule).allowed).toBe(false); // still tracked
    expect(rl.consume("c", rule).allowed).toBe(false);
    expect(rl.consume("d", rule).allowed).toBe(false);
    expect(rl.consume("a", rule).allowed).toBe(true); // evicted: starts fresh (more permissive, never stricter)
    expect(rl.size).toBe(3);
  });

  test("a key whose window restarts becomes the newest, so it is evicted last", () => {
    const clock = fakeClock();
    const rl = limiter(clock, 2);
    const rule = { limit: 1, windowMs: 1000 };
    rl.consume("a", rule);
    rl.consume("b", { limit: 1, windowMs: 60_000 });
    clock.advance(1000); // "a" expired
    rl.consume("a", rule); // new window for "a": now newer than "b"
    rl.consume("c", rule); // full: evicts "b"
    expect(rl.consume("a", rule).allowed).toBe(false);
    expect(rl.consume("b", { limit: 1, windowMs: 60_000 }).allowed).toBe(true);
  });

  test("the default cap is 100,000 keys and the map never grows past it", () => {
    expect(DEFAULT_MAX_KEYS).toBe(100_000);
    const rl = limiter();
    const rule = { limit: 1, windowMs: 60_000 };
    for (let i = 0; i < DEFAULT_MAX_KEYS + 5_000; i += 1) {
      rl.consume(`key-${i}`, rule);
    }
    expect(rl.size).toBe(DEFAULT_MAX_KEYS);
    expect(rl.consume("key-0", rule).allowed).toBe(true); // among the oldest: evicted
    expect(rl.consume(`key-${DEFAULT_MAX_KEYS + 4_999}`, rule).allowed).toBe(false); // newest: kept
  });

  test("invalid rules and options are rejected", () => {
    const rl = limiter();
    for (const rule of [
      { limit: 0, windowMs: 1000 },
      { limit: 1.5, windowMs: 1000 },
      { limit: 1, windowMs: 0 },
      { limit: 1, windowMs: Number.NaN },
    ]) {
      expect(() => rl.consume("k", rule), JSON.stringify(rule)).toThrow(RangeError);
    }
    expect(() => new RateLimiter({ maxKeys: 0, sweepIntervalMs: null })).toThrow(RangeError);
  });
});

test.describe("RateLimiter sweep timer", () => {
  test("the periodic sweep removes expired windows", async () => {
    const clock = fakeClock();
    const rl = new RateLimiter({ now: clock.now, sweepIntervalMs: 20 });
    try {
      rl.consume("k", { limit: 1, windowMs: 1000 });
      clock.advance(1000);
      expect(rl.size).toBe(1);
      await expect.poll(() => rl.size, { timeout: 2000 }).toBe(0);
    } finally {
      rl.dispose();
    }
  });

  test("dispose() stops the sweep timer", async () => {
    const counted = (rl: RateLimiter) => {
      const calls = { n: 0 };
      rl.sweep = () => {
        calls.n += 1;
        return 0;
      };
      return calls;
    };
    const disposed = new RateLimiter({ sweepIntervalMs: 10 });
    const running = new RateLimiter({ sweepIntervalMs: 10 });
    const disposedCalls = counted(disposed);
    const runningCalls = counted(running);
    disposed.dispose();
    try {
      await expect.poll(() => runningCalls.n, { timeout: 2000 }).toBeGreaterThan(2);
      expect(disposedCalls.n).toBe(0);
    } finally {
      running.dispose();
    }
  });

  test("the timer is unref'ed: it never keeps the process alive", () => {
    // Resources that keep the event loop alive; an unref'ed timer is not one of them.
    const refTimers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
    const before = refTimers();

    const control = setInterval(() => {}, 60_000);
    expect(refTimers()).toBe(before + 1); // the probe does see a normal (ref'ed) interval
    clearInterval(control);

    const rl = new RateLimiter(); // default 60 s sweep
    expect(refTimers()).toBe(before);
    rl.dispose();
    expect(rl.size).toBe(0);
  });
});
