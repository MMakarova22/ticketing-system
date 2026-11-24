import { expect } from "@playwright/test";

/** Mailpit HTTP API (local SMTP inbox). Override with MAILPIT_URL when it runs elsewhere. */
export const MAILPIT_URL = (process.env.MAILPIT_URL ?? "http://localhost:8025").replace(/\/+$/, "");

interface MailpitSummary {
  ID: string;
  Created: string;
}

interface MailpitMessage {
  Text: string;
  Subject: string;
}

/** All messages sent to `email`, newest first. */
export async function listMessages(email: string): Promise<MailpitSummary[]> {
  const query = encodeURIComponent(`to:"${email}"`);
  const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=50`);
  if (!response.ok) {
    throw new Error(`Mailpit search failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { messages: MailpitSummary[] | null };
  return body.messages ?? [];
}

/** Waits until exactly `count` (or at least, when atLeast) messages for `email` exist, and returns them. */
export async function waitForMessageCount(email: string, count: number): Promise<MailpitSummary[]> {
  let messages: MailpitSummary[] = [];
  await expect
    .poll(
      async () => {
        messages = await listMessages(email);
        return messages.length;
      },
      { timeout: 15_000, message: `waiting for ${count} email(s) to ${email}` },
    )
    .toBeGreaterThanOrEqual(count);
  return messages;
}

/** Waits for the newest verification email to `email` and returns its link. */
export async function getVerificationLink(email: string, expectedCount = 1): Promise<string> {
  const messages = await waitForMessageCount(email, expectedCount);
  const newest = messages[0];
  if (!newest) {
    throw new Error(`No email found for ${email}`);
  }
  const response = await fetch(`${MAILPIT_URL}/api/v1/message/${newest.ID}`);
  const message = (await response.json()) as MailpitMessage;
  const match = /https?:\/\/\S+\/verify-email\?token=[A-Za-z0-9_\-%]+/.exec(message.Text);
  if (!match) {
    throw new Error(`No verification link in email to ${email}: ${message.Text}`);
  }
  return match[0];
}

export function tokenFromLink(link: string): string {
  const token = new URL(link).searchParams.get("token");
  if (!token) {
    throw new Error(`Link has no token: ${link}`);
  }
  return token;
}
