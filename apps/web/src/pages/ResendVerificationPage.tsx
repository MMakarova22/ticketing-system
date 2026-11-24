import { Link } from "react-router";
import { ResendVerification } from "../components/ResendVerification.tsx";

/**
 * Requests a new verification link (linked from the login page). The confirmation is the same whatever the server
 * did, because the API never reveals whether an email is registered or already verified (D6).
 */
export function ResendVerificationPage() {
  return (
    <section>
      <h1>Resend verification email</h1>
      <p>
        Enter the email address you signed up with. If the account still needs verification, we'll send a new link;
        open it to choose your password. Links are valid for 24 hours and can be used once.
      </p>
      <ResendVerification />
      <p className="auth-footer">
        Already verified? <Link to="/login">Log in</Link>
      </p>
    </section>
  );
}
