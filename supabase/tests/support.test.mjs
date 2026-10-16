// Runs 010-support.sql and 011-support-fixes.sql against a real Postgres (PGlite): support tickets and
// notes are closed to the app roles, every write leaves its audit row with no
// text, and processing a deletion clears that person's tickets (FR-SP-1 to
// FR-SP-7, FR-DB-5, FR-DL-6, S-22, S-23, D37).
//
//   bun run test:sql
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const db = new PGlite();
let failures = 0;

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label}${detail !== undefined && !ok ? ` -> ${JSON.stringify(detail)}` : ""}`,
  );
};
const expectError = async (label, fn, pattern) => {
  try {
    await fn();
    check(label, false, "no error");
  } catch (e) {
    check(label, pattern.test(e.message), e.message);
  }
};
const as = async (role, fn) => {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("RESET ROLE");
  }
};
const svc = (sql, params) => as("service_role", () => q(sql, params));
const one = async (sql, params) => (await svc(sql, params))[0];
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

for (const file of [
  "tests/stub-supabase.sql",
  "tests/stub-main-app.sql",
  "tests/stub-cron.sql",
  "001-staff-foundation.sql",
  "002-visibility.sql",
  "003-visibility-fixes.sql",
  "004-crm.sql",
  "005-crm-fixes.sql",
  "006-crm-data.sql",
  "007-crm-export.sql",
  "008-account-actions.sql",
  "009-account-actions-fixes.sql",
  "010-support.sql",
  "011-support-fixes.sql",
]) {
  await db.exec(readFileSync(resolve(REPO, file), "utf8"));
}

const [A1, A2] = [id(900), id(901)];
const [U, M] = [id(1), id(2)];
const H = id(11);
const [LEAD, CM] = [id(21), id(22)];
const [REQ] = [id(31)];
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${U}', 'ana@example.com'), ('${M}', 'mona@example.com'),
    ('${A1}', 'a1@example.com'), ('${A2}', 'a2@example.com');
  INSERT INTO public.staff_roles (user_id, role) VALUES ('${A1}', 'admin'), ('${A2}', 'admin');
  INSERT INTO public.user_profiles (id, full_name, user_type) VALUES
    ('${U}', 'Ana Reyes', 'primary_manager'), ('${M}', 'Mona Other', 'co_manager');
  INSERT INTO public.households (id, name) VALUES ('${H}', 'Reyes home');
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES
    ('${H}', '${U}', 'primary_manager'), ('${H}', '${M}', 'co_manager');
  INSERT INTO public.crm_contacts (id, full_name, email, created_by) VALUES
    ('${LEAD}', 'Lia Lead', 'lia@example.com', '${A1}');
  INSERT INTO public.crm_contacts (id, user_id, created_by) VALUES ('${CM}', '${M}', '${A1}');
  INSERT INTO public.account_deletion_requests (id, user_id, user_type, status)
    VALUES ('${REQ}', '${M}', 'co_manager', 'pending');
`);

// --- tables (§8.1, S-27) --------------------------------------------------------------
for (const role of ["anon", "authenticated"]) {
  for (const table of ["support_tickets", "support_ticket_notes"]) {
    await expectError(
      `${role} can't read ${table}`,
      () => as(role, () => q(`SELECT * FROM public.${table}`)),
      /permission denied/,
    );
  }
}

// --- create (FR-SP-1, FR-SP-6) --------------------------------------------------------
const audits = async () =>
  q(`SELECT action, target_type, target_id, metadata FROM public.staff_audit_log ORDER BY id`);
const create = (o = {}) => {
  const t = {
    subject: "Can't add a helper",
    body: "Ana says the invite code fails",
    channel: "messenger",
    category: "account",
    priority: "normal",
    contact: "Ana R. on Messenger",
    user: null,
    household: null,
    contact_id: null,
    assignee: null,
    ...o,
  };
  return one(
    `SELECT public.support_create_ticket($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) AS id`,
    [
      A1,
      t.subject,
      t.body,
      t.channel,
      t.category,
      t.priority,
      t.contact,
      t.user,
      t.household,
      t.contact_id,
      t.assignee,
    ],
  ).then((r) => r.id);
};
let before = (await audits()).length;
const T1 = await create({
  user: U,
  household: H,
  subject: "Can't add <img src=x onerror=alert(1)>",
});
const t1 = (await q(`SELECT ref, status FROM public.support_tickets WHERE id = $1`, [T1]))[0];
const created = (await audits()).slice(before);
check("numbers count up from 1000", Number(t1.ref) === 1000 && t1.status === "open", t1);
check(
  "create records the ticket and one audit row",
  created.length === 1 &&
    created[0].action === "support.ticket_created" &&
    created[0].target_type === "ticket" &&
    created[0].target_id === T1 &&
    created[0].metadata.category === "account",
  created,
);
const T2 = await create({
  subject: "Payout missing",
  category: "payout",
  priority: "high",
  contact_id: LEAD,
  channel: "viber",
  contact: null,
});
const T3 = await create({
  subject: "100% wrong total_pay",
  category: "pay",
  priority: "low",
  assignee: A2,
  user: M,
});
await expectError("a bad channel is refused", () => create({ channel: "tiktok" }), /check/);

