import { expect, test } from "@playwright/test";
import {
  applyChecks,
  clearFieldError,
  type FieldCheck,
  type FieldErrorState,
  fieldAria,
  fieldErrorId,
  firstFieldError,
  isFieldName,
  mergeIds,
  NO_FIELD_ERROR,
} from "../../apps/web/src/lib/validation.ts";

// Client-side field validation (UI redesign step 6a): the pure logic behind useFieldError.

type Field = "title" | "body";
const TITLE: FieldCheck<Field> = ["title", "Enter a ticket title.", false];
const BODY: FieldCheck<Field> = ["body", "Enter a ticket body.", false];
const ok = (check: FieldCheck<Field>): FieldCheck<Field> => [check[0], check[1], true];
// React 19's useId format (e.g. "_r_1_"), as the hook passes it.
const FORM = "_r_1_";

test.describe("firstFieldError()", () => {
  test("returns null when every check passes", () => {
    expect(firstFieldError([ok(TITLE), ok(BODY)])).toBeNull();
    expect(firstFieldError([])).toBeNull();
  });

  test("reports the first failing check in the given order, with its message unchanged", () => {
    expect(firstFieldError([TITLE, BODY])).toEqual({ field: "title", message: "Enter a ticket title." });
    expect(firstFieldError([ok(TITLE), BODY])).toEqual({ field: "body", message: "Enter a ticket body." });
  });
});

test.describe("applyChecks()", () => {
  test("a failure shows the error as a new attempt", () => {
    const state = applyChecks(NO_FIELD_ERROR as FieldErrorState<Field>, [TITLE, BODY]);
    expect(state).toEqual({ error: { field: "title", message: "Enter a ticket title." }, attempt: 1 });
  });

  test("the same failure again is still a new attempt (so the message is recreated and announced again)", () => {
    const first = applyChecks(NO_FIELD_ERROR as FieldErrorState<Field>, [TITLE]);
    const second = applyChecks(first, [TITLE]);
    expect(second.error).toEqual(first.error);
    expect(second.attempt).toBe(first.attempt + 1);
  });

  test("success clears the error without starting an attempt (nothing to focus)", () => {
    const failed = applyChecks(NO_FIELD_ERROR as FieldErrorState<Field>, [TITLE]);
    expect(applyChecks(failed, [ok(TITLE)])).toEqual({ error: null, attempt: 1 });
  });

  test("success with nothing to clear returns the same state object (no re-render)", () => {
    const state = NO_FIELD_ERROR as FieldErrorState<Field>;
    expect(applyChecks(state, [ok(TITLE)])).toBe(state);
  });
});

test.describe("clearFieldError()", () => {
  test("clears the error of the changed field only", () => {
    const failed = applyChecks(NO_FIELD_ERROR as FieldErrorState<Field>, [TITLE]);
    expect(clearFieldError(failed, "title")).toEqual({ error: null, attempt: 1 });
    expect(clearFieldError(failed, "body")).toBe(failed);
  });

  test("returns the same state object when there is nothing to clear", () => {
    const state = NO_FIELD_ERROR as FieldErrorState<Field>;
    expect(clearFieldError(state, "title")).toBe(state);
  });
});

test.describe("field names and ids", () => {
  test("field names must be simple identifiers", () => {
    for (const name of ["name", "teamId", "epic_id", "body-2"]) {
      expect(isFieldName(name), name).toBe(true);
    }
    for (const name of ["", "team name", "2fa", "a.b", "a#b", " title", "título"]) {
      expect(isFieldName(name), JSON.stringify(name)).toBe(false);
    }
  });

  test("error ids are unique per form and field and contain no whitespace", () => {
    const id = fieldErrorId(FORM, "title");
    expect(id).toBe("_r_1_-title-error");
    expect(id).not.toBe(fieldErrorId("_r_2_", "title"));
    expect(id).not.toBe(fieldErrorId(FORM, "body"));
    expect(id).not.toMatch(/\s/);
  });

  test("an invalid field name or form id throws (a programming error)", () => {
    expect(() => fieldErrorId(FORM, "team name")).toThrow(/Invalid field name/);
    expect(() => fieldErrorId("", "title")).toThrow(/Invalid form id/);
    expect(() => fieldErrorId("a b", "title")).toThrow(/Invalid form id/);
  });
});

test.describe("mergeIds()", () => {
  test("joins id lists, drops empty values and duplicates", () => {
    expect(mergeIds("hint", "err")).toBe("hint err");
    expect(mergeIds(" hint  other ", undefined, false, null, "", "err hint")).toBe("hint other err");
    expect(mergeIds(undefined, false)).toBeUndefined();
    expect(mergeIds("  ")).toBeUndefined();
  });
});

test.describe("fieldAria()", () => {
  const failed = applyChecks(NO_FIELD_ERROR as FieldErrorState<Field>, [TITLE]);
  const errorId = fieldErrorId(FORM, "title");

  test("the invalid field: aria-invalid true and described by the message", () => {
    expect(fieldAria(failed, "title", FORM)).toEqual({ "aria-invalid": true, "aria-describedby": errorId });
  });

  test("own descriptions are kept, the message id is added after them", () => {
    expect(fieldAria(failed, "title", FORM, { describedBy: "title-hint" })).toEqual({
      "aria-invalid": true,
      "aria-describedby": `title-hint ${errorId}`,
    });
  });

  test("other fields, and the field once cleared, keep their own values", () => {
    expect(fieldAria(failed, "body", FORM, { describedBy: "body-hint", invalid: "false" })).toEqual({
      "aria-invalid": "false",
      "aria-describedby": "body-hint",
    });
    const cleared = clearFieldError(failed, "title");
    expect(fieldAria(cleared, "title", FORM, { describedBy: "title-hint", invalid: "spelling" })).toEqual({
      "aria-invalid": "spelling",
      "aria-describedby": "title-hint",
    });
    expect(fieldAria(cleared, "title", FORM)).toEqual({ "aria-invalid": undefined, "aria-describedby": undefined });
  });

  test("an invalid field name throws on every render, not only when an error is shown", () => {
    expect(() => fieldAria(NO_FIELD_ERROR as FieldErrorState<string>, "bad name", FORM)).toThrow(/Invalid field name/);
  });
});
