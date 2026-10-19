import { serverEnv } from "./server-env.server";

/**
 * The console's own emails, sent through Resend's HTTP API with plain fetch,
 * so no library is added (D19, D45). Supabase still sends its auth emails
 * (invites, password resets) itself.
 */

export type Email = { to: string; subject: string; text: string; html: string };

const BATCH_URL = "https://api.resend.com/emails/batch";
const BATCH_MAX = 100;
const TIMEOUT_MS = 8000;

/**
 * Sends each email on its own, so recipients never see each other. Without a
 * key it sends nothing and says so. In development and staging,
 * `EMAIL_TEST_RECIPIENT` receives every email instead of the real recipients.
 * Throws on a failed send; callers decide whether that matters.
 */
export async function sendEmails(emails: Email[]): Promise<"sent" | "skipped"> {
  const env = serverEnv();
  if (!env.resendApiKey || emails.length === 0) return "skipped";

  const outgoing = env.emailTestRecipient
    ? emails.map((e) => ({
        ...e,
        to: env.emailTestRecipient as string,
        subject: `[test, for ${e.to}] ${e.subject}`,
      }))
    : emails;

  for (let i = 0; i < outgoing.length; i += BATCH_MAX) {
    const batch = outgoing.slice(i, i + BATCH_MAX).map((e) => ({
      from: env.emailFrom,
      to: [e.to],
      subject: e.subject,
      text: e.text,
      html: e.html,
    }));
    const res = await fetch(BATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // Resend's message names the problem (bad key, unverified domain), never our data.
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend ${res.status}: ${detail.slice(0, 300)}`);
    }
  }
  return "sent";
}

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for an email's HTML part (S-15). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}
