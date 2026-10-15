// Runs 008-account-actions.sql against a real Postgres (PGlite): deletion
// blockers, the pending and history lists, and processing a deletion together
// with the CRM forgetting the person, all or nothing (FR-DL-1 to FR-DL-7,
// FR-DB-4, S-23, D36). LINARA's process_account_deletion is stubbed with its
// two refusals (stub-main-app.sql).
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
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
// 2026-10-15 12:00 in Manila.
const NOW = "2026-10-15T04:00:00Z";
const daysAgo = (d) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();

for (const file of [
  resolve(HERE, "stub-supabase.sql"),
  resolve(HERE, "stub-main-app.sql"),
  resolve(HERE, "stub-cron.sql"),
  resolve(REPO, "001-staff-foundation.sql"),
  resolve(REPO, "002-visibility.sql"),
  resolve(REPO, "003-visibility-fixes.sql"),
  resolve(REPO, "004-crm.sql"),
  resolve(REPO, "005-crm-fixes.sql"),
  resolve(REPO, "006-crm-data.sql"),
  resolve(REPO, "007-crm-export.sql"),
  resolve(REPO, "008-account-actions.sql"),
  resolve(REPO, "009-account-actions-fixes.sql"),
]) {
  await db.exec(readFileSync(file, "utf8"));
}

const ADMIN = id(900);
// HA: a helper still employed. ML: the last manager of a home with a helper.
// MO: a manager whose home has another manager (deletable). GONE: no account.
const [HA, ML, MO, CO, GONE] = [id(1), id(2), id(3), id(4), id(5)];
const [H1, H2] = [id(11), id(12)];
const [R_HA, R_ML, R_MO, R_GONE, R_DONE, R_CANCEL] = [
  id(21),
  id(22),
  id(23),
  id(24),
  id(25),
  id(26),
];
const CONTACT = id(31);
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES
    ('${ADMIN}', 'ops@example.com'), ('${HA}', 'ha@example.com'), ('${ML}', 'ml@example.com'),
    ('${MO}', 'mo@example.com'), ('${CO}', 'co@example.com');
  INSERT INTO public.staff_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.user_profiles (id, full_name, user_type) VALUES
    ('${HA}', 'Hana Helper', 'helper'), ('${ML}', 'Lito Last', 'primary_manager'),
    ('${MO}', 'Mona Other', 'primary_manager'), ('${CO}', 'Cora Co', 'co_manager');
  INSERT INTO public.households (id, name) VALUES ('${H1}', 'Last home'), ('${H2}', 'Shared home');
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES
    ('${H1}', '${ML}', 'primary_manager'),
    ('${H2}', '${MO}', 'primary_manager'), ('${H2}', '${CO}', 'co_manager');
  INSERT INTO public.helper_profiles (id, user_id, household_id, name, status) VALUES
    ('${id(41)}', '${HA}', '${H2}', 'Hana Helper', 'ACTIVE'),
    ('${id(42)}', NULL, '${H1}', 'Ben', 'ACTIVE');
  INSERT INTO public.account_deletion_requests (id, user_id, user_type, status, requested_at, processed_at) VALUES
    ('${R_HA}', '${HA}', 'helper', 'pending', '${daysAgo(20)}', NULL),
    ('${R_ML}', '${ML}', 'primary_manager', 'pending', '${daysAgo(25)}', NULL),
    ('${R_MO}', '${MO}', 'primary_manager', 'pending', '${daysAgo(35)}', NULL),
    ('${R_GONE}', '${GONE}', 'co_manager', 'pending', '${daysAgo(2)}', NULL),
    ('${R_DONE}', '${id(6)}', 'helper', 'done', '${daysAgo(60)}', '${daysAgo(40)}'),
    ('${R_CANCEL}', '${id(7)}', 'co_manager', 'cancelled', '${daysAgo(50)}', NULL);
  INSERT INTO public.crm_contacts (id, full_name, email, phone, user_id, tags, lead_stage, created_by)
    VALUES ('${CONTACT}', 'Mona O', 'mona@example.com', '09170000000', '${MO}', '{OFW}', 'new', '${ADMIN}');
  INSERT INTO public.crm_activities (contact_id, kind, body, occurred_at, author_id)
    VALUES ('${CONTACT}', 'call', 'Talked about her son in Dubai', now(), '${ADMIN}');
  INSERT INTO public.crm_follow_ups (contact_id, due_at, note, assignee_id, created_by)
    VALUES ('${CONTACT}', now(), 'Call Mona', '${ADMIN}', '${ADMIN}');
