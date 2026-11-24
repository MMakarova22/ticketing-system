import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useRegister } from "../api/auth.ts";
import { errorMessage } from "../api/client.ts";
import { ResendVerification } from "../components/ResendVerification.tsx";

/** Sign-up asks for the email only; the password is chosen from the link in the verification email (review M1). */
export function SignupPage() {
  const register = useRegister();
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) {
      setFormError("Enter your email address.");
      return;
    }
    setFormError(null);
    register.mutate(email);
  }

  if (register.isSuccess) {
    const sentTo = email.trim().toLowerCase();
    return (
      <section>
        <h1>Check your inbox</h1>
        <p className="alert alert-success" role="status">
          {register.data.message}
        </p>
        <p>
          We sent a verification link to <strong>{sentTo}</strong>. The link is valid for 24 hours. Open it to choose
          your password, then log in.
        </p>
        <p className="muted">Didn't get the email?</p>
        <ResendVerification email={sentTo} />
        <p className="auth-footer">
          <Link to="/login">Go to login</Link>
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1>Sign up</h1>
      <form className="form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby="signup-email-hint"
              required
            />
          </label>
          <small id="signup-email-hint" className="muted">
            We'll email you a link to verify your address and choose your password.
          </small>
        </div>
        {formError && (
          <p className="alert alert-error" role="alert">
            {formError}
          </p>
        )}
        {register.isError && (
          <p className="alert alert-error" role="alert">
            {errorMessage(register.error)}
          </p>
        )}
        <button type="submit" className="button" disabled={register.isPending}>
          {register.isPending ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="auth-footer">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </section>
  );
}