// --- status, assign, priority, links, notes (FR-SP-3 to FR-SP-5, FR-SP-7) -------------
const status = (t, s) => svc(`SELECT public.support_set_status($1, $2, $3)`, [A1, t, s]);
before = (await audits()).length;
await status(T1, "resolved");
let row = (
  await q(`SELECT status, resolved_at FROM public.support_tickets WHERE id = $1`, [T1])
)[0];
check("resolving sets resolved_at", row.status === "resolved" && row.resolved_at !== null, row);
await status(T1, "closed");
await status(T1, "open");
row = (await q(`SELECT status, resolved_at FROM public.support_tickets WHERE id = $1`, [T1]))[0];
const statusAudit = (await audits()).slice(before);
check(
  "status moves and reopens, resolved_at follows",
  row.status === "open" && row.resolved_at === null && statusAudit.length === 3,
  { row, statusAudit },
);
check(
  "status change locks the row and records from and to",
  statusAudit[2].action === "support.status_changed" &&
    statusAudit[2].metadata.from === "closed" &&
    statusAudit[2].metadata.to === "open",
  statusAudit[2],
);
before = (await audits()).length;
await status(T1, "open");
check("a same-value change records nothing", (await audits()).length === before);

await svc(`SELECT public.support_assign($1, $2, $3)`, [A1, T1, A1]);
await svc(`SELECT public.support_assign($1, $2, NULL)`, [A1, T1]);
const assigns = (await audits()).filter((a) => a.action === "support.assigned");
check(
  "assign and unassign",
  assigns.length === 2 &&
    assigns[0].metadata.assignee_id === A1 &&
    assigns[1].metadata.assignee_id === null,
  assigns,
);
await svc(`SELECT public.support_set_priority($1, $2, 'high')`, [A1, T1]);
check(
  "priority changes are recorded",
  (await audits()).at(-1).action === "support.priority_changed",
);
await svc(`SELECT public.support_set_links($1, $2, $3, NULL, $4)`, [A1, T1, U, LEAD]);
const links = (await audits()).at(-1);
check(
  "links change with booleans in the audit",
  links.action === "support.links_changed" &&
    links.metadata.user === true &&
    links.metadata.household === false &&
    links.metadata.contact === true,
  links,
);
const updatedBefore = (
  await q(`SELECT updated_at FROM public.support_tickets WHERE id = $1`, [T2])
)[0].updated_at;
await svc(`SELECT public.support_add_note($1, $2, $3)`, [
  A1,
  T2,
  "Replied on Viber: checking with Xendit",
]);
const t2 = (await q(`SELECT updated_at FROM public.support_tickets WHERE id = $1`, [T2]))[0];
check(
  "notes add and bump updated_at",
  t2.updated_at > updatedBefore &&
    (
      await q(`SELECT count(*)::int AS n FROM public.support_ticket_notes WHERE ticket_id = $1`, [
        T2,
      ])
    )[0].n === 1,
);
await expectError(
  "an empty note is refused",
  () => svc(`SELECT public.support_add_note($1, $2, '')`, [A1, T2]),
  /check|note/i,
);

// --- reads (FR-DB-5) ------------------------------------------------------------------
const list = async (o = {}) => {
  const p = {
    search: null,
    status: null,
    assignee: null,
    category: null,
    priority: null,
    user: null,
    household: null,
    contact: null,
    ...o,
  };
  return svc(`SELECT * FROM public.support_list_tickets($1, $2, $3, $4, $5, $6, $7, $8, 50, 0)`, [
    p.search,
    p.status,
    p.assignee,
    p.category,
    p.priority,
    p.user,
    p.household,
    p.contact,
  ]);
};
const ids = (rows) =>
  rows
    .map((r) => r.ticket_id)
    .sort()
    .join();
