// Runs 019-support-in-app.sql against a real Postgres (PGlite): a household manager
// opens an in-app ticket and talks to the team from the app, sees only their own
// household's in-app tickets, the team sees unread tickets first and replies with an
// audit row holding ids only, a household message reopens a resolved ticket, a
// processed deletion clears the conversation, the new table and every function are
// closed to the wrong roles, and running 019 again changes nothing.
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

// A signed-in household account: auth.uid() reads test.uid in the stub.
const asUser = async (uid, sql, params) => {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid ?? ""]);
  try {
    return await as("authenticated", () => q(sql, params));
  } finally {
    await db.query(`SELECT set_config('test.uid', '', false)`);
  }
};
const hh = async (uid, sql, params) => (await asUser(uid, sql, params))[0]?.r;

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
  "012-operations.sql",
]) {
  await db.exec(readFileSync(resolve(REPO, file), "utf8"));
}

const A1 = id(900);
const [M1, M2, M3] = [id(1), id(2), id(3)];
const [H1, H2] = [id(11), id(12)];
const [REQ1, REQ3] = [id(31), id(33)];
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${A1}', 'a1@example.com'),
    ('${M1}', 'ana@example.com'), ('${M2}', 'bea@example.com'), ('${M3}', 'carla@example.com');
  INSERT INTO public.staff_roles (user_id, role) VALUES ('${A1}', 'admin');
`);
await db.exec(readFileSync(resolve(REPO, "013-roles.sql"), "utf8"));
await db.exec(readFileSync(resolve(REPO, "014-roles-fixes.sql"), "utf8"));

const SQL_019 = readFileSync(resolve(REPO, "019-support-in-app.sql"), "utf8");

// --- first run refuses CHECKs under other names (each attempt is rolled back) -------------
const firstRunWith = async (setup) => {
  await db.exec(`BEGIN; ${setup}`);
  try {
    await db.exec(SQL_019);
    return "applied";
  } catch (e) {
    return e.message;
  } finally {
    await db.exec("ROLLBACK");
  }
};
const EXPECTED =
  "019: expected constraints support_tickets_channel_check and support_tickets_category_check (created inline by 010); found";
let refused = await firstRunWith(`
  ALTER TABLE public.support_tickets DROP CONSTRAINT support_tickets_channel_check;
  ALTER TABLE public.support_tickets DROP CONSTRAINT support_tickets_category_check;`);
check("a first run without 010's CHECKs is refused", refused === `${EXPECTED} none`, refused);
refused = await firstRunWith(`
  ALTER TABLE public.support_tickets RENAME CONSTRAINT support_tickets_channel_check TO channel_ok;`);
check(
  "a first run with a renamed CHECK is refused and names what it found",
  refused === `${EXPECTED} channel_ok, support_tickets_category_check`,
  refused,
);
check(
  "a refused run leaves 010's CHECKs as they were",
  (
    await q(
      `SELECT count(*)::int AS n FROM pg_constraint
       WHERE conrelid = 'public.support_tickets'::regclass
         AND conname IN ('support_tickets_channel_check', 'support_tickets_category_check')
         AND pg_get_constraintdef(oid) NOT LIKE '%in_app%'
         AND pg_get_constraintdef(oid) NOT LIKE '%billing%'`,
    )
  )[0].n === 2,
);

await db.exec(SQL_019);
await db.exec(SQL_019);

await db.exec(`
  INSERT INTO public.user_profiles (id, full_name, user_type) VALUES
    ('${M1}', 'Ana Reyes', 'primary_manager'), ('${M2}', 'Bea Cruz', 'primary_manager'),
    ('${M3}', 'Carla Reyes', 'co_manager');
  INSERT INTO public.households (id, name) VALUES ('${H1}', 'Reyes home'), ('${H2}', 'Cruz home');
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES
    ('${H1}', '${M1}', 'primary_manager'), ('${H2}', '${M2}', 'primary_manager'),
    ('${H1}', '${M3}', 'co_manager');
  INSERT INTO public.account_deletion_requests (id, user_id, user_type, status) VALUES
    ('${REQ1}', '${M1}', 'primary_manager', 'pending'),
    ('${REQ3}', '${M3}', 'co_manager', 'pending');