`);

// --- blockers (FR-DL-2) ---------------------------------------------------------------
const blockers = async (u) =>
  (await svc(`SELECT public.staff_deletion_blockers($1) AS b`, [u]))[0].b;
check(
  "blockers match process_account_deletion's refusals",
  (await blockers(HA)).join() === "active_employment" &&
    (await blockers(ML)).join() === "last_manager_with_helpers" &&
    (await blockers(MO)).length === 0 &&
    (await blockers(GONE)).length === 0,
);

// --- lists and counts (FR-DL-1, FR-DL-7, FR-DB-4) -------------------------------------
const pending = await svc(
  `SELECT * FROM public.staff_list_deletion_requests('pending', 50, 0, $1)`,
  [NOW],
);
check(
  "pending list is ordered by due date with days left and blockers",
  pending.map((r) => r.request_id).join() === [R_MO, R_ML, R_HA, R_GONE].join() &&
    pending[0].days_left === -5 &&
    pending[1].days_left === 5 &&
    pending[2].blockers.join() === "active_employment" &&
    pending[0].full_name === "Mona Other" &&
    pending[3].full_name === null,
  pending.map((r) => [r.request_id, r.days_left, r.blockers, r.full_name]),
);
const history = await svc(
  `SELECT * FROM public.staff_list_deletion_requests('history', 50, 0, $1)`,
  [NOW],
);
check(
  "history lists done and withdrawn",
  history.map((r) => r.request_id).join() === [R_DONE, R_CANCEL].join(),
  history.map((r) => [r.request_id, r.status]),
);
const counts = (await svc(`SELECT public.staff_deletion_counts($1) AS c`, [NOW]))[0].c;
check(
  "counts pending, due soon and overdue",
  counts.pending === 4 && counts.due_soon === 1 && counts.overdue === 1,
  counts,
);

// --- processing (FR-DL-3 to FR-DL-6, S-23, D36) ---------------------------------------
const audits = async () =>
  q(`SELECT action, target_type, target_id, metadata FROM public.staff_audit_log ORDER BY id`);
const processRequest = (requestId) =>
  svc(`SELECT public.staff_process_deletion($1, $2) AS r`, [ADMIN, requestId]);

let before = (await audits()).length;
await expectError(
  "a refusal shows the main app's message",
  () => processRequest(R_HA),
  /employment is still active/,
);
check(
  "a refusal changes nothing",
  (await q(`SELECT 1 FROM auth.users WHERE id = $1`, [HA])).length === 1 &&
    (await q(`SELECT status FROM public.account_deletion_requests WHERE id = $1`, [R_HA]))[0]
      .status === "pending" &&
    (await audits()).length === before,
);

const done = (await processRequest(R_MO))[0].r;
const after = (await audits()).slice(before);
check(
  "processing deletes the account, closes the request and records ids only",
  done.user_id === MO &&
    (await q(`SELECT 1 FROM auth.users WHERE id = $1`, [MO])).length === 0 &&
    (await q(`SELECT status FROM public.account_deletion_requests WHERE id = $1`, [R_MO]))[0]
      .status === "done" &&
    after.length === 1 &&
    after[0].action === "deletion.processed" &&
    after[0].target_type === "user" &&
    after[0].target_id === MO &&
    after[0].metadata.request_id === R_MO &&
    after[0].metadata.user_type === "primary_manager" &&
    !JSON.stringify(after).includes("Mona"),
  { done, after },
);
const contact = (await q(`SELECT * FROM public.crm_contacts WHERE id = $1`, [CONTACT]))[0];
check(
  "the CRM contact forgets the person",
  contact.anonymized_at !== null &&
    contact.full_name === null &&
    contact.email === null &&
    contact.phone === null &&
    contact.tags.length === 0 &&
    (await q(`SELECT body FROM public.crm_activities WHERE contact_id = $1`, [CONTACT]))[0].body ===
      null &&
    (await q(`SELECT note FROM public.crm_follow_ups WHERE contact_id = $1`, [CONTACT]))[0].note ===
      null &&
    (
      await svc(
        `SELECT count(*)::int AS n FROM public.crm_list_contacts(NULL, NULL, NULL, NULL, NULL, NULL, NULL, 50, 0, $1, 7, 30) WHERE user_id = $2`,
        [NOW, MO],
      )
    )[0].n === 0,
  contact,
);
await expectError(
  "only a pending request is processed",
  () => processRequest(R_MO),
  /no longer pending/,
);

const gone = (await processRequest(R_GONE))[0].r;
check(
  "a missing account still closes the request",
  gone.account_missing === true &&
    (await q(`SELECT status FROM public.account_deletion_requests WHERE id = $1`, [R_GONE]))[0]
      .status === "done",
  gone,
);

// --- a console admin's own request (D36) ----------------------------------------------
// Any signed-in account can file a request (LINARA's request_account_deletion),
// a console admin's too; processing it would cascade away their console role.
const R_ADMIN = id(27);
await q(
  `INSERT INTO public.account_deletion_requests (id, user_id, status, requested_at)
   VALUES ($1, $2, 'pending', $3)`,
  [R_ADMIN, ADMIN, daysAgo(1)],
);
check(
  "a console admin's request shows a blocker",
  (await blockers(ADMIN)).includes("console_admin"),
  await blockers(ADMIN),
);
before = (await audits()).length;
await expectError(
  "a console admin's account isn't deleted from here",
  () => processRequest(R_ADMIN),
  /Admins screen/,
);
check(
  "the admin, their role and the request are untouched",
  (await q(`SELECT 1 FROM auth.users WHERE id = $1`, [ADMIN])).length === 1 &&
    (await q(`SELECT 1 FROM public.staff_roles WHERE user_id = $1`, [ADMIN])).length === 1 &&
    (await q(`SELECT status FROM public.account_deletion_requests WHERE id = $1`, [R_ADMIN]))[0]
      .status === "pending" &&
    (await audits()).length === before,
);

// --- console admins and the suspended filter (FR-US-4) -------------------------------
check(
  "console admin check",
  (await svc(`SELECT public.staff_is_console_admin($1) AS a`, [ADMIN]))[0].a === true &&
    (await svc(`SELECT public.staff_is_console_admin($1) AS a`, [CO]))[0].a === false,
);
await q(`UPDATE auth.users SET banned_until = '2100-01-01' WHERE id = $1`, [CO]);
const find = async (suspended) =>
  (await svc(`SELECT user_id FROM public.staff_find_users(NULL, NULL, $1, 50, 0)`, [suspended]))
    .map((r) => r.user_id)
    .sort();
check(
  "the suspended filter",
  (await find(true)).join() === CO &&
    !(await find(false)).includes(CO) &&
    (await find(null)).includes(CO),
);

for (const role of ["anon", "authenticated"]) {
  for (const call of [
    `staff_deletion_blockers('${HA}')`,
    `staff_list_deletion_requests('pending', 50, 0, now())`,
    `staff_deletion_counts(now())`,
    `staff_process_deletion('${ADMIN}', '${R_ML}')`,
    `staff_is_console_admin('${ADMIN}')`,
    `staff_find_users(NULL, NULL, NULL, 50, 0)`,
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
