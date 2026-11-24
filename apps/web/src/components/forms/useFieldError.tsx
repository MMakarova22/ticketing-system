import { type Ref, type RefCallback, useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { attachRef, createRefCallbackCache } from "../../lib/refs.ts";
import {
  type AriaInvalid,
  applyChecks,
  clearFieldError,
  type FieldCheck,
  type FieldErrorState,
  fieldAria,
  fieldErrorId,
  firstFieldError,
  NO_FIELD_ERROR,
} from "../../lib/validation.ts";

type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** A field's own ARIA values and ref, kept and merged by `fieldProps`. */
export interface OwnFieldProps<E extends FieldElement> {
  ref?: Ref<E> | undefined;
  describedBy?: string | undefined;
  invalid?: AriaInvalid;
}

/**
 * The ref callback of one field (merged with the field's own ref). It records the element for focusing and attaches the
 * own ref; React 19 calls the returned cleanup on detach (instead of calling the ref with null), so exactly this element
 * is removed, even if another element has taken the field's place in the meantime.
 */
function fieldRefCallback<F>(
  elements: Map<F, FieldElement>,
  field: F,
  own: Ref<FieldElement> | undefined,
): RefCallback<FieldElement> {
  return (element) => {
    if (!element) {
      return undefined;
    }
    elements.set(field, element);
    const detachOwn = attachRef(own, element);
    return () => {
      if (elements.get(field) === element) {
        elements.delete(field);
      }
      detachOwn();
    };
  };
}

/**
 * Field-level client-side validation for a form (UI redesign step 6a). Field names must be simple identifiers
 * ("name", "teamId", "body"); they become part of element ids.
 *
 * - `validate(checks)`: runs the checks in field order. On the first failure the message is shown at that field and,
 *   once React has committed it (aria-invalid, aria-describedby and the message are in the DOM), focus moves to the
 *   field; returns false. On success the message is cleared, focus is not touched, and it returns true.
 * - `fieldProps(field, own?)`: spread on the input/select/textarea. Gives a ref (merged with `own.ref`), aria-invalid
 *   (true while the field has the error, otherwise `own.invalid`) and aria-describedby (`own.describedBy` plus the
 *   message id while the field has the error).
 * - `errorMessage(field)`: the message (`role="alert"`) or nothing. Render it after the field's `<label>`, not inside
 *   it, so it describes the field instead of becoming part of its name. Each failed submit recreates it, so the same
 *   message is announced again.
 * - `clearField(field)`: call from the field's onChange; clears the message if it belongs to that field.
 *
 * Server errors are not handled here: forms show them as one form-level alert, and focus stays where it is.
 */
export function useFieldError<F extends string>() {
  const formId = useId();
  const [state, setState] = useState<FieldErrorState<F>>(NO_FIELD_ERROR);
  const elements = useRef(new Map<F, FieldElement>());
  // Created once (lazy initialization); see createRefCallbackCache for why filling it during render is safe.
  const refCallbacks = useRef<((field: F, own: object | null | undefined) => RefCallback<FieldElement>) | null>(null);
  refCallbacks.current ??= createRefCallbackCache((field: F, own) =>
    fieldRefCallback(elements.current, field, own as Ref<FieldElement> | undefined),
  );
  const focusRequest = useRef<F | null>(null);

  const validate = useCallback((checks: readonly FieldCheck<F>[]): boolean => {
    const error = firstFieldError(checks);
    focusRequest.current = error?.field ?? null;
    setState((current) => applyChecks(current, checks));
    return error === null;
  }, []);

  const clearField = useCallback((field: F) => setState((current) => clearFieldError(current, field)), []);
  const clear = useCallback(() => setState((current) => (current.error === null ? current : { ...current, error: null })), []);

  // Every failed validation is a new attempt; focus after the commit, so the field is already marked invalid and
  // described by the message when the screen reader announces it.
  useLayoutEffect(() => {
    const field = focusRequest.current;
    focusRequest.current = null;
    const element = field === null ? undefined : elements.current.get(field);
    if (element && !element.disabled && element !== document.activeElement) {
      element.focus();
    }
  }, [state.attempt]);

  function fieldProps<E extends FieldElement>(field: F, own: OwnFieldProps<E> = {}) {
    return {
      // One stable callback per (field, own ref): React does not detach and reattach it on every render.
      ref: refCallbacks.current!(field, own.ref) as RefCallback<E>,
      ...fieldAria(state, field, formId, { describedBy: own.describedBy, invalid: own.invalid }),
    };
  }

  function errorMessage(field: F) {
    if (state.error?.field !== field) {
      return null;
    }
    return (
      <small key={state.attempt} id={fieldErrorId(formId, field)} className="field-error" role="alert">
        {state.error.message}
      </small>
    );
  }

  return { error: state.error, validate, clearField, clear, fieldProps, errorMessage };
}
