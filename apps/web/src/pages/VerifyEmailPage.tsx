import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { INVALID_OR_EXPIRED_TOKEN, PASSWORD_MAX, PASSWORD_MIN, useVerifyEmail } from "../api/auth.ts";
import { ApiError, errorMessage } from "../api/client.ts";
import { ResendVerification } from "../components/ResendVerification.tsx";

/**
 * Target of the link in the verification email (/verify-email?token=…). The token is read once, kept in memory and
 * removed from the address bar straight away. The user then chooses a password; submitting it verifies the email
 * and sets the password in one step (review M1). No automatic login (spec §3).
 */
export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [token] = useState(() => searchParams.get("token"));
  const verify = useVerifyEmail();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.has("token")) {
      void navigate("/verify-email", { replace: true });
    }
  }, [searchParams, navigate]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      return;
    }
    // Same rules as the API; the password is used exactly as typed (never trimmed).
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      setFormError(`Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`);
      return;
    }
    if (password !== confirmation) {
      setFormError("The passwords do not match.");
      return;
    }
    setFormError(null);
    verify.mutate({ token, password });
  }

  if (verify.isSuccess) {
    return (
      <section>
        <h1>Email verified</h1>
        <p className="alert alert-success" role="status">
          Your email address has been verified and your password has been set. You can now log in.
        </p>
        <Link to="/login" className="button">
          Continue to login
        </Link>
      </section>
    );
  }

  const linkRejected = verify.error instanceof ApiError && verify.error.code === INVALID_OR_EXPIRED_TOKEN;
  if (!token || linkRejected) {
    return (
      <section>
        <h1>Verification failed</h1>
        <p className="alert alert-error" role="alert">
          {linkRejected ? verify.error?.message : "The verification link is missing its token."}
        </p>
        <p>
          Links expire after 24 hours and can be used only once. Enter your email to get a new link. If your email is
          already verified, just <Link to="/login">log in</Link>.
        </p>
        <ResendVerification />
      </section>
    );
  }

  return (
    <section>
      <h1>Choose your password</h1>
      <p>Set the password for your account to finish verifying your email address.</p>
      <form className="form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="new-password-hint"
              required
            />
          </label>
          <small id="new-password-hint" className="muted">
            {PASSWORD_MIN}–{PASSWORD_MAX} characters.
          </small>
        </div>
        <label className="field">
          <span>Confirm password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
          />
        </label>
        {formError && (
          <p className="alert alert-error" role="alert">
            {formError}
          </p>
        )}
        {verify.isError && (
          // Any other error (validation, rate limit, network): the link was not used, so the form can be submitted again.
          <p className="alert alert-error" role="alert">
            {errorMessage(verify.error)}
          </p>
        )}
        <button type="submit" className="button" disabled={verify.isPending}>
          {verify.isPending ? "Verifying…" : "Verify email and set password"}
        </button>
      </form>
    </section>
  );
}
