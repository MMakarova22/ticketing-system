import type { Ref } from "react";

/**
 * Attaches `value` to a React ref (callback or object) and returns the matching detach function, following React 19
 * semantics: a callback ref that returned a cleanup function gets that cleanup on detach, otherwise it is called with
 * null; an object ref's `current` is set and later reset to null. A missing ref is a no-op.
 */
export function attachRef<T>(ref: Ref<T> | undefined, value: T): () => void {
  if (ref == null) {
    return () => {};
  }
  if (typeof ref === "function") {
    const cleanup = ref(value);
    return typeof cleanup === "function" ? cleanup : () => void ref(null);
  }
  ref.current = value;
  return () => {
    ref.current = null;
  };
}

/**
 * An add-only cache of ref callbacks keyed by field and by the field's own ref (React ref objects and callback refs are
 * objects, so they key a WeakMap; "no own ref" has its own slot). An existing callback is never replaced, so the same
 * (field, own ref) pair always gets the same callback and React never detaches/reattaches it needlessly. Filling the
 * cache during render is idempotent lazy initialization: a render React abandons can only add an entry, never change
 * one in use. Entries for own refs that are no longer used are garbage-collected with them.
 */
export function createRefCallbackCache<F, C>(make: (field: F, own: object | undefined) => C) {
  const byField = new Map<F, { plain?: C; byOwn: WeakMap<object, C> }>();
  return (field: F, own: object | null | undefined): C => {
    let entry = byField.get(field);
    if (!entry) {
      entry = { byOwn: new WeakMap() };
      byField.set(field, entry);
    }
    if (own == null) {
      entry.plain ??= make(field, undefined);
      return entry.plain;
    }
    let callback = entry.byOwn.get(own);
    if (callback === undefined) {
      callback = make(field, own);
      entry.byOwn.set(own, callback);
    }
    return callback;
  };
}
