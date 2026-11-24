/** class-transformer helpers for DTOs. Non-string values are passed through so validators can reject them. */

/** Trims strings. */
export const trimString = ({ value }: { value: unknown }): unknown => (typeof value === "string" ? value.trim() : value);

/**
 * Lower-cases UUID strings (review L1). PostgreSQL returns UUIDs in lower case, so ids from the body must be lower
 * case too, or string comparisons with stored ids fail. Validation still runs on the transformed value.
 */
export const lowercaseUuid = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.toLowerCase() : value;

/** Trims strings and turns a blank string into null (for optional text fields such as descriptions). */
export const trimToNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};
