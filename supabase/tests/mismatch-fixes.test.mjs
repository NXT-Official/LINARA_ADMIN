// Runs 017-app-mismatch-fixes.sql against a real Postgres (PGlite): each
// console figure follows the app's rule (handbook 20.1, items 2 to 6 and 8).
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
const svc = async (sql, params) => {
  await db.exec("SET ROLE service_role");
  try {
    return await q(sql, params);
  } finally {
    await db.exec("RESET ROLE");
  }
};
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
  "012-operations.sql",
  "017-app-mismatch-fixes.sql",
]) {
  await db.exec(readFileSync(resolve(REPO, file), "utf8"));
}

const NOW = "2026-10-16T12:00:00Z";
const [H1, H2, H3] = [id(11), id(12), id(13)];
const [MULTI, SOLO, WORKER, STAFF] = [id(21), id(22), id(23), id(24)];
const [HP_ACTIVE, HP_ENDED] = [id(31), id(32)];

await db.exec(`
  INSERT INTO auth.users (id, email) VALUES
    ('${MULTI}', 'multi@example.com'), ('${SOLO}', 'solo@example.com'),
    ('${WORKER}', 'worker@example.com'), ('${STAFF}', 'staff@example.com');
  INSERT INTO public.households (id, name) VALUES
    ('${H1}', 'Home One'), ('${H2}', 'Home Two'), ('${H3}', 'Home Three');
  INSERT INTO public.user_profiles (id, full_name, user_type, household_id) VALUES
    ('${MULTI}', 'Multi', 'primary_manager', '${H1}'),
    ('${SOLO}', 'Solo', 'primary_manager', '${H3}'),
    ('${WORKER}', 'Worker', 'helper', NULL),
    ('${STAFF}', 'Staff', 'primary_manager', NULL);
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES
    ('${H1}', '${MULTI}', 'primary_manager'), ('${H2}', '${MULTI}', 'co_manager');
  INSERT INTO public.helper_profiles (id, user_id, household_id, name, status) VALUES
    ('${HP_ACTIVE}', '${WORKER}', '${H1}', 'Worker', 'ACTIVE'),
    ('${HP_ENDED}', '${WORKER}', '${H2}', 'Worker', 'INACTIVE');
`);

// --- #3 the role filter reads every household they manage ------------------------------
const co = await svc("SELECT user_id FROM public.staff_list_users(NULL, 'co_manager', 10, 0)");
check(
  "#3 co_manager finds a co-manager of a second home",
  co.some((r) => r.user_id === MULTI),
  co,
);
const pm = await svc("SELECT user_id FROM public.staff_list_users(NULL, 'primary_manager', 10, 0)");
check(
  "#3 primary_manager still finds them",
  pm.some((r) => r.user_id === MULTI),
  pm,
);

// --- #5 an ended job isn't a household for "and N more" --------------------------------
const homes = await svc(
  "SELECT user_id, household_count FROM public.staff_list_users(NULL, 'helper', 10, 0)",
);
check(
  "#5 an ended job doesn't count",
  homes.find((r) => r.user_id === WORKER)?.household_count === 1,
  homes,
);

// --- #8 the open household counts as a last-manager home -------------------------------
await db.exec(`INSERT INTO public.helper_profiles (id, user_id, household_id, name, status)
               VALUES ('${id(33)}', NULL, '${H3}', 'Nanny', 'ACTIVE')`);
const blocked = await svc("SELECT public.staff_deletion_blockers($1) AS b", [SOLO]);
check(
  "#8 user_profiles.household_id still blocks the last manager",
  blocked[0].b.includes("last_manager_with_helpers"),
  blocked,
);
const free = await svc("SELECT public.staff_deletion_blockers($1) AS b", [STAFF]);
check("#8 a manager with no household has no blocker", free[0].b.length === 0, free);

