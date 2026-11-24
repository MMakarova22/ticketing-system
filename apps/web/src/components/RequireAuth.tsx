import { Navigate, Outlet, useLocation } from "react-router";
import { useMe } from "../api/auth.ts";

/** Location state passed to /login so the user returns to the page they originally asked for. */
export interface LoginRedirectState {
  from?: string;
}

/** Renders child routes only for a logged-in (and therefore verified) user; otherwise redirects to /login. */
export function RequireAuth() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return <p className="page-status" role="status">Loading…</p>;
  }
  if (me.isError) {
    return (
      <div className="page-status">
        <p className="alert alert-error" role="alert">Could not check your session: {me.error.message}</p>
        <button type="button" className="button" onClick={() => void me.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (!me.data) {
    const state: LoginRedirectState = { from: `${location.pathname}${location.search}` };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}

/** Only same-app paths are accepted as a return target (no "//host" or absolute URLs). */
function safeReturnPath(state: unknown): string {
  const from = (state as LoginRedirectState | null)?.from;
  return from && from.startsWith("/") && !from.startsWith("//") ? from : "/";
}

/**
 * For login and sign-up: a logged-in user goes to the app. This also performs the redirect right after a
 * successful login (the login mutation stores the user), back to the page originally requested.
 */
export function RedirectIfAuthenticated() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) {
    return <p className="page-status" role="status">Loading…</p>;
  }
  if (me.data) {
    return <Navigate to={safeReturnPath(location.state)} replace />;
  }
  return <Outlet />;
}