check(
  "active lists open and waiting",
  ids(await list({ status: "active" })) === [T1, T2, T3].sort().join(),
);
check("mine", ids(await list({ assignee: A2 })) === T3);
check("unassigned", ids(await list({ assignee: "unassigned" })) === [T1, T2].sort().join());
check("category and priority", ids(await list({ category: "payout", priority: "high" })) === T2);
check("by user", ids(await list({ user: U })) === T1);
check("by household", ids(await list({ household: H })) === "");
check("by contact", ids(await list({ contact: LEAD })) === [T1, T2].sort().join());
check("search finds a ticket by number", ids(await list({ search: "LIN-1001" })) === T2);
check("search by bare number", ids(await list({ search: "1001" })) === T2);
check("search escapes wildcards", ids(await list({ search: "100%" })) === T3);
check(
  "search finds the contact handle",
  ids(await list({ search: "on messenger" })) === [T1, T3].sort().join(),
);
check(
  "a user and a contact together match either (FR-CRM-12)",
  ids(await list({ user: U, contact: LEAD })) === [T1, T2].sort().join(),
);
check(
  "a user and a contact still narrow by status",
  ids(await list({ user: U, contact: LEAD, status: "closed" })) === "",
);
const all = await list();
check(
  "high priority comes first",
  all[0].priority === "high",
  all.map((r) => r.priority),
);
const detail = (await one(`SELECT public.support_get_ticket($1) AS d`, [T1])).d;
check(
  "detail names its links",
  detail.user_name === "Ana Reyes" &&
    detail.contact_name === "Lia Lead" &&
    Array.isArray(detail.notes),
  detail,
);
const counts = (await one(`SELECT public.support_counts() AS c`)).c;
check("counts", counts.open === 3 && counts.pending === 0 && counts.unassigned === 2, counts);

// --- privacy (S-22, FR-DL-6, S-23) ---------------------------------------------------------
await svc(`SELECT public.crm_delete_lead($1, $2)`, [A1, LEAD]);
check(
  "deleting a lead keeps its tickets",
  (await q(`SELECT contact_id FROM public.support_tickets WHERE id = $1`, [T2]))[0].contact_id ===
    null,
);
const allAudit = JSON.stringify(await audits());
check(
  "audit holds no text",
  ![
    "Can't add",
    "onerror",
    "invite code",
    "Payout missing",
    "Messenger",
    "Xendit",
    "wrong total",
  ].some((s) => allAudit.includes(s)),
  allAudit,
);

await svc(`SELECT public.support_add_note($1, $2, $3)`, [A1, T3, "Mona called back"]);
await svc(`SELECT public.staff_process_deletion($1, $2)`, [A1, REQ]);
const t3 = (
  await q(
    `SELECT subject, body, contact, status, category, created_at FROM public.support_tickets WHERE id = $1`,
    [T3],
  )
)[0];
const t3notes = await q(`SELECT body FROM public.support_ticket_notes WHERE ticket_id = $1`, [T3]);
const REMOVED = "Removed after the account was deleted";
check(
  "deletion clears the person's tickets",
  t3.subject === REMOVED &&
    t3.body === REMOVED &&
    t3.contact === null &&
    t3.status === "open" &&
    t3.category === "pay" &&
    t3notes.every((n) => n.body === REMOVED),
  { t3, t3notes },
);
check(
  "other people's tickets are untouched",
  (await q(`SELECT subject FROM public.support_tickets WHERE id = $1`, [T1]))[0].subject.startsWith(
    "Can't add",
  ),
);

// --- assignee must be a current admin (FR-SP-4) ------------------------------------
await expectError(
  "can't assign a ticket to someone who isn't an admin",
  () => svc(`SELECT public.support_assign($1, $2, $3)`, [A1, T1, U]),
  /Pick a current admin/,
);
await expectError(
  "can't log a ticket assigned to someone who isn't an admin",
  () => create({ assignee: M }),
  /Pick a current admin/,
);
await svc(`SELECT public.support_assign($1, $2, $3)`, [A1, T1, A2]);
check(
  "a current admin can be assigned",
  (await q(`SELECT assignee_id FROM public.support_tickets WHERE id = $1`, [T1]))[0].assignee_id ===
    A2,
);
await svc(`SELECT public.support_assign($1, $2, NULL)`, [A1, T1]);

for (const role of ["anon", "authenticated"]) {
  for (const call of [
    `support_list_tickets(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 50, 0)`,
    `support_get_ticket('${T1}')`,
    `support_counts()`,
    `support_add_note('${A1}', '${T1}', 'x')`,
  ]) {
    await expectError(
      `${role} can't run ${call.split("(")[0]}`,
      () => as(role, () => q(`SELECT * FROM public.${call}`)),
      /permission denied/,
    );
  }
}

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