`);

// --- schema, twice (one CHECK per column, RLS on, closed table) --------------------------
const checksOn = async () =>
  Object.fromEntries(
    (
      await q(`
        SELECT a.attname AS col, count(*)::int AS n, string_agg(pg_get_constraintdef(c.oid), ' ') AS def
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'public.support_tickets'::regclass AND c.contype = 'c'
          AND a.attname IN ('channel', 'category')
        GROUP BY a.attname`)
    ).map((r) => [r.col, r]),
  );
let cons = await checksOn();
check(
  "after two runs: one channel CHECK with in_app, one category CHECK with billing",
  cons.channel?.n === 1 &&
    cons.channel.def.includes("in_app") &&
    cons.category?.n === 1 &&
    cons.category.def.includes("billing"),
  cons,
);
const cols = await q(`
  SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'support_tickets'
    AND column_name IN ('household_unread', 'staff_unread', 'last_message_at')
  ORDER BY column_name`);
check(
  "unread counts default to 0, last_message_at is a nullable timestamptz",
  cols.length === 3 &&
    cols
      .filter((c) => c.column_name.endsWith("_unread"))
      .every(
        (c) => c.data_type === "integer" && c.is_nullable === "NO" && c.column_default === "0",
      ) &&
    cols.find((c) => c.column_name === "last_message_at").data_type === "timestamp with time zone",
  cols,
);
const rls = (
  await q(
    `SELECT relrowsecurity AS rls,
            (SELECT count(*)::int FROM pg_policies WHERE tablename = 'support_ticket_messages') AS policies
     FROM pg_class WHERE oid = 'public.support_ticket_messages'::regclass`,
  )
)[0];
check("messages table has RLS on and no policies", rls.rls === true && rls.policies === 0, rls);
for (const role of ["anon", "authenticated"]) {
  await expectError(
    `${role} can't read support_ticket_messages`,
    () => as(role, () => q(`SELECT * FROM public.support_ticket_messages`)),
    /permission denied/,
  );
}

// --- a staff-logged ticket for the same household stays internal ------------------------
const create = (o) =>
  one(`SELECT public.support_create_ticket($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, NULL) AS id`, [
    A1,
    o.subject,
    o.body,
    o.channel,
    o.category,
    o.priority,
    null,
    o.user ?? null,
    o.household,
  ]).then((r) => r.id);
const TV = await create({
  subject: "Payout missing",
  body: "Ana called about a payout",
  channel: "viber",
  category: "payout",
  priority: "high",
  household: H1,
});

// --- open (household) -----------------------------------------------------------------
const open = (uid, household, subject, body) =>
  hh(uid, `SELECT public.household_support_open($1, $2, $3) AS r`, [household, subject, body]);
const listOf = (uid, household) =>
  hh(uid, `SELECT public.household_support_list($1) AS r`, [household]);
const messagesOf = (uid, ticket) =>
  hh(uid, `SELECT public.household_support_messages($1) AS r`, [ticket]);
const post = (uid, ticket, body) =>
  hh(uid, `SELECT public.household_support_post($1, $2) AS r`, [ticket, body]);
const markRead = (uid, ticket) =>
  hh(uid, `SELECT public.household_support_mark_read($1) AS r`, [ticket]);
const row = async (ticket) =>
  (await q(`SELECT * FROM public.support_tickets WHERE id = $1`, [ticket]))[0];
const msgs = (ticket) =>
  q(`SELECT * FROM public.support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at, id`, [
    ticket,
  ]);

const T = await open(M1, H1, "  Can't add a helper  ", "The invite code says expired.\n");
let t = await row(T);
check(
  "open makes an in_app ticket for the household, waiting on the team",
  t.channel === "in_app" &&
    t.category === "other" &&
    t.priority === "normal" &&
    t.status === "open" &&
    t.user_id === M1 &&
    t.created_by === M1 &&
    t.household_id === H1 &&
    t.contact === null &&
    t.staff_unread === 1 &&
    t.household_unread === 0 &&
    t.last_message_at !== null &&
    t.subject === "Can't add a helper",
  t,
);
let m = await msgs(T);
check(
  "the body is the first message, from the household",
  m.length === 1 &&
    m[0].from_staff === false &&
    m[0].author_id === M1 &&
    m[0].body === "The invite code says expired.",
  m,
);
let mine = await listOf(M1, H1);
check(
  "the household list shows it with its number and no unread replies",
  mine.length === 1 &&
    mine[0].id === T &&
    Number(mine[0].ref) >= 1000 &&
    mine[0].household_unread === 0 &&
    mine[0].status === "open" &&
    Object.keys(mine[0]).sort().join() ===
      "created_at,household_unread,id,last_message_at,ref,status,subject",
  mine,
);
check(
  "a co-manager of the household sees it too",
  (await listOf(M3, H1)).map((x) => x.id).join() === T,
);

