import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useLogin } from "../api/auth.ts";
import { errorMessage } from "../api/client.ts";

export function LoginPage() {
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setFormError("Enter your email and password.");
      return;
    }
    setFormError(null);
    // On success the stored user makes RedirectIfAuthenticated navigate to the originally requested page.
    login.mutate({ email, password });
  }

  return (
    <section>
      <h1>Log in</h1>
      <form className="form" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {formError && (
          <p className="alert alert-error" role="alert">
            {formError}
          </p>
        )}
        {/* One generic message for wrong password, unknown email and unverified account alike (review M1);
            a 429 shows when to try again (review M2). */}
        {login.isError && (
          <p className="alert alert-error" role="alert">
            {errorMessage(login.error)}
          </p>
        )}
        <button type="submit" className="button" disabled={login.isPending}>
          {login.isPending ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="auth-footer">
        No account yet? <Link to="/signup">Sign up</Link>
      </p>
      <p className="auth-footer">
        Didn't get your verification email? <Link to="/resend-verification">Resend it</Link>
      </p>
    </section>
  );
}
