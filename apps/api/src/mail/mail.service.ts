import { Inject, Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { APP_CONFIG, type AppConfig } from "../config/app-config.ts";

/** Sends application email through the configured SMTP server (Mailpit locally, or a corporate SMTP relay if configured). */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const { host, port, secure, user, pass } = config.smtp;
    this.transporter = createTransport({
      host,
      port,
      secure,
      ...(user ? { auth: { user, pass: pass ?? "" } } : {}),
    });
  }

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    const link = `${this.config.appBaseUrl}/verify-email?token=${encodeURIComponent(token)}`;
    const text = [
      "Welcome to Ticket Tracker!",
      "",
      "Confirm your email address and choose your password by opening this link:",
      link,
      "",
      "The link expires in 24 hours and can be used once.",
      "If you did not sign up, you can ignore this email.",
    ].join("\n");
    const html = `<p>Welcome to Ticket Tracker!</p>
<p>Confirm your email address and choose your password by opening this link:</p>
<p><a href="${link}">Verify my email and set my password</a></p>
<p>The link expires in 24 hours and can be used once.<br>If you did not sign up, you can ignore this email.</p>`;

    await this.transporter.sendMail({
      from: this.config.smtp.from,
      to,
      subject: "Verify your email for Ticket Tracker",
      text,
      html,
    });
  }

  /** Fire-and-forget variant: failures are logged (without the token) and never reach the HTTP response. */
  sendVerificationEmailInBackground(to: string, token: string): void {
    this.sendVerificationEmail(to, token).catch((error: unknown) => {
      this.logger.error(`Failed to send verification email: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
