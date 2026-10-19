import { escapeHtml, sendEmails } from "@/lib/email.server";
import { APP_ENV_LABEL } from "@/lib/env";
import { logError } from "@/lib/log.server";
import { serverEnv } from "@/lib/server-env.server";
import { getAdminClient } from "@/lib/supabase-admin.server";

/**
 * Tells the people who manage the team about access changes and exports with
 * contact details (FR-TM-4, FR-CRM-11, S-6, D45). Each email names console
 * members only, never a customer, and links to the audit log for the rest.
 * A failed email never undoes or fails the action: it is logged instead.
 */

const when = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  dateStyle: "medium",
  timeStyle: "short",
});

/** Everyone whose role can manage the team: super admin, admins, mods. */
async function teamManagerEmails(): Promise<string[]> {
  const admin = getAdminClient();
  const [members, roles] = await Promise.all([
    admin.rpc("staff_list_admins"),
    admin.from("staff_role_defs").select("id").contains("permissions", ["team.manage"]),
  ]);
  if (members.error) throw new Error(members.error.message);
  if (roles.error) throw new Error(roles.error.message);
  const managing = new Set(((roles.data ?? []) as { id: string }[]).map((r) => r.id));
  return ((members.data ?? []) as { email: string; role_id: string }[])
    .filter((m) => managing.has(m.role_id) && m.email)
    .map((m) => m.email);
}

async function notifyManagers(subject: string, lines: string[]): Promise<void> {
  try {
    const env = serverEnv();
    const label = APP_ENV_LABEL[env.appEnv];
    const fullSubject = env.appEnv === "production" ? subject : `[${label}] ${subject}`;
    const audit = `${env.siteUrl}/audit`;
    const footer = `You get this because your role manages the Linara Business Console team (${label}). If you didn't expect it, check the audit log: ${audit}`;
    const text = [...lines, "", footer].join("\n");
    const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#23302e">${lines
      .map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`)
      .join("")}<p style="margin:16px 0 0;color:#5d6b68;font-size:12px">${escapeHtml(
      footer.replace(audit, ""),
    )}<a href="${escapeHtml(audit)}" style="color:#1F5A54">${escapeHtml(audit)}</a></p></div>`;

    const recipients = await teamManagerEmails();
    await sendEmails(recipients.map((to) => ({ to, subject: fullSubject, text, html })));
  } catch (e) {
    logError("team email", e);
  }
}

const now = () => when.format(new Date());

export function notifyMemberAdded(input: {
  actorEmail: string;
  memberEmail: string;
  roleName: string;
}): Promise<void> {
  return notifyManagers(`Team member added: ${input.memberEmail}`, [
    `${input.actorEmail} added ${input.memberEmail} to the Business Console team as ${input.roleName}, on ${now()} (Manila time).`,
  ]);
}

export function notifyMemberRemoved(input: {
  actorEmail: string;
  memberEmail: string;
}): Promise<void> {
  return notifyManagers(`Team member removed: ${input.memberEmail}`, [
    `${input.actorEmail} removed ${input.memberEmail} from the Business Console team, on ${now()} (Manila time). They were signed out everywhere.`,
  ]);
}

export function notifyContactsExported(input: { actorEmail: string; rows: number }): Promise<void> {
  return notifyManagers("CRM contacts exported with contact details", [
    `${input.actorEmail} downloaded ${input.rows === 1 ? "1 CRM contact" : `${input.rows} CRM contacts`} with names, emails and phone numbers, on ${now()} (Manila time).`,
    "The file holds personal data covered by the Data Privacy Act. It should be stored securely and deleted when no longer needed.",
  ]);
}
