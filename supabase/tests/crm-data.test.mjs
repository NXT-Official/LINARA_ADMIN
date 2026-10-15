// Runs 006-crm-data.sql against a real Postgres (PGlite): duplicates, the
// all-or-nothing import with its consent basis and audit entry, and the
// nightly lead retention on pg_cron (FR-CRM-10, FR-CRM-15, S-24, S-25, D34, D35).
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
const ADMIN = id(900);
const SYSTEM = id(0);
const NOW = "2026-10-15T04:00:00Z";
const monthsAgo = (m) => new Date(Date.parse(NOW) - m * 30.5 * 86_400_000).toISOString();

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
]) {
  await db.exec(readFileSync(file, "utf8"));
}

const audits = async () =>
  q(`SELECT actor_user_id, action, target_type, metadata FROM public.staff_audit_log ORDER BY id`);

// --- duplicates (FR-CRM-10) ---------------------------------------------------------
const [OLD, RECENT, TOUCHED, CUSTOMER, GONE] = [id(41), id(42), id(43), id(44), id(45)];
const M = id(1);
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${M}', 'm@example.com');
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES ('${id(11)}', '${M}', 'primary_manager');
  INSERT INTO public.crm_contacts
    (id, full_name, email, phone, source, lead_stage, lost_reason, consent_basis, user_id, tags,
     created_by, created_at, updated_at, anonymized_at) VALUES
    ('${OLD}', 'Olga Old', 'olga@example.com', '09171234567', 'event', 'lost', 'No budget',
     'Met at the 2025 expo', NULL, '{Cebu}', '${ADMIN}', '${monthsAgo(20)}', '${monthsAgo(13)}', NULL),
    ('${RECENT}', 'Rita Recent', 'rita@example.com', NULL, NULL, 'new', NULL, NULL, NULL, '{}',
     '${ADMIN}', '${monthsAgo(20)}', '${monthsAgo(1)}', NULL),
    ('${TOUCHED}', 'Tess Touched', 'tess@example.com', NULL, NULL, 'contacted', NULL, NULL, NULL, '{}',
     '${ADMIN}', '${monthsAgo(20)}', '${monthsAgo(13)}', NULL),
    ('${CUSTOMER}', NULL, NULL, NULL, NULL, 'new', NULL, NULL, '${M}', '{VIP}',
     '${ADMIN}', '${monthsAgo(20)}', '${monthsAgo(13)}', NULL),
    ('${GONE}', NULL, 'gone@example.com', NULL, NULL, 'new', NULL, NULL, NULL, '{}',
     '${ADMIN}', '${monthsAgo(20)}', '${monthsAgo(13)}', '${monthsAgo(1)}');
  INSERT INTO public.crm_activities (contact_id, kind, body, occurred_at, author_id) VALUES
    ('${OLD}', 'call', 'Talked about her mother in Cebu', '${monthsAgo(14)}', '${ADMIN}'),
    ('${TOUCHED}', 'call', 'Still thinking', '${monthsAgo(2)}', '${ADMIN}');
  INSERT INTO public.crm_follow_ups (contact_id, due_at, note, assignee_id, created_by, created_at) VALUES
    ('${OLD}', '${monthsAgo(13)}', 'Call Olga back', '${ADMIN}', '${ADMIN}', '${monthsAgo(14)}');