// --- isolation -----------------------------------------------------------------------
const T2 = await open(M2, H2, "Billing question", "Can I pay yearly?");
check("another household sees only its own", (await listOf(M2, H2)).map((x) => x.id).join() === T2);
check(
  "the first household doesn't see the second's",
  (await listOf(M1, H1)).map((x) => x.id).join() === T,
);
for (const [label, fn] of [
  ["list another household", () => listOf(M2, H1)],
  ["read another household's ticket", () => messagesOf(M2, T)],
  ["post on another household's ticket", () => post(M2, T, "hello")],
  ["mark another household's ticket read", () => markRead(M2, T)],
  ["open a ticket for another household", () => open(M2, H1, "x", "y")],
  ["read a ticket the team logged", () => messagesOf(M1, TV)],
  ["post on a ticket the team logged", () => post(M1, TV, "hi")],
  ["read a ticket that doesn't exist", () => messagesOf(M1, id(999))],
  ["list with no session", () => listOf(null, H1)],
]) {
  await expectError(`NOT_FOUND: ${label}`, fn, /^NOT_FOUND$/);
}
check("nothing was written by the refused calls", (await msgs(T)).length === 1);

// --- input ---------------------------------------------------------------------------
await expectError(
  "a 121-character subject is refused",
  () => open(M1, H1, "s".repeat(121), "b"),
  /^BAD_INPUT:subject$/,
);
await expectError(
  "a blank subject is refused",
  () => open(M1, H1, "   ", "b"),
  /^BAD_INPUT:subject$/,
);
await expectError("an empty body is refused", () => open(M1, H1, "s", " \n "), /^BAD_INPUT:body$/);
await expectError(
  "a 4001-character body is refused",
  () => open(M1, H1, "s", "b".repeat(4001)),
  /^BAD_INPUT:body$/,
);
await expectError("an empty message is refused", () => post(M1, T, ""), /^BAD_INPUT:body$/);
check("refused input leaves one ticket for the household", (await listOf(M1, H1)).length === 1);

// --- staff inbox ---------------------------------------------------------------------
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
let inbox = await list();
check(
  "unread in-app tickets come before a high-priority one",
  inbox.length === 3 &&
    [inbox[0].ticket_id, inbox[1].ticket_id].sort().join() === [T, T2].sort().join() &&
    inbox[2].ticket_id === TV,
  inbox.map((r) => [r.ticket_id, r.priority, r.staff_unread]),
);
const inT = inbox.find((r) => r.ticket_id === T);
check(
  "a list row carries channel, staff_unread and last_message_at",
  inT.channel === "in_app" &&
    inT.staff_unread === 1 &&
    inT.last_message_at instanceof Date &&
    inbox[2].channel === "viber" &&
    inbox[2].staff_unread === 0 &&
    inbox[2].last_message_at === null,
  inT,
);
check(
  "filter by household still works",
  ids(await list({ household: H1 })) === [T, TV].sort().join(),
);
check(
  "filter by category still works",
  ids(await list({ category: "other" })) === [T, T2].sort().join(),
);
check("filter by user still works", ids(await list({ user: M1 })) === T);
check("search by number still works", ids(await list({ search: `LIN-${t.ref}` })) === T);
check(
  "status and priority filters still work",
  ids(await list({ status: "active", priority: "high" })) === TV,
);

