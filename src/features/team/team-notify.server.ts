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

type Notice = {
  subject: string;
  /** One line shown before the email is opened. */
  preview: string;
  heading: string;
  intro: string;
  details: [label: string, value: string][];
  /** A highlighted reminder under the details. */
  note?: string;
};

// Brand colours from src/styles.css, as in supabase/email-templates/invite.html.
const C = {
  page: "#faf3e6",
  card: "#fefbf6",
  pine: "#26574e",
  ink: "#131d1b",
  muted: "#576764",
  line: "#efe7d8",
  attention: "#fbe9dc",
  attentionInk: "#7a3413",
};
const SANS = "'Nunito Sans', Arial, Helvetica, sans-serif";
const SERIF = "Literata, Georgia, 'Times New Roman', serif";

/** Email-safe HTML: tables and inline styles only, every value escaped (S-15). */
function renderHtml(n: Notice, env: { label: string; auditUrl: string }): string {
  const e = escapeHtml;
  const rows = n.details
    .map(
      ([label, value], i) => `
        <tr>
          <td style="padding:${i ? "8px" : "0"} 16px 0 0;color:${C.muted};white-space:nowrap;vertical-align:top">${e(label)}</td>
          <td style="padding:${i ? "8px" : "0"} 0 0 0;color:${C.ink};font-weight:bold;word-break:break-word">${e(value)}</td>
        </tr>`,
    )
    .join("");
  const note = n.note
    ? `<p style="margin:0 0 24px 0;padding:14px 18px;background-color:${C.attention};border-radius:12px;font-size:14px;line-height:1.6;color:${C.attentionInk}">${e(n.note)}</p>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${e(n.subject)}</title></head>
<body style="margin:0;padding:0;background-color:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page}">${e(n.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.page}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
  <tr><td style="padding:0 4px 20px 4px">
    <span style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:bold;letter-spacing:-0.5px;color:${C.pine}">linara</span>
    <span style="font-family:${SANS};font-size:13px;font-weight:bold;color:${C.muted};padding-left:8px">Business Console</span>
    <span style="font-family:${SANS};font-size:12px;font-weight:bold;color:${C.attentionInk};background-color:${C.attention};border-radius:999px;padding:3px 10px;margin-left:8px">${e(env.label)}</span>
  </td></tr>
  <tr><td style="background-color:${C.card};border-radius:20px;padding:32px 28px;font-family:${SANS};color:${C.ink}">
    <h1 style="margin:0 0 14px 0;font-family:${SERIF};font-size:24px;line-height:1.3;font-weight:normal;color:${C.ink}">${e(n.heading)}</h1>
    <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6">${e(n.intro)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;background-color:${C.page};border-radius:14px">
      <tr><td style="padding:18px 20px;font-size:14px;line-height:1.5">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">${rows}</table>
      </td></tr>
    </table>
    ${note}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" bgcolor="${C.pine}" style="border-radius:12px">
        <a href="${e(env.auditUrl)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:15px;font-weight:bold;color:${C.card};text-decoration:none;border-radius:12px">Open the audit log</a>
      </td>
    </tr></table>
    <p style="margin:24px 0 0 0;padding-top:20px;border-top:1px solid ${C.line};font-size:13px;line-height:1.6;color:${C.muted}">If you didn't expect this, check the audit log and tell the super admin straight away.</p>
  </td></tr>
  <tr><td style="padding:20px 4px 0 4px;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.muted}">
    You get this because your role manages the Linara Business Console team. This is an automatic message; replies aren't read.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function renderText(n: Notice, env: { label: string; auditUrl: string }): string {
  const width = Math.max(...n.details.map(([label]) => label.length));
  return [
    `Linara Business Console (${env.label})`,
    "",
    n.heading,
    "",
    n.intro,
    "",
    ...n.details.map(([label, value]) => `${label.padEnd(width)}  ${value}`),
    ...(n.note ? ["", n.note] : []),
    "",
    `Audit log: ${env.auditUrl}`,
    "",
    "If you didn't expect this, check the audit log and tell the super admin straight away.",
    "You get this because your role manages the Linara Business Console team.",
  ].join("\n");
}

async function notifyManagers(n: Notice): Promise<void> {
  try {
    const env = serverEnv();
    const label = APP_ENV_LABEL[env.appEnv];
    const subject = env.appEnv === "production" ? n.subject : `[${label}] ${n.subject}`;
    const ctx = { label, auditUrl: `${env.siteUrl}/audit` };
    const text = renderText(n, ctx);
    const html = renderHtml(n, ctx);

    const recipients = await teamManagerEmails();
    await sendEmails(recipients.map((to) => ({ to, subject, text, html })));
  } catch (e) {
    logError("team email", e);
  }
}

const now = () => `${when.format(new Date())} (Manila time)`;

export function notifyMemberAdded(input: {
  actorEmail: string;
  memberEmail: string;
  roleName: string;
}): Promise<void> {
  return notifyManagers({
    subject: `Team member added: ${input.memberEmail}`,
    preview: `${input.actorEmail} added ${input.memberEmail} as ${input.roleName}.`,
    heading: "A team member was added",
    intro: `${input.actorEmail} added ${input.memberEmail} to the Business Console team as ${input.roleName}.`,
    details: [
      ["New member", input.memberEmail],
      ["Role", input.roleName],
      ["Added by", input.actorEmail],
      ["When", now()],
    ],
  });
}

export function notifyMemberRemoved(input: {
  actorEmail: string;
  memberEmail: string;
}): Promise<void> {
  return notifyManagers({
    subject: `Team member removed: ${input.memberEmail}`,
    preview: `${input.actorEmail} removed ${input.memberEmail} from the team.`,
    heading: "A team member was removed",
    intro: `${input.actorEmail} removed ${input.memberEmail} from the Business Console team. They were signed out everywhere.`,
    details: [
      ["Removed", input.memberEmail],
      ["Removed by", input.actorEmail],
      ["When", now()],
    ],
  });
}

export function notifyContactsExported(input: { actorEmail: string; rows: number }): Promise<void> {
  const count = input.rows === 1 ? "1 CRM contact" : `${input.rows} CRM contacts`;
  return notifyManagers({
    subject: "CRM contacts exported with contact details",
    preview: `${input.actorEmail} downloaded ${count} with names, emails and phone numbers.`,
    heading: "CRM contacts were exported",
    intro: `${input.actorEmail} downloaded ${count} with names, emails and phone numbers.`,
    details: [
      ["Exported by", input.actorEmail],
      ["Contacts", String(input.rows)],
      ["When", now()],
    ],
    note: "The file holds personal data covered by the Data Privacy Act. It should be stored securely and deleted when no longer needed.",
  });
}
