import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useLogout, useMe } from "../../api/auth.ts";
import { ChevronDownIcon } from "../icons.tsx";

/**
 * Account menu: avatar (initial) + email; the panel shows the email and "Log out". A native <details> disclosure
 * (keyboard: Enter/Space toggles), closed on an outside click and on Escape (focus returns to the toggle).
 *
 * The summary's text content stays exactly the email (tests rely on it): the avatar letter is drawn by CSS from
 * data-initial and the chevron is an SVG.
 */
export function AccountMenu() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  const email = me.data?.email ?? "Account";
  const initial = me.data?.email?.trim().charAt(0).toUpperCase() ?? "?";

  // Registered once and checking the live `open` state, so there is no gap right after opening (the toggle event
  // and a React re-render would otherwise have to happen before an outside click or Escape is noticed).
  useEffect(() => {
    const isOpen = () => detailsRef.current?.open === true;
    const close = (restoreFocus: boolean) => {
      if (detailsRef.current) {
        detailsRef.current.open = false;
      }
      if (restoreFocus) {
        summaryRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (isOpen() && detailsRef.current && !detailsRef.current.contains(event.target as Node)) {
        close(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen()) {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function onLogout() {
    logout.mutate(undefined, { onSettled: () => void navigate("/login", { replace: true }) });
  }

  return (
    <details ref={detailsRef} className="account-menu">
      <summary
        ref={summaryRef}
        className="account-toggle"
        data-testid="user-menu"
        aria-label={`Account menu, ${email}`}
      >
        <span className="avatar" data-initial={initial} aria-hidden="true" />
        <span className="account-email">{email}</span>
        <ChevronDownIcon className="account-chevron" size={14} />
      </summary>
      <div className="account-panel">
        <p className="account-panel-label">Signed in as</p>
        <p className="account-panel-email" data-testid="account-email">
          {email}
        </p>
        <button type="button" className="button button-secondary" onClick={onLogout} disabled={logout.isPending}>
          {logout.isPending ? "Logging out…" : "Log out"}
        </button>
      </div>
    </details>
  );
}