`);

const dupes = await svc(`SELECT * FROM public.crm_find_duplicates($1, $2)`, [
  ["OLGA@Example.com", "nobody@example.com", "gone@example.com"],
  ["09171234567"],
]);
check(
  "duplicates match email ignoring case and phone, skipping anonymised contacts",
  dupes.length === 1 && dupes[0].contact_id === OLD,
  dupes,
);

// --- import (FR-CRM-10, S-24, D34) ---------------------------------------------------
const rows = [
  {
    full_name: "Nina Ramos",
    email: "nina@example.com",
    phone: null,
    source: "facebook",
    tags: ["OFW"],
    note: "Asked about live-in",
  },
  {
    full_name: "Paolo Cruz",
    email: null,
    phone: "09180001111",
    source: null,
    tags: [],
    note: null,
  },
];
let before = (await audits()).length;
const imported = await svc(`SELECT public.crm_import_leads($1, $2, $3) AS n`, [
  ADMIN,
  JSON.stringify(rows),
  "Signed up for updates at the Makati home expo",
]);
const added = await q(
  `SELECT full_name, consent_basis, lead_stage, user_id FROM public.crm_contacts
   WHERE full_name IN ('Nina Ramos', 'Paolo Cruz') ORDER BY full_name`,
);
const importAudit = (await audits()).slice(before);
check(
  "import adds every row with the consent basis and one audit row",
  imported[0].n === 2 &&
    added.length === 2 &&
    added.every((r) => r.consent_basis === "Signed up for updates at the Makati home expo") &&
    added.every((r) => r.lead_stage === "new" && r.user_id === null) &&
    importAudit.length === 1 &&
    importAudit[0].action === "crm.imported" &&
    importAudit[0].target_type === "import" &&
    importAudit[0].metadata.rows === 2,
  { imported, added, importAudit },
);
check(
  "an imported note becomes the lead's first activity",
  (
    await q(
      `SELECT a.kind FROM public.crm_activities a JOIN public.crm_contacts c ON c.id = a.contact_id
       WHERE c.full_name = 'Nina Ramos'`,
    )
  )
    .map((r) => r.kind)
    .join() === "note",
);

const count = async () => (await q(`SELECT count(*)::int AS n FROM public.crm_contacts`))[0].n;
before = await count();
const auditBefore = (await audits()).length;
await expectError(
  "a bad row imports nothing",
  () =>
    svc(`SELECT public.crm_import_leads($1, $2, $3)`, [
      ADMIN,
      JSON.stringify([rows[0], { ...rows[1], full_name: "Bad Source", source: "tiktok" }]),
      "Signed up at the expo",
    ]),
  /check/,
);
check(
  "nothing was added or recorded",
  (await count()) === before && (await audits()).length === auditBefore,
);
await expectError(
  "import refuses 501 rows",
  () =>
    svc(`SELECT public.crm_import_leads($1, $2, $3)`, [
      ADMIN,
      JSON.stringify(
        Array.from({ length: 501 }, (_, i) => ({
          ...rows[1],
          phone: null,
          email: `x${i}@example.com`,
        })),
      ),
      "Signed up at the expo",
    ]),
  /500/,
);
await expectError(
  "import needs a consent basis",
  () => svc(`SELECT public.crm_import_leads($1, $2, $3)`, [ADMIN, JSON.stringify(rows), "ok"]),
  /agreed to be contacted/,
);

// --- retention (FR-CRM-15, S-25, D35) -------------------------------------------------
before = (await audits()).length;
const ran = await svc(`SELECT public.crm_run_retention($1) AS n`, [NOW]);
const olga = (await q(`SELECT * FROM public.crm_contacts WHERE id = $1`, [OLD]))[0];
check(
  "retention anonymises a lead untouched for 13 months and keeps its stage and dates",
  ran[0].n === 1 &&
    olga.anonymized_at !== null &&
    olga.full_name === null &&
    olga.email === null &&
    olga.phone === null &&
    olga.tags.length === 0 &&
    olga.lost_reason === null &&
    olga.consent_basis === null &&
    olga.lead_stage === "lost" &&
    olga.source === "event" &&
    olga.created_at !== null,
  olga,
);
check(
  "retention clears activity and follow-up text",
  (await q(`SELECT body FROM public.crm_activities WHERE contact_id = $1`, [OLD]))[0].body ===
    null &&
    (await q(`SELECT note FROM public.crm_follow_ups WHERE contact_id = $1`, [OLD]))[0].note ===
      null,
);
const untouched = await q(
  `SELECT id FROM public.crm_contacts WHERE id = ANY ($1) AND anonymized_at IS NULL ORDER BY id`,
  [[RECENT, TOUCHED, CUSTOMER]],
);
check(
  "retention leaves customers, recent leads and leads with a recent activity",
  untouched.length === 3,
  untouched,
);
const runAudit = (await audits()).slice(before);
check(
  "each run records itself as the automatic job",
  runAudit.length === 1 &&
    runAudit[0].action === "crm.retention_ran" &&
    runAudit[0].actor_user_id === SYSTEM &&
    runAudit[0].metadata.anonymised === 1,
  runAudit,
);
const again = await svc(`SELECT public.crm_run_retention($1) AS n`, [NOW]);
check(
  "retention is idempotent",
  again[0].n === 0 && (await audits()).at(-1).metadata.anonymised === 0,
);

const jobs = await q(`SELECT jobname, schedule, command FROM cron.job`);
check(
  "the job is scheduled once at 15 18 * * *",
  jobs.length === 1 &&
    jobs[0].jobname === "crm-retention" &&
    jobs[0].schedule === "15 18 * * *" &&
    /crm_run_retention/.test(jobs[0].command),
  jobs,
);

// --- export with contact details (FR-CRM-11) -------------------------------------------
// One JSON value: the API caps table results (Max rows), so the file and the
// count come back together and can be checked against each other.
const exp = async (max) =>
  (
    await svc(
      `SELECT public.crm_export_contacts(NULL, 'lead', NULL, NULL, NULL, NULL, NULL, $1, $2, 7, 30) AS d`,
      [max, NOW],
    )
  )[0].d;
const leads = (
  await q(
    `SELECT count(*)::int AS n FROM public.crm_contacts WHERE user_id IS NULL AND anonymized_at IS NULL`,
  )
)[0].n;
const full = await exp(5000);
check(
  "export returns every matching contact with the total",
  full.total === leads && full.rows.length === leads && full.rows[0].full_name !== undefined,
  { leads, total: full.total, rows: full.rows.length },
);
const capped = await exp(1);
check(
  "export keeps the true total when the rows are capped",
  capped.total === leads && capped.rows.length === 1,
  capped,
);

for (const role of ["anon", "authenticated"]) {
  for (const call of [
    `crm_export_contacts(NULL, NULL, NULL, NULL, NULL, NULL, NULL, 10, now(), 7, 30)`,
    `crm_find_duplicates('{}', '{}')`,
    `crm_import_leads('${ADMIN}', '[]', 'Signed up at the expo')`,
    `crm_run_retention(now())`,
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
