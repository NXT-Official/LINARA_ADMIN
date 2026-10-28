// Runs 019-revenue.sql against a real Postgres (PGlite) as an attacker would:
// only the server key reads or writes, the sums are exact (cash, fees by
// channel, AI calls, fixed costs spread over their days, profit, MRR and its
// movements), and the audit holds ids only.
//
//   node supabase/tests/revenue.test.mjs
//
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const MAIN = resolve(REPO, "../../LINARA/supabase");
const db = new PGlite();
let failures = 0;

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
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
const svc = (sql, params) => as("service_role", () => one(sql, params));
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

for (const file of ["tests/stub-supabase.sql", "tests/stub-main-app.sql", "tests/stub-cron.sql"]) {
  await db.exec(readFileSync(resolve(REPO, file), "utf8"));
}
await db.exec(`
  ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS household_id UUID,
    ADD COLUMN IF NOT EXISTS full_name TEXT;
  CREATE TABLE public.manager_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), household_id UUID NOT NULL, code TEXT,
    role TEXT NOT NULL, created_by UUID, expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
    claimed_by UUID, claimed_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ);
  CREATE TABLE public.app_switches (key TEXT PRIMARY KEY, enabled BOOLEAN NOT NULL, note TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
  INSERT INTO public.app_switches (key, enabled) VALUES ('staff_pay_hr', false);
  CREATE FUNCTION public.pay_hr_enabled() RETURNS BOOLEAN LANGUAGE sql STABLE AS
    $$ SELECT coalesce((SELECT enabled FROM public.app_switches WHERE key = 'staff_pay_hr'), false) $$;
  CREATE FUNCTION public.current_household_id() RETURNS UUID LANGUAGE sql STABLE AS
    $$ SELECT household_id FROM public.user_profiles WHERE id = auth.uid() $$;
`);
await db.exec(readFileSync(resolve(MAIN, "add-billing.sql"), "utf8"));
for (const file of [
  "add-billing-idempotency.sql",
  "add-billing-plan-changes.sql",
  "add-billing-history.sql",
]) {
  await db.exec(readFileSync(resolve(MAIN, file), "utf8"));
}
for (const file of [
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
  "013-roles.sql",
  "014-roles-fixes.sql",
  "015-super-admin.sql",
  "016-super-admin-gives-admin.sql",
  "017-app-mismatch-fixes.sql",
  "018-billing.sql",
  "019-revenue.sql",
]) {
  await db.exec(readFileSync(resolve(REPO, file), "utf8"));
}
console.log("migrations applied");

const ADMIN = id(901);
const M = id(1); // pays Normal monthly
const X = id(2); // Premium, cancelled, ended an hour ago
const F = id(3); // on Free
const H = id(101);
const H2 = id(102);
const H3 = id(103);
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${ADMIN}', 'admin@example.com'), ('${M}', 'm@example.com'),
    ('${X}', 'x@example.com'), ('${F}', 'f@example.com');
  INSERT INTO public.households (id, name) VALUES ('${H}', 'Reyes'), ('${H2}', 'Cruz'), ('${H3}', 'Lim');
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES
    ('${H}', '${M}', 'primary_manager'), ('${H2}', '${X}', 'primary_manager'), ('${H3}', '${F}', 'primary_manager');