let detail = (await one(`SELECT public.support_get_ticket($1) AS d`, [T])).d;
check(
  "detail has the conversation and both unread counts",
  detail.channel === "in_app" &&
    detail.household_unread === 0 &&
    detail.staff_unread === 1 &&
    typeof detail.last_message_at === "string" &&
    detail.household_name === "Reyes home" &&
    Array.isArray(detail.notes) &&
    detail.messages.length === 1 &&
    detail.messages[0].body === "The invite code says expired." &&
    detail.messages[0].from_staff === false &&
    detail.messages[0].ticket_id === T &&
    Object.keys(detail.messages[0]).sort().join() ===
      "author_id,body,created_at,from_staff,id,ticket_id",
  detail,
);

// --- reply (staff) -------------------------------------------------------------------
const audits = () =>
  q(`SELECT action, target_type, target_id, metadata FROM public.staff_audit_log ORDER BY id`);
let before = (await audits()).length;
const lastAt = t.last_message_at;
const R1 = (
  await one(`SELECT public.support_reply($1, $2, $3) AS id`, [A1, T, "  Sent you a new code.  "])
).id;
t = await row(T);
const replied = (await audits()).slice(before);
check(
  "a reply is unread for the household and read for the team",
  t.household_unread === 1 && t.staff_unread === 0 && t.last_message_at > lastAt,
  t,
);
check(
  "a reply records one audit row with the ticket id only",
  replied.length === 1 &&
    replied[0].action === "support.replied" &&
    replied[0].target_type === "ticket" &&
    replied[0].target_id === T &&
    JSON.stringify(replied[0].metadata) === "{}",
  replied,
);
inbox = await list();
check(
  "once answered, the ticket drops back into the usual order",
  inbox.map((r) => r.ticket_id).join() === [T2, TV, T].join(),
  inbox.map((r) => r.ticket_id),
);
await expectError(
  "a reply on a ticket the team logged is refused",
  () => svc(`SELECT public.support_reply($1, $2, 'hi')`, [A1, TV]),
  /didn't come from the app/,
);
await expectError(
  "an empty reply is refused",
  () => svc(`SELECT public.support_reply($1, $2, '  ')`, [A1, T]),
  /up to 4,000 characters/,
);
await expectError(
  "a reply to a missing ticket is refused",
  () => svc(`SELECT public.support_reply($1, $2, 'hi')`, [A1, id(999)]),
  /doesn't exist/,
);

mine = await listOf(M1, H1);
check("the household sees one unread reply", mine[0].household_unread === 1, mine);
m = await messagesOf(M1, T);
check(
  "the household reads the conversation oldest first",
  m.length === 2 &&
    m[0].from_staff === false &&
    m[1].from_staff === true &&
    m[1].id === R1 &&
    m[1].body === "Sent you a new code.",
  m,
);
check(
  "the household never sees a team member's account id, only its own",
  m[0].author_id === M1 && m[1].author_id === null && !JSON.stringify(m).includes(A1),
  m,
);
check(
  "the staff detail keeps the replying team member's id",
  (await one(`SELECT public.support_get_ticket($1) AS d`, [T])).d.messages[1].author_id === A1,
);
await markRead(M1, T);
check(
  "marking read clears the household's count",
  (await listOf(M1, H1))[0].household_unread === 0,
);

// --- reopen ----------------------------------------------------------------------------
await svc(`SELECT public.support_set_status($1, $2, 'resolved')`, [A1, T]);
check("the team resolves it", (await row(T)).status === "resolved");
const P1 = await post(M1, T, "Still says expired.");
t = await row(T);
check(
  "a household message reopens a resolved ticket and waits on the team",
  typeof P1 === "string" &&
    t.status === "open" &&
    t.resolved_at === null &&
    t.staff_unread === 1 &&
    t.household_unread === 0,
  t,
);
check("the reopened ticket is first in the inbox again", (await list())[0].ticket_id === T);
await svc(`SELECT public.support_staff_mark_read($1, $2)`, [A1, T]);
check("the team marks it read", (await row(T)).staff_unread === 0);
await svc(`SELECT public.support_set_status($1, $2, 'closed')`, [A1, T]);
await post(M3, T, "Carla here: it worked on my phone.");
t = await row(T);
check(
  "a co-manager's message reopens a closed ticket",
  t.status === "open" && t.staff_unread === 1,
  t,
);
await svc(`SELECT public.support_set_status($1, $2, 'pending')`, [A1, T]);
await post(M1, T, "Thanks!");
t = await row(T);
check(
  "a message on a waiting ticket opens it and counts up",
  t.status === "open" && t.staff_unread === 2,
  t,
);

