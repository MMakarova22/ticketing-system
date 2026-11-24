import { type FormEvent, useState } from "react";
import { useResendVerification } from "../api/auth.ts";
import { errorMessage } from "../api/client.ts";

/**
 * "Resend verification email" action. With a known email it is a single button; otherwise it asks for the email.
 * The confirmation is the same whatever the server did, because the API never reveals account state (D6).
 */
export function ResendVerification({ email }: { email?: string }) {
  const resend = useResendVerification();
  const [typedEmail, setTypedEmail] = useState("");
  const target = email ?? typedEmail;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (target.trim()) {
      resend.mutate(target);
    }
  }

  return (
    <form className="resend" onSubmit={onSubmit} noValidate>
      {email === undefined && (
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={typedEmail}
            onChange={(event) => setTypedEmail(event.target.value)}
            required
          />
        </label>
      )}
      <button type="submit" className="button button-secondary" disabled={resend.isPending || !target.trim()}>
        {resend.isPending ? "Sending…" : "Resend verification email"}
      </button>
      {resend.isSuccess && (
        <p className="alert alert-info" role="status">
          {resend.data.message} You can request another email after 60 seconds.
        </p>
      )}
      {resend.isError && (
        <p className="alert alert-error" role="alert">
          {errorMessage(resend.error)}
        </p>
      )}
    </form>
  );
}