`);

// This month in Manila, so the report's range is the month the rows land in.
const today = (await one(`SELECT (now() AT TIME ZONE 'Asia/Manila')::date AS d`)).d;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const first = (await one(`SELECT date_trunc('month', $1::date)::date AS d`, [ymd(today)])).d;
const lastDay = (
  await one(`SELECT (date_trunc('month', $1::date) + interval '1 month - 1 day')::date AS d`, [
    ymd(today),
  ])
).d;
const daysInMonth = Number(ymd(lastDay).slice(8, 10));
const FROM = ymd(first);
const TO = ymd(lastDay);
const report = async (from = FROM, to = TO) =>
  (await svc(`SELECT staff_revenue_report($1, $2) AS r`, [from, to])).r;

// --- Permissions -------------------------------------------------------------------------
const TS = readFileSync(resolve(REPO, "../src/features/auth/permissions.ts"), "utf8");
const tsList = [
  ...TS.slice(TS.indexOf("PERMISSIONS = ["), TS.indexOf("] as const")).matchAll(/"([a-z.]+)"/g),
].map((m) => m[1]);
const known = (await one(`SELECT public.staff_known_permissions() AS p`)).p;
check(
  "the permission list matches permissions.ts, with revenue.view and revenue.manage",
  [...tsList].sort().join() === [...known].sort().join() &&
    known.includes("revenue.view") &&
    known.includes("revenue.manage"),
  { tsList, known },
);
const presets = await q(`SELECT preset, permissions FROM staff_role_defs WHERE preset IS NOT NULL`);
const has = (preset, p) => presets.find((r) => r.preset === preset)?.permissions.includes(p);
check(
  "Super admin and Admin see and manage revenue",
  ["super_admin", "admin"].every((p) => has(p, "revenue.view") && has(p, "revenue.manage")),
);
check(
  "Mods, Sales and Support don't",
  ["mods", "sales", "support"].every((p) => !has(p, "revenue.view") && !has(p, "revenue.manage")),
);

// --- Only the server key -------------------------------------------------------------------
for (const role of ["authenticated", "anon"]) {
  await expectError(
    `${role} can't read the report`,
    () => as(role, () => q(`SELECT staff_revenue_report($1, $2)`, [FROM, TO])),
    /permission denied/,
  );
  await expectError(
    `${role} can't set a fee rate`,
    () => as(role, () => q(`SELECT staff_revenue_set_fee_rate($1, 'GCASH', 0, 0)`, [ADMIN])),
    /permission denied/,
  );
  await expectError(
    `${role} can't read the costs table`,
    () => as(role, () => q(`SELECT * FROM staff_revenue_costs`)),
    /permission denied/,
  );
}

// --- Data: M pays Normal monthly; X's Premium was cancelled and ended an hour ago ------------
await db.exec(`
  INSERT INTO billing_subscriptions (manager_id, plan_version_id, cycle, status,
                                     current_period_start, current_period_end)
  VALUES ('${M}', billing_current_version('normal'), 'monthly', 'active', now(), now() + interval '1 month'),
         ('${X}', billing_current_version('premium'), 'monthly', 'active',
          now() - interval '1 month', now() - interval '1 hour');
  UPDATE billing_subscriptions SET cancel_at_period_end = true WHERE manager_id = '${X}';
  INSERT INTO billing_payments (manager_id, kind, plan_version_id, cycle, amount, status, paid_at, payment_channel)
  VALUES ('${M}', 'plan', billing_current_version('normal'), 'monthly', 19900, 'paid', now() - interval '1 hour', 'GCASH'),
         ('${M}', 'addons', billing_current_version('normal'), 'monthly', 10000, 'paid', now() - interval '1 hour', 'CREDIT_CARD'),
         ('${X}', 'plan', billing_current_version('premium'), 'monthly', 39900, 'review', now() - interval '1 hour', 'GCASH');
  INSERT INTO ai_calls (user_id, fn, at)
  SELECT '${M}', 'generate-sop', now() - interval '1 hour' FROM generate_series(1, 10);
`);

// --- Staff-entered costs ------------------------------------------------------------------
await svc(`SELECT staff_revenue_set_fee_rate($1, 'gcash', 2.3, 0)`, [ADMIN]);
await svc(`SELECT staff_revenue_set_fee_rate($1, 'DEFAULT', 3, 1000)`, [ADMIN]);
await svc(`SELECT staff_revenue_set_ai_rate($1, 'generate-sop', 50.5)`, [ADMIN]);
const costId = (
  await svc(`SELECT staff_revenue_add_cost($1, 'Supabase Pro', 31000, $2) AS id`, [ADMIN, FROM])
).id;
await expectError(
  "a fee rate over 100% is refused",
  () => svc(`SELECT staff_revenue_set_fee_rate($1, 'GCASH', 150, 0)`, [ADMIN]),
  /check constraint/,
);
await expectError(
  "a cost with no name is refused",
  () => svc(`SELECT staff_revenue_add_cost($1, '  ', 100, $2)`, [ADMIN, FROM]),
  /check constraint/,
);
await expectError(
  "a negative cost is refused",
  () => svc(`SELECT staff_revenue_add_cost($1, 'x', -5, $2)`, [ADMIN, FROM]),
  /check constraint/,
);

