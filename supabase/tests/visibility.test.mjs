// Runs 002-visibility.sql against a real Postgres (PGlite): the Phase 2 read
// functions are closed to the app roles, count what the spec says (FR-DB-1 to
// FR-DB-3, D32), search safely (S-20) and never return pay (S-17, D33).
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

// 2026-10-15 12:00 in Manila.
const NOW = "2026-10-15T04:00:00Z";
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [M1, M2, HU, HE] = [id(1), id(2), id(3), id(4)]; // accounts
const [H1, H2, H3, H4, H5] = [id(11), id(12), id(13), id(14), id(15)]; // households
const [HP1, HP2, HP3] = [id(21), id(22), id(23)]; // helper profiles
const WAGE = "18000";
const ACCOUNT = "09998887777";

await db.exec(readFileSync(resolve(HERE, "stub-supabase.sql"), "utf8"));
await db.exec(readFileSync(resolve(HERE, "stub-main-app.sql"), "utf8"));
await db.exec(readFileSync(resolve(REPO, "001-staff-foundation.sql"), "utf8"));
await db.exec(readFileSync(resolve(REPO, "002-visibility.sql"), "utf8"));
await db.exec(readFileSync(resolve(REPO, "003-visibility-fixes.sql"), "utf8"));
await db.exec(`
  INSERT INTO auth.users (id, email, last_sign_in_at, banned_until, created_at) VALUES
    ('${M1}', 'ana@example.com', '2026-10-14T00:00:00Z', NULL, '2026-10-01T00:00:00Z'),
    ('${M2}', 'ben@example.com', NULL, '2100-01-01T00:00:00Z', '2026-10-02T00:00:00Z'),
    ('${HU}', 'carla@example.com', NULL, NULL, '2026-10-03T00:00:00Z'),
    ('${HE}', 'eli@example.com', NULL, '2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z');
  INSERT INTO public.user_profiles (id, household_id, full_name, user_type, created_at) VALUES
    ('${M1}', '${H1}', 'Ana Reyes', 'primary_manager', '2026-10-01T00:00:00Z'),
    ('${M2}', '${H2}', 'Ben 100% Cruz', 'primary_manager', '2026-10-02T00:00:00Z'),
    ('${HU}', '${H1}', 'Carla_Dizon', 'helper', '2026-10-03T00:00:00Z'),
    ('${HE}', '${H2}', 'Eli Santos', 'helper', '2026-10-04T00:00:00Z');
  INSERT INTO public.households (id, name, created_at, timezone) VALUES
    ('${H1}', 'Reyes home', '2026-10-12T01:00:00Z', 'Asia/Manila'),
    ('${H2}', 'Cruz home', '2026-09-20T01:00:00Z', 'Asia/Manila'),
    ('${H3}', 'Quiet home', '2026-08-01T01:00:00Z', NULL),
    ('${H4}', 'Planned home', '2026-01-01T01:00:00Z', NULL),
    ('${H5}', 'Left home', '2025-12-01T01:00:00Z', NULL);
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES
    ('${H1}', '${M1}', 'primary_manager'),
    ('${H2}', '${M2}', 'primary_manager'),
    ('${H2}', '${M1}', 'co_manager');
  INSERT INTO public.helper_profiles
    (id, user_id, household_id, name, station, monthly_rate, status, employment, phone, started_on, ended_on) VALUES
    ('${HP1}', '${HU}', '${H1}', 'Carla_Dizon', 'Kitchen', ${WAGE}, 'ACTIVE', 'live-in', '09171234567', '2026-09-01', NULL),
    ('${HP2}', NULL, '${H1}', 'Dina', 'Laundry', 15000, 'PENDING_CLAIM', 'live-out', NULL, NULL, NULL),
    ('${HP3}', '${HE}', '${H2}', 'Eli Santos', 'Garden', 14000, 'INACTIVE', 'live-out', NULL, '2026-06-01', '2026-09-30');
  INSERT INTO public.helper_households (helper_id, household_id) VALUES ('${HP1}', '${H2}');
  INSERT INTO public.helper_payout_accounts (user_id, method, account_name, account_number) VALUES
    ('${HU}', 'PH_GCASH', 'Carla D', '${ACCOUNT}');
  INSERT INTO public.account_deletion_requests (user_id, status, requested_at) VALUES
    ('${HE}', 'pending', '2026-10-10T00:00:00Z'),
    ('${M1}', 'cancelled', '2026-10-09T00:00:00Z');
  INSERT INTO public.push_tokens (token, user_id) VALUES ('t1', '${M1}'), ('t2', '${M1}');
  INSERT INTO public.tickets (household_id, status, scheduled_start, actual_end) VALUES
    ('${H1}', 'done', '2026-10-14T00:00:00Z', '2026-10-14T02:00:00Z'),
    ('${H2}', 'todo', '2026-10-10T00:00:00Z', NULL),
    ('${H4}', 'cancelled', '2026-10-13T00:00:00Z', NULL),
    ('${H4}', 'todo', '2026-10-20T00:00:00Z', NULL);
  -- H5 set up a daily chore months ago and left: only the spawn job's copies are recent.
  INSERT INTO public.tickets (id, household_id, status, scheduled_start, routine_id) VALUES
    ('${id(31)}', '${H5}', 'todo', '2026-06-01T00:00:00Z', '${id(31)}'),
    ('${id(32)}', '${H5}', 'todo', '2026-10-14T00:00:00Z', '${id(31)}');
  -- H2's own repeating series, started by a person 3 days ago, counts.
  INSERT INTO public.tickets (id, household_id, status, scheduled_start, routine_id) VALUES
    ('${id(33)}', '${H2}', 'todo', '2026-10-12T00:00:00Z', '${id(33)}');
`);