// --- #4 copies count; a household with only copies isn't "No tasks yet" ----------------
await db.exec(`INSERT INTO public.tickets (household_id, status, scheduled_start, routine_id)
               VALUES ('${H2}', 'todo', '2026-10-15T01:00:00Z', '${id(900)}')`);
const act = await svc("SELECT * FROM public.staff_household_activity($1, $2)", [H2, NOW]);
check("#4 a repeating copy counts as scheduled", act[0].tasks_scheduled_7d === 1, act);
check("#4 last activity falls back to the copy", act[0].last_activity_at !== null, act);
const list = await svc(
  "SELECT household_id, last_activity_at, tasks_scheduled_7d FROM public.staff_list_households(NULL, 10, 0, $1)",
  [NOW],
);
const h2 = list.find((r) => r.household_id === H2);
check("#4 the list agrees", h2?.tasks_scheduled_7d === 1 && h2?.last_activity_at !== null, list);
const dash = await svc("SELECT public.staff_dashboard($1) AS d", [NOW]);
check(
  "#4 copies still don't make a household active (FR-DB-3)",
  dash[0].d.households_active_7d === 0,
  dash[0].d.households_active_7d,
);

// --- #6 the done chart follows the scheduled day ---------------------------------------
await db.exec(`INSERT INTO public.tickets (household_id, status, scheduled_start, actual_end)
               VALUES ('${H1}', 'done', '2026-10-14T02:00:00Z', '2026-10-15T02:00:00Z')`);
const daily = (await svc("SELECT public.staff_dashboard($1) AS d", [NOW]))[0].d.tasks_done_daily;
const on = (day) => daily.find((r) => String(r.day).startsWith(day))?.count;
check("#6 counted on the scheduled day", on("2026-10-14") === 1, daily);
check("#6 not on the finished day", on("2026-10-15") === 0, daily);

// --- #2 a disputed direct payment is a payout problem ----------------------------------
const [PS_DIS, PS_OK, PS_OLD] = [id(101), id(102), id(103)];
await db.exec(`
  INSERT INTO public.payslips (id, helper_id, cutoff_start, cutoff_end, net_pay, payout_provider,
                               payout_channel_code, helper_ack, helper_ack_at, helper_ack_note) VALUES
    ('${PS_DIS}', '${HP_ACTIVE}', '2026-10-01', '2026-10-15', 4321.50, 'manual', 'PH_GCASH',
     'disputed', '2026-10-16T01:00:00Z', 'Nothing arrived'),
    ('${PS_OK}', '${HP_ACTIVE}', '2026-09-16', '2026-09-30', 100, 'manual', 'PH_GCASH',
     'confirmed', '2026-10-01T01:00:00Z', NULL),
    ('${PS_OLD}', '${HP_ACTIVE}', '2026-08-16', '2026-08-31', 100, 'xendit', 'PH_GCASH',
     'disputed', NULL, NULL);
`);
const problems = await svc("SELECT * FROM public.staff_list_payout_problems($1, NULL, 20, 0)", [
  NOW,
]);
const dis = problems.filter((r) => r.kind === "disputed");
check(
  "#2 exactly the disputed direct payment is listed",
  dis.length === 1 && dis[0].attempt_id === PS_DIS,
  problems,
);
check(
  "#2 it carries its reason, channel and helper",
  dis[0]?.failure_reason === "Nothing arrived" &&
    dis[0]?.channel_code === "PH_GCASH" &&
    dis[0]?.helper_id === HP_ACTIVE,
  dis,
);
check("#2 it never carries an amount", !JSON.stringify(problems).includes("4321"), problems);
const only = await svc("SELECT * FROM public.staff_list_payout_problems($1, 'disputed', 20, 0)", [
  NOW,
]);
check("#2 the kind filter works", only.length === 1, only);
const counts = await svc("SELECT public.staff_payout_counts($1) AS c", [NOW]);
check("#2 the count includes it", counts[0].c.disputed === 1, counts);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
