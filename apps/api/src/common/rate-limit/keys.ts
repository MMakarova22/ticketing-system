import { createHash } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";

/**
 * Rate-limit keys (review M2). Pure functions without Nest or Prisma imports, so they can be unit-tested.
 * Keys never contain a raw email address: emails are SHA-256 hashed.
 */

/** Key used when the client address is missing or unparsable; all such requests share one bucket. */
export const UNKNOWN_CLIENT = "unknown";

/**
 * Normalizes the client address used as the per-IP key:
 * - IPv4 stays as it is;
 * - an IPv4-mapped IPv6 address (::ffff:192.0.2.1, also in hex form) becomes the IPv4 address;
 * - any other IPv6 address becomes its /64 prefix (one end-user network usually owns a whole /64), e.g.
 *   "2001:db8:1:2::/64", so rotating addresses inside a /64 does not escape the limit;
 * - a zone index ("fe80::1%eth0") is ignored; anything else unparsable becomes UNKNOWN_CLIENT.
 */
export function normalizeClientIp(address: string | undefined | null): string {
  if (!address) {
    return UNKNOWN_CLIENT;
  }
  const ip = address.trim().split("%")[0] ?? "";
  if (isIPv4(ip)) {
    return ip;
  }
  if (!isIPv6(ip)) {
    return UNKNOWN_CLIENT;
  }
  const groups = expandIPv6(ip);
  if (!groups) {
    return UNKNOWN_CLIENT;
  }
  // ::ffff:a.b.c.d (IPv4-mapped): first 80 bits zero, next 16 bits all ones.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const hi = groups[6]!;
    const lo = groups[7]!;
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

/** Expands a valid IPv6 address (optionally with an embedded IPv4 tail) to its eight 16-bit groups. */
function expandIPv6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  // Embedded IPv4 tail ("::ffff:192.0.2.1", "64:ff9b::192.0.2.1") -> two hex groups.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!isIPv4(tail)) {
      return null;
    }
    const [a, b, c, d] = tail.split(".").map(Number) as [number, number, number, number];
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) {
    return null;
  }
  const parse = (part: string | undefined): number[] =>
    part ? part.split(":").map((g) => Number.parseInt(g, 16)) : [];
  const head = parse(halves[0]);
  const rest = parse(halves[1]);
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) {
    return null;
  }
  const groups = [...head, ...Array<number>(halves.length === 2 ? missing : 0).fill(0), ...rest];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * Per-email key: SHA-256 of the email trimmed and lower-cased (the same normalization as the auth DTOs), so the
 * limiter never holds a raw email address and every spelling of one account shares a bucket.
 */
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
}