// --- privileges (D33, S-27) -------------------------------------------------------
const CALLS = [
  `staff_dashboard('${NOW}')`,
  `staff_list_users(NULL, NULL, 50, 0)`,
  `staff_get_user('${M1}')`,
  `staff_list_households(NULL, 50, 0, '${NOW}')`,
  `staff_get_household('${H1}', '${NOW}')`,
];
for (const role of ["anon", "authenticated"]) {
  for (const call of CALLS) {
    await expectError(
      `${role} can't run ${call.split("(")[0]}`,
      () => as(role, () => q(`SELECT * FROM public.${call}`)),
      /permission denied/,
    );
  }
}
for (const call of CALLS) {
  const rows = await svc(`SELECT * FROM public.${call}`);
  check(`service_role can run ${call.split("(")[0]}`, rows.length >= 1, rows);
}

// --- dashboard (FR-DB-1 to FR-DB-3, D32) -------------------------------------------
const dash = (await svc(`SELECT public.staff_dashboard($1) AS d`, [NOW]))[0].d;
const counts = {
  households: 5,
  households_new_7d: 1,
  households_new_30d: 2,
  households_active_7d: 2,
  managers: 2,
  managers_multi_home: 1,
  helpers_active: 1,
  helpers_invited: 1,
  helpers_ended: 1,
};
check(
  "dashboard counts",
  Object.entries(counts).every(([k, v]) => dash[k] === v),
  Object.fromEntries(Object.keys(counts).map((k) => [k, dash[k]])),
);
const weeks = dash.new_households_weekly;
const days = dash.tasks_done_daily;
check(
  "eight Manila weeks, oldest first, zero-filled",
  weeks.length === 8 &&
    weeks[7].week_start === "2026-10-12" &&
    weeks[7].count === 1 &&
    weeks.find((w) => w.week_start === "2026-09-14")?.count === 1 &&
    weeks.reduce((a, w) => a + w.count, 0) === 2,
  weeks,
);
check(
  "fourteen Manila days of tasks done",
  days.length === 14 &&
    days[13].day === "2026-10-15" &&
    days.find((d) => d.day === "2026-10-14")?.count === 1 &&
    days.reduce((a, d) => a + d.count, 0) === 1,
  days,
);

// --- households (FR-HH-1, FR-HH-2, D32) ------------------------------------------
const households = await svc(`SELECT * FROM public.staff_list_households(NULL, 50, 0, $1)`, [NOW]);
const hh = Object.fromEntries(households.map((h) => [h.household_id, h]));
check(
  "households newest first",
  households.map((h) => h.household_id).join() === [H1, H2, H3, H4, H5].join(),
  households.map((h) => h.name),
);
check(
  "active uses scheduled or done tasks, not cancelled",
  hh[H1].tasks_done_7d === 1 &&
    hh[H2].tasks_scheduled_7d === 2 &&
    hh[H4].tasks_scheduled_7d === 0 &&
    hh[H4].last_activity_at === null,
  hh[H4],
);
check(
  "household without tasks",
  hh[H3].last_activity_at === null && hh[H3].tasks_done_7d === 0 && hh[H3].managers === 0,
  hh[H3],
);
check(
  "primary manager, managers and active helpers, shared helpers included",
  hh[H2].primary_manager_id === M2 &&
    hh[H2].primary_manager_name === "Ben 100% Cruz" &&
    hh[H2].managers === 2 &&
    hh[H2].helpers_active === 1 &&
    hh[H1].helpers_active === 1,
  hh[H2],
);
check(
  "household search by name",
  (await svc(`SELECT name FROM public.staff_list_households('quiet', 50, 0, $1)`, [NOW])).length ===
    1,
);

