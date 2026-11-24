import { expect, test } from "@playwright/test";
import { attachRef, createRefCallbackCache } from "../../apps/web/src/lib/refs.ts";

// attachRef() and the ref callback cache: how useFieldError merges a field's own ref (React 19 ref semantics).

test.describe("attachRef()", () => {
  test("object ref: current is set, then reset to null on detach", () => {
    const ref: { current: string | null } = { current: null };
    const detach = attachRef(ref, "input");
    expect(ref.current).toBe("input");
    detach();
    expect(ref.current).toBeNull();
  });

  test("callback ref without cleanup: called with the value, then with null on detach", () => {
    const calls: (string | null)[] = [];
    const detach = attachRef<string>((value) => void calls.push(value), "input");
    expect(calls).toEqual(["input"]);
    detach();
    expect(calls).toEqual(["input", null]);
  });

  test("callback ref with a cleanup function: the cleanup runs on detach, the ref is not called with null", () => {
    const calls: (string | null)[] = [];
    const detach = attachRef<string>((value) => {
      calls.push(value);
      return () => void calls.push("cleanup");
    }, "input");
    detach();
    expect(calls).toEqual(["input", "cleanup"]);
  });

  test("no ref: nothing happens", () => {
    expect(() => attachRef(undefined, "input")()).not.toThrow();
    expect(() => attachRef(null, "input")()).not.toThrow();
  });
});

test.describe("createRefCallbackCache()", () => {
  function setUp() {
    const made: [string, object | undefined][] = [];
    const cache = createRefCallbackCache((field: string, own) => {
      made.push([field, own]);
      return () => [field, own];
    });
    return { cache, made };
  }

  test("the same (field, own ref) pair always gets the same callback; it is created once", () => {
    const { cache, made } = setUp();
    const own = { current: null };
    const first = cache("title", own);
    expect(cache("title", own)).toBe(first);
    expect(cache("title", own)).toBe(first);
    expect(made).toEqual([["title", own]]);
  });

  test("a different own ref gets a different callback, and the earlier one is never replaced", () => {
    const { cache, made } = setUp();
    const ownA = { current: null };
    const ownB = (_element: unknown) => {};
    const a = cache("title", ownA);
    const b = cache("title", ownB);
    expect(b).not.toBe(a);
    expect(b()).toEqual(["title", ownB]);
    // Going back to A (e.g. after a render React abandoned with B) returns the original callback, not a new one.
    expect(cache("title", ownA)).toBe(a);
    expect(made).toEqual([
      ["title", ownA],
      ["title", ownB],
    ]);
  });

  test("no own ref: one stable callback per field (null and undefined share it)", () => {
    const { cache, made } = setUp();
    const plain = cache("title", undefined);
    expect(cache("title", null)).toBe(plain);
    expect(cache("body", undefined)).not.toBe(plain);
    expect(plain()).toEqual(["title", undefined]);
    expect(made).toEqual([
      ["title", undefined],
      ["body", undefined],
    ]);
  });

  test("the same own ref on two fields gets one callback per field", () => {
    const { cache } = setUp();
    const own = { current: null };
    expect(cache("title", own)).not.toBe(cache("body", own));
    expect(cache("body", own)()).toEqual(["body", own]);
  });
});