// --- audit holds no words (S-22) -------------------------------------------------------
const allAudit = JSON.stringify(await audits());
check(
  "audit holds no message text",
  !["invite code", "new code", "Still says", "Carla here", "Thanks", "Can't add", "yearly"].some(
    (s) => allAudit.includes(s),
  ),
  allAudit,
);

// --- privileges ------------------------------------------------------------------------
const householdCalls = [
  `household_support_list('${H1}')`,
  `household_support_open('${H1}', 's', 'b')`,
  `household_support_messages('${T}')`,
  `household_support_post('${T}', 'b')`,
  `household_support_mark_read('${T}')`,
];
const helperCalls = [
  `household_support_require('${H1}')`,
  `household_support_ticket('${T}', false)`,
  `household_support_clean('x', 10, 'f')`,
];
const staffCalls = [
  `support_reply('${A1}', '${T}', 'x')`,
  `support_staff_mark_read('${A1}', '${T}')`,
  `support_get_ticket('${T}')`,
  `support_list_tickets(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 50, 0)`,
  `staff_process_deletion('${A1}', '${REQ1}')`,
];
for (const call of [...householdCalls, ...helperCalls, ...staffCalls]) {
  await expectError(
    `anon can't run ${call.split("(")[0]}`,
    () => as("anon", () => q(`SELECT public.${call}`)),
    /permission denied/,
  );
}
for (const call of [...helperCalls, ...staffCalls]) {
  await expectError(
    `authenticated can't run ${call.split("(")[0]}`,
    () => asUser(M1, `SELECT public.${call}`),
    /permission denied/,
  );
}

// --- the staff form takes the new values -----------------------------------------------
const TS = await create({
  subject: "Invoice question",
  body: "Asked in the app before 019",
  channel: "in_app",
  category: "billing",
  priority: "normal",
  household: null,
});
check("support_create_ticket accepts channel in_app and category billing", typeof TS === "string");
await expectError(
  "an unknown channel is still refused",
  () =>
    create({
      subject: "x",
      body: "y",
      channel: "tiktok",
      category: "other",
      priority: "normal",
      household: null,
    }),
  /check/,
);
await expectError(
  "an unknown category is still refused",
  () =>
    create({
      subject: "x",
      body: "y",
      channel: "email",
      category: "refunds",
      priority: "normal",
      household: null,
    }),
  /check/,
);

// --- a third run with data in place changes nothing -----------------------------------
const snapshot = async () =>
  JSON.stringify({
    tickets: await q(
      `SELECT id, status, channel, category, household_unread, staff_unread, last_message_at
       FROM public.support_tickets ORDER BY id`,
    ),
    messages: await q(`SELECT id, body FROM public.support_ticket_messages ORDER BY id`),
  });
const beforeRun = await snapshot();
await db.exec(SQL_019);
cons = await checksOn();
check(
  "running 019 again keeps every ticket, message and count",
  (await snapshot()) === beforeRun && cons.channel.n === 1 && cons.category.n === 1,
);

// --- deletion clears the conversation (FR-DL-6, S-23) ----------------------------------
const REMOVED = "Removed after the account was deleted";
await svc(`SELECT public.staff_process_deletion($1, $2)`, [A1, REQ3]);
m = await msgs(T);
check(
  "deleting a co-manager clears what they wrote and nothing else",
  m.filter((x) => x.author_id === M3).every((x) => x.body === REMOVED) &&
    m.filter((x) => x.author_id !== M3).every((x) => x.body !== REMOVED) &&
    m.some((x) => x.author_id === M3),
  m,
);
await svc(`SELECT public.staff_process_deletion($1, $2)`, [A1, REQ1]);
m = await msgs(T);
t = await row(T);
check(
  "deleting the ticket's owner clears the whole conversation, keeping its status",
  m.length === 5 &&
    m.every((x) => x.body === REMOVED) &&
    t.subject === REMOVED &&
    t.status === "open",
  { m, t },
);
check(
  "another household's conversation is untouched",
  (await msgs(T2)).every((x) => x.body === "Can I pay yearly?"),
);

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