// --- The report ---------------------------------------------------------------------------
let r = await report();
const t = r.totals;
check("cash is what was paid, not what's in review", t.cash === 29900, t);
check("split into plans and add-ons", t.planCash === 19900 && t.addonCash === 10000, t);
// GCash 2.3% of 19900 = 457.7 -> 458; the card has no rate of its own: DEFAULT 3% + 1000 = 1300.
check("Xendit fees by channel, else the DEFAULT rate", t.fees === 458 + 1300, t);
check("AI usage: 10 calls x 50.5 centavos", t.ai === 505, t);
check("a fixed cost over a whole month is its monthly amount", t.fixed === 31000, t);
check("profit = cash - fees - AI - fixed", t.profit === 29900 - 1758 - 505 - 31000, t);
check(
  "the month row adds up to the totals",
  r.months.length === 1 && r.months[0].profit === t.profit && r.months[0].cash === t.cash,
  r.months,
);
check(
  "payments in review are shown apart",
  r.review.count === 1 && r.review.amount === 39900,
  r.review,
);
check(
  "MRR counts what's running now (M), not X's ended plan",
  r.mrr.now === 19900 && r.mrr.arr === 19900 * 12 && r.mrr.paying === 1 && r.mrr.arppu === 19900,
  r.mrr,
);
check(
  "new MRR from this month's starts",
  r.movements.new === 19900 + 39900 && r.movements.newCount === 2,
  r.movements,
);
check(
  "churn: X's cancelled Premium ended this month",
  r.movements.churn === 39900 && r.movements.churned === 1 && r.movements.cancelled === 1,
  r.movements,
);
check(
  "the plan mix lists running plans only",
  r.mix.length === 1 && r.mix[0].planId === "normal" && r.mix[0].count === 1,
  r.mix,
);
check("Free counts primary managers with nothing paid running (X and F)", r.free === 2, r.free);
check(
  "the settings come back for the costs panel",
  r.settings.feeRates.length === 2 &&
    r.settings.aiRates.some((a) => a.fn === "generate-sop") &&
    r.settings.costs.length === 1,
  r.settings,
);

await db.exec(`DELETE FROM ai_calls`);
check(
  "AI cost still counts after the 48-hour purge (ai_call_days)",
  (await report()).totals.ai === 505,
);

// --- A cost spread over the days it runs ------------------------------------------------
const half = ymd(new Date(new Date(FROM).getTime() + 9 * 864e5)); // the 10th
await svc(`SELECT staff_revenue_end_cost($1, $2, $3)`, [ADMIN, costId, half]);
r = await report();
check(
  "ended on the 10th: 10 of the month's days count",
  r.totals.fixed === Math.round((31000 * 10) / daysInMonth),
  { fixed: r.totals.fixed, daysInMonth },
);
await expectError(
  "ending it again later isn't allowed",
  () => svc(`SELECT staff_revenue_end_cost($1, $2, $3)`, [ADMIN, costId, TO]),
  /isn't running then/,
);

// --- Ranges ---------------------------------------------------------------------------------
await expectError("an end before the start is refused", () => report(TO, FROM), /start date/);
await expectError(
  "more than three years is refused",
  () => report("2020-01-01", "2026-01-31"),
  /three years/,
);
r = await report("2020-01-01", "2020-01-31");
check(
  "a period with nothing in it is all zeros, not an error",
  r.totals.cash === 0 && r.totals.profit === 0,
  r.totals,
);

// --- Audit: ids only --------------------------------------------------------------------------
const audit = await q(
  `SELECT action, target_type, target_id, metadata FROM staff_audit_log WHERE action LIKE 'revenue.%' ORDER BY id`,
);
check(
  "every write is audited",
  audit.map((a) => a.action).join() ===
    "revenue.fee_rate_set,revenue.fee_rate_set,revenue.ai_rate_set,revenue.cost_added,revenue.cost_ended",
  audit,
);
check(
  "with ids only: no amounts, no cost names",
  audit.every((a) => JSON.stringify(a.metadata) === "{}") &&
    !JSON.stringify(audit).includes("Supabase") &&
    !JSON.stringify(audit).includes("31000"),
  audit,
);
check("a channel is stored upper-case", audit[0].target_id === "GCASH", audit[0]);

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
