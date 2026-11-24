/**
 * Client-side form validation (UI redesign step 6a). A form lists its checks in field order; the first failing one is
 * reported at its field. Only one message at a time, like the forms always did: the same text, one role="alert".
 * Server errors are not field errors; forms keep showing them as one form-level alert.
 *
 * Everything here is pure; `useFieldError` (components/forms) wires it to React.
 */

export interface FieldError<F extends string = string> {
  field: F;
  message: string;
}

/** One check: the field it belongs to, the message shown when it fails, and whether it passed. */
export type FieldCheck<F extends string> = readonly [field: F, message: string, passed: boolean];

/** The first failing check in the given order, or null when every check passed. */
export function firstFieldError<F extends string>(checks: readonly FieldCheck<F>[]): FieldError<F> | null {
  for (const [field, message, passed] of checks) {
    if (!passed) {
      return { field, message };
    }
  }
  return null;
}

// --- State -----------------------------------------------------------------------------------------------------------

export interface FieldErrorState<F extends string> {
  /** The field error shown, or null. */
  error: FieldError<F> | null;
  /**
   * Counts failed validations. Each failure gets a new number, even with the same field and message, so the message
   * element is recreated (and announced again) and focus moves to the field again.
   */
  attempt: number;
}

export const NO_FIELD_ERROR: FieldErrorState<never> = { error: null, attempt: 0 };

/** The state after running the checks: a failure shows its error as a new attempt; success clears the error. */
export function applyChecks<F extends string>(
  state: FieldErrorState<F>,
  checks: readonly FieldCheck<F>[],
): FieldErrorState<F> {
  const error = firstFieldError(checks);
  if (error) {
    return { error, attempt: state.attempt + 1 };
  }
  return state.error === null ? state : { ...state, error: null };
}

/** The state after the user changed `field`: its error (if shown) is cleared. Unchanged state is returned as is. */
export function clearFieldError<F extends string>(state: FieldErrorState<F>, field: F): FieldErrorState<F> {
  return state.error?.field === field ? { ...state, error: null } : state;
}

// --- Ids and ARIA ----------------------------------------------------------------------------------------------------

/**
 * Field names become part of element ids, and aria-describedby is a space-separated id list, so a name must be a
 * simple identifier: a letter, then letters, digits, "_" or "-" (e.g. "name", "teamId", "body").
 */
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function isFieldName(field: string): boolean {
  return FIELD_NAME.test(field);
}

/**
 * Element id of a field's error message, unique per form instance and field. `formId` comes from React's useId
 * (React 19: e.g. "_r_1_"). Throws for a field name that is not a simple identifier (a programming error).
 */
export function fieldErrorId(formId: string, field: string): string {
  if (!isFieldName(field)) {
    throw new Error(`Invalid field name for an element id: ${JSON.stringify(field)}`);
  }
  if (formId === "" || /\s/.test(formId)) {
    throw new Error(`Invalid form id: ${JSON.stringify(formId)}`);
  }
  return `${formId}-${field}-error`;
}

/** Joins id lists (each may hold several space-separated ids), dropping empty values and duplicates. */
export function mergeIds(...lists: (string | null | undefined | false)[]): string | undefined {
  const ids = new Set<string>();
  for (const list of lists) {
    for (const id of (list || "").split(/\s+/)) {
      if (id) {
        ids.add(id);
      }
    }
  }
  return ids.size > 0 ? [...ids].join(" ") : undefined;
}

export type AriaInvalid = boolean | "true" | "false" | "grammar" | "spelling" | undefined;

/**
 * ARIA props of a field: while it has the error, aria-invalid is true and aria-describedby also points at the message
 * (after the field's own descriptions). Otherwise the field's own values are kept unchanged.
 */
export function fieldAria<F extends string>(
  state: FieldErrorState<F>,
  field: F,
  formId: string,
  own: { describedBy?: string | undefined; invalid?: AriaInvalid } = {},
): { "aria-invalid": AriaInvalid; "aria-describedby": string | undefined } {
  const errorId = fieldErrorId(formId, field);
  const hasError = state.error?.field === field;
  return {
    "aria-invalid": hasError ? true : own.invalid,
    "aria-describedby": mergeIds(own.describedBy, hasError && errorId),
  };
}