const h1 = (await svc(`SELECT public.staff_get_household($1, $2) AS d`, [H1, NOW]))[0].d;
const pending = h1.helpers.find((x) => x.helper_id === HP2);
check(
  "pending helper has no user",
  pending?.user_id === null && pending.status === "PENDING_CLAIM",
  h1.helpers,
);
const h2 = (await svc(`SELECT public.staff_get_household($1, $2) AS d`, [H2, NOW]))[0].d;
check(
  "household detail lists managers and shared helpers",
  h2.managers.length === 2 &&
    h2.helpers.length === 2 &&
    h2.helpers.find((x) => x.helper_id === HP1)?.shared === true &&
    h2.helpers.find((x) => x.helper_id === HP3)?.shared === false &&
    h2.tasks_scheduled_7d === 2,
  h2,
);

check(
  "spawned routine copies aren't activity (D32)",
  hh[H5].tasks_scheduled_7d === 0 &&
    hh[H5].last_activity_at?.toISOString?.() === "2026-06-01T00:00:00.000Z",
  hh[H5],
);
const h5 = (await svc(`SELECT public.staff_get_household($1, $2) AS d`, [H5, NOW]))[0].d;
check("spawned copies aren't activity on the detail page either", h5.tasks_scheduled_7d === 0, h5);

// --- users (FR-US-1 to FR-US-3, S-20) ----------------------------------------------
const users = await svc(`SELECT * FROM public.staff_list_users(NULL, NULL, 50, 0)`);
const us = Object.fromEntries(users.map((u) => [u.user_id, u]));
check(
  "one row per account with a profile, newest first",
  users.map((u) => u.user_id).join() === [HE, HU, M2, M1].join(),
  users.map((u) => u.full_name),
);
check(
  "user row facts",
  us[M1].email === "ana@example.com" &&
    us[M1].household_count === 2 &&
    us[M1].household_name === "Reyes home" &&
    us[M1].devices === 2 &&
    us[M1].suspended === false &&
    us[M2].suspended === true &&
    us[HE].suspended === false &&
    us[HU].household_count === 2,
  users,
);
const search = async (term, kind = null) =>
  (await svc(`SELECT user_id FROM public.staff_list_users($1, $2, 50, 0)`, [term, kind])).map(
    (r) => r.user_id,
  );
check("search escapes LIKE wildcards", (await search("%")).join() === M2, await search("%"));
check("underscore is literal too", (await search("_")).join() === HU, await search("_"));
check("search by email", (await search("ana@")).join() === M1);
check("search finds a helper by phone digits", (await search("0917 123")).join() === HU);
check("kind filter", (await search(null, "helper")).sort().join() === [HU, HE].sort().join());
check(
  "limit and offset page the list",
  (await svc(`SELECT user_id FROM public.staff_list_users(NULL, NULL, 2, 2)`))
    .map((r) => r.user_id)
    .join() === [M2, M1].join(),
);

const carla = (await svc(`SELECT public.staff_get_user($1) AS d`, [HU]))[0].d;
check(
  "helper detail: job with shared household",
  carla.jobs.length === 1 &&
    carla.jobs[0].helper_id === HP1 &&
    carla.jobs[0].also_works_in.length === 1 &&
    carla.jobs[0].also_works_in[0].household_id === H2 &&
    carla.memberships.length === 0 &&
    carla.deletion === null,
  carla,
);
const ana = (await svc(`SELECT public.staff_get_user($1) AS d`, [M1]))[0].d;
check(
  "manager detail: every membership, cancelled deletion ignored",
  ana.memberships.length === 2 && ana.deletion === null && ana.devices === 2,
  ana,
);
const eli = (await svc(`SELECT public.staff_get_user($1) AS d`, [HE]))[0].d;
check("pending deletion shows", eli.deletion?.requested_at?.startsWith("2026-10-10"), eli);

// --- nothing returns pay (S-17, D33) -------------------------------------------------
const everything = JSON.stringify([dash, households, h1, h2, users, carla, ana, eli]);
check(
  "no pay anywhere",
  !["monthly_rate", "account_number", "account_name", WAGE, ACCOUNT].some((s) =>
    everything.includes(s),
  ),
);
check(
  "missing ids return null",
  (await svc(`SELECT public.staff_get_user($1) AS d`, [id(99)]))[0].d === null &&
    (await svc(`SELECT public.staff_get_household($1, $2) AS d`, [id(99), NOW]))[0].d === null,
);

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
