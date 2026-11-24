import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { hashEmail, normalizeClientIp, UNKNOWN_CLIENT } from "../../apps/api/src/common/rate-limit/keys.ts";

test.describe("normalizeClientIp", () => {
  const cases: [string | undefined | null, string][] = [
    // IPv4 unchanged (surrounding spaces ignored).
    ["203.0.113.7", "203.0.113.7"],
    [" 203.0.113.7 ", "203.0.113.7"],
    // IPv4-mapped IPv6 -> IPv4, in every spelling.
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["::FFFF:203.0.113.7", "203.0.113.7"],
    ["::ffff:cb00:7107", "203.0.113.7"],
    ["0:0:0:0:0:ffff:203.0.113.7", "203.0.113.7"],
    ["0000:0000:0000:0000:0000:ffff:cb00:7107", "203.0.113.7"],
    // Other IPv6 -> /64 prefix, whatever the spelling or the interface part.
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"],
    ["2001:0DB8:0001:0002:ffff::1", "2001:db8:1:2::/64"],
    ["2001:db8:1:2::", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    // Not IPv4-mapped (NAT64 well-known prefix): stays IPv6.
    ["64:ff9b::192.0.2.1", "64:ff9b:0:0::/64"],
    // Missing or unparsable -> one shared bucket.
    [undefined, UNKNOWN_CLIENT],
    [null, UNKNOWN_CLIENT],
    ["", UNKNOWN_CLIENT],
    ["not-an-ip", UNKNOWN_CLIENT],
    ["1.2.3.4.5", UNKNOWN_CLIENT],
    ["2001:db8::1::2", UNKNOWN_CLIENT],
    ["::ffff:999.0.0.1", UNKNOWN_CLIENT],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} -> ${expected}`, () => {
      expect(normalizeClientIp(input)).toBe(expected);
    });
  }

  test("all addresses of one /64 share a key; neighbouring /64s do not", () => {
    const a = normalizeClientIp("2001:db8:aa:bb:1::1");
    expect(normalizeClientIp("2001:db8:aa:bb:ffff:ffff:ffff:ffff")).toBe(a);
    expect(normalizeClientIp("2001:db8:aa:bc::1")).not.toBe(a);
  });
});

test.describe("hashEmail", () => {
  test("is the SHA-256 of the trimmed, lower-cased email and never contains the address", () => {
    const expected = createHash("sha256").update("alice@example.test").digest("hex");
    for (const spelling of ["alice@example.test", "  Alice@Example.TEST ", "ALICE@EXAMPLE.TEST"]) {
      const key = hashEmail(spelling);
      expect(key).toBe(expected);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key.toLowerCase()).not.toContain("alice");
    }
    expect(hashEmail("bob@example.test")).not.toBe(expected);
  });
});
