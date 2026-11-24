import { type RefObject, useLayoutEffect, useRef } from "react";

/**
 * Keeps keyboard focus on a button that is disabled while its request runs. A browser drops focus to <body> when the
 * focused element becomes disabled; when `busy` turns false again and focus is still lost, it is returned to the
 * button (which is enabled again by then). If the request succeeded and the button is gone, or focus has been moved
 * elsewhere on purpose, nothing happens.
 */
export function useFocusAfterBusy(button: RefObject<HTMLElement | null>, busy: boolean) {
  const wasBusy = useRef(busy);
  useLayoutEffect(() => {
    if (wasBusy.current && !busy) {
      const active = document.activeElement;
      if (active === null || active === document.body) {
        button.current?.focus();
      }
    }
    wasBusy.current = busy;
  }, [busy, button]);
}
