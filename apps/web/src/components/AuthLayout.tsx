import { Outlet } from "react-router";
import { BrandMark } from "./icons.tsx";
import { ThemeToggle } from "./layout/ThemeToggle.tsx";

/**
 * Shell for the public screens (sign-up, login, email verification, resend). The theme toggle is the same component
 * as in the top navigation, so the choice carries over to the app and back.
 */
export function AuthLayout() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-brand">
            <BrandMark />
            <span className="brand-wordmark">Ticket Tracker</span>
          </div>
          <ThemeToggle />
        </div>
        <Outlet />
      </div>
    </div>
  );
}
