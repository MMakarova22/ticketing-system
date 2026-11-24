import { isIP } from "node:net";

/**
 * TRUST_PROXY (review M2): which proxies may set X-Forwarded-For, i.e. how Express derives req.ip, which the rate
 * limiter uses as the per-IP key. Disabled by default: X-Forwarded-For is then ignored and req.ip is the address of
 * the TCP peer. Pure module (no Nest imports) so it can be unit-tested.
 *
 * Accepted values:
 * - unset, empty, "false" or "0": disabled (default);
 * - a hop count 1–10: trust that many proxies in front of the app;
 * - a comma-separated list of the presets "loopback" and "uniquelocal" and/or IP addresses and CIDR ranges.
 * Rejected: "true" and any /0 range, because they would trust X-Forwarded-For from every client, letting anyone
 * choose their own rate-limit key.
 */
export type TrustProxySetting = false | number | string[];

export const TRUST_PROXY_PRESETS: ReadonlySet<string> = new Set(["loopback", "uniquelocal"]);
export const MAX_TRUST_PROXY_HOPS = 10;

export function parseTrustProxy(raw: string | undefined): { value: TrustProxySetting } | { error: string } {
  const text = raw?.trim() ?? "";
  const lower = text.toLowerCase();
  if (text === "" || lower === "false" || text === "0") {
    return { value: false };
  }
  if (lower === "true") {
    return {
      error:
        'TRUST_PROXY=true is not allowed: it would trust X-Forwarded-For from any client. Use a hop count, IP/CIDR list, "loopback" or "uniquelocal"',
    };
  }
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    return hops >= 1 && hops <= MAX_TRUST_PROXY_HOPS
      ? { value: hops }
      : { error: `TRUST_PROXY hop count must be between 1 and ${MAX_TRUST_PROXY_HOPS} (got "${text}")` };
  }

  const entries = text.split(",").map((entry) => entry.trim());
  const invalid = entries.filter((entry) => !isValidEntry(entry));
  if (invalid.length > 0) {
    return {
      error: `TRUST_PROXY has invalid entries (${invalid.map((e) => `"${e}"`).join(", ")}): use a hop count, or a comma-separated list of "loopback", "uniquelocal", IP addresses and CIDR ranges (no /0)`,
    };
  }
  return { value: entries.map((entry) => (TRUST_PROXY_PRESETS.has(entry.toLowerCase()) ? entry.toLowerCase() : entry)) };
}

/** Human-readable form for the startup log (contains no secrets). */
export function describeTrustProxy(setting: TrustProxySetting): string {
  if (setting === false) {
    return "disabled (X-Forwarded-For is ignored)";
  }
  return typeof setting === "number" ? `${setting} hop(s)` : setting.join(", ");
}

function isValidEntry(entry: string): boolean {
  if (TRUST_PROXY_PRESETS.has(entry.toLowerCase())) {
    return true;
  }
  const [address, prefix, extra] = entry.split("/");
  if (extra !== undefined || !address) {
    return false;
  }
  const family = isIP(address);
  if (family === 0) {
    return false;
  }
  if (prefix === undefined) {
    return true;
  }
  if (!/^\d+$/.test(prefix)) {
    return false;
  }
  const bits = Number(prefix);
  return bits >= 1 && bits <= (family === 4 ? 32 : 128);
}
