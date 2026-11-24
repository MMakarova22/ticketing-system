/**
 * Returns only the fields of `incoming` whose values differ from `current` (D7).
 * Callers skip the database update entirely when the result is empty, because Prisma's `@updatedAt`
 * would otherwise advance `modifiedAt` on every update call, even when nothing changed.
 * Fields that are `undefined` in `incoming` are "not provided" and ignored. Dates are compared by time.
 * Shared by teams, epics and (from M3) tickets.
 */
export function pickChanges<T extends object>(current: T, incoming: { [K in keyof T]?: T[K] | undefined }): Partial<T> {
  const changes: Partial<T> = {};
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    const next = incoming[key];
    if (next === undefined) {
      continue;
    }
    if (!isSameValue(current[key], next)) {
      changes[key] = next as T[typeof key];
    }
  }
  return changes;
}

export function hasChanges(changes: object): boolean {
  return Object.keys(changes).length > 0;
}

function isSameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  return a === b;
}
