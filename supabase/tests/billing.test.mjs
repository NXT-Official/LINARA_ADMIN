// Runs 018-billing.sql on top of LINARA's add-billing.sql against a real
// Postgres (PGlite): only the server key reaches it, every write leaves an
// audit entry with ids only, a price change is a new version that current
// subscribers don't move to, and the database's own rules hold whatever the
// console sends.
//
//   bun run test:sql
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
// What add-billing.sql reads from the main app beyond the stub.
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
]) {
  await db.exec(readFileSync(resolve(REPO, file), "utf8"));
}
console.log("migrations applied");

const ADMIN = id(901);
const M = id(1); // a primary manager
const H = id(101);
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${ADMIN}', 'admin@example.com'), ('${M}', 'm@example.com');
  INSERT INTO public.user_profiles (id, household_id, full_name) VALUES ('${M}', '${H}', 'Ben Reyes');
  INSERT INTO public.households (id, name) VALUES ('${H}', 'Reyes Household');
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES ('${H}', '${M}', 'primary_manager');
`);

// --- Permissions -------------------------------------------------------------------------
const TS = readFileSync(resolve(REPO, "../src/features/auth/permissions.ts"), "utf8");
const tsList = [
  ...TS.slice(TS.indexOf("PERMISSIONS = ["), TS.indexOf("] as const")).matchAll(/"([a-z.]+)"/g),
].map((m) => m[1]);
const known = (await one(`SELECT public.staff_known_permissions() AS p`)).p;
// 019-revenue.sql adds revenue.*; revenue.test.mjs checks the full list.
const upTo018 = tsList.filter((p) => !p.startsWith("revenue."));
check(
  "the permission list matches permissions.ts (up to 018)",
  upTo018.length === 19 && [...upTo018].sort().join() === [...known].sort().join(),
  { tsList, known },
);
const presets = await q(`SELECT preset, permissions FROM staff_role_defs WHERE preset IS NOT NULL`);
const has = (preset, p) => presets.find((r) => r.preset === preset)?.permissions.includes(p);
check(
  "Super admin, Admin and Mods get billing and switches",
  ["super_admin", "admin", "mods"].every(
    (p) => has(p, "billing.view") && has(p, "billing.manage") && has(p, "switches.manage"),
  ),
);
check(
  "Sales and Support don't",
  !has("sales", "billing.view") && !has("support", "billing.manage"),
);

// --- Only the server key ---------------------------------------------------------------------
for (const role of ["authenticated", "anon"]) {
  await expectError(
    `${role} can't read the billing state`,
    () => as(role, () => q(`SELECT staff_billing_state()`)),
    /permission denied/,
  );
  await expectError(
    `${role} can't flip a switch`,
    () => as(role, () => q(`SELECT staff_set_switch($1, 'staff_pay_hr', true, 'x')`, [ADMIN])),
    /permission denied/,
  );
}
let s = (await svc(`SELECT staff_billing_state() AS s`)).s;
check(
  "the state lists the three launch plans, with their versions",
  s.plans.map((p) => `${p.id}:${p.versions.length}`).join() === "free:1,normal:1,premium:1",
  s.plans,
);
check("the test tools start off", s.testTools === false);

// --- A price change is a new version; subscribers stay on theirs (R3) ------------------------------
await svc(`SELECT staff_billing_set_plan($1, $2, 'normal', 'monthly', '[]')`, [ADMIN, M]);
const normal = s.plans.find((p) => p.id === "normal");
const content = { ...normal.content, prices: { ...normal.content.prices, monthly: 24900 } };
await svc(`SELECT staff_billing_save_plan($1, 'normal', $2, 'Monthly ₱199 to ₱249', false)`, [
  ADMIN,
  JSON.stringify(content),
]);
s = (await svc(`SELECT staff_billing_state() AS s`)).s;
const n2 = s.plans.find((p) => p.id === "normal");
check(
  "saving a published plan adds version 2",
  n2.versions[0].version === 2 && n2.content.prices.monthly === 24900,
);
check("the price is no longer a placeholder", n2.pricePlaceholder === false);
const sub = s.subscriptions.find((x) => x.id === M);
check(
  "the subscriber stays on version 1, at its price",
  sub.planVersion === 1 && sub.amount === 19900,
  sub,
);
check(
  "the app's catalog sells version 2",
  (await one(`SELECT billing_catalog() #> '{plans,1,prices,monthly}' AS p`)).p === 24900,
);
await expectError(
  "a plan without her leave and rest days is refused",
  () =>
    svc(`SELECT staff_billing_save_plan($1, 'normal', $2, '', false)`, [
      ADMIN,
      JSON.stringify({ ...content, features: { ...content.features, time_off: false } }),
    ]),
  /check constraint/,
);

// --- Drafts, status, order --------------------------------------------------------------------
await svc(`SELECT staff_billing_create_plan($1, 'family', $2)`, [
  ADMIN,
  JSON.stringify({ ...content, name: "Family" }),
]);
await expectError(
  "the same id twice",
  () => svc(`SELECT staff_billing_create_plan($1, 'family', $2)`, [ADMIN, JSON.stringify(content)]),
  /already exists/,
);
check(
  "a new plan is a draft, not on sale",
  (await one(`SELECT jsonb_array_length(billing_catalog() -> 'plans') AS n`)).n === 3,
);
await svc(`SELECT staff_billing_set_status($1, 'family', 'published')`, [ADMIN]);
check(
  "published: version 1 from its draft, on sale",
  (await one(`SELECT jsonb_array_length(billing_catalog() -> 'plans') AS n`)).n === 4,
);
await expectError(
  "a published plan can't be deleted",
  () => svc(`SELECT staff_billing_delete_plan($1, 'family')`, [ADMIN]),
  /Retire it/,
);
await expectError(
  "Free can't be retired",
  () => svc(`SELECT staff_billing_set_status($1, 'free', 'retired')`, [ADMIN]),
  /can't be retired/,
);
await svc(`SELECT staff_billing_create_plan($1, 'trial', $2)`, [ADMIN, JSON.stringify(content)]);
await svc(`SELECT staff_billing_delete_plan($1, 'trial')`, [ADMIN]);
check(
  "a draft never published can be deleted",
  !(await one(`SELECT 1 AS x FROM billing_plans WHERE id = 'trial'`)),
);
await expectError(
  "an order that leaves a plan out",
  () => svc(`SELECT staff_billing_set_order($1, ARRAY['free', 'normal'])`, [ADMIN]),
  /changed/,
);
await svc(`SELECT staff_billing_set_order($1, ARRAY['premium', 'normal', 'free', 'family'])`, [
  ADMIN,
]);
check(
  "a full order is saved",
  (await one(`SELECT billing_catalog() #>> '{plans,0,id}' AS p`)).p === "premium",
);

// --- Add-ons -------------------------------------------------------------------------------------
await expectError(
  "an add-on offered without a price",
  () =>
    svc(`SELECT staff_billing_save_addon($1, $2)`, [
      ADMIN,
      JSON.stringify({
        id: "extra_comanager",
        name: "Extra co-manager",
        limitKey: "co_managers",
        step: 1,
        monthlyPrice: null,
        status: "active",
      }),
    ]),
  /check constraint/,
);
await svc(`SELECT staff_billing_save_addon($1, $2)`, [
  ADMIN,
  JSON.stringify({
    id: "extra_comanager",
    name: "Extra co-manager",
    limitKey: "co_managers",
    step: 1,
    monthlyPrice: null,
    status: "hidden",
  }),
]);
check(
  "a hidden add-on without a price is kept, and not sold",
  !(await one(`SELECT billing_catalog() -> 'addons' AS a`)).a.some(
    (a) => a.id === "extra_comanager",
  ),
);

// --- Switches -----------------------------------------------------------------------------------
await expectError(
  "already off",
  () => svc(`SELECT staff_set_switch($1, 'staff_pay_hr', false, 'x')`, [ADMIN]),
  /already off/,
);
await expectError(
  "no reason",
  () => svc(`SELECT staff_set_switch($1, 'staff_pay_hr', true, '  ')`, [ADMIN]),
  /Say why/,
);
await expectError(
  "an unknown switch",
  () => svc(`SELECT staff_set_switch($1, 'free_money', true, 'x')`, [ADMIN]),
  /doesn't exist/,
);
await svc(`SELECT staff_set_switch($1, 'staff_pay_hr', true, 'Cleared by legal')`, [ADMIN]);
check("on: the app sees it", (await one(`SELECT pay_hr_enabled() AS on`)).on === true);
s = (await svc(`SELECT staff_billing_state() AS s`)).s;
check(
  "its history keeps the reason",
  s.switchHistory[0]?.note === "Cleared by legal" && s.switchHistory[0].enabled === true,
);
await svc(`SELECT staff_set_switch($1, 'staff_pay_hr', false, 'Back off for now')`, [ADMIN]);

// --- Subscriptions -----------------------------------------------------------------------------
await svc(`SELECT staff_billing_set_cancel($1, $2, true)`, [ADMIN, M]);
await expectError(
  "cancelling twice",
  () => svc(`SELECT staff_billing_set_cancel($1, $2, true)`, [ADMIN, M]),
  /nothing to cancel/,
);
await svc(`SELECT staff_billing_set_cancel($1, $2, false)`, [ADMIN, M]);
await expectError(
  "a plan for someone who manages no household",
  () => svc(`SELECT staff_billing_set_plan($1, $2, 'normal', 'monthly', '[]')`, [ADMIN, ADMIN]),
  /primary manager/,
);
await expectError(
  "the test tools are off",
  () => svc(`SELECT staff_billing_test_shift($1, $2, -2)`, [ADMIN, M]),
  /Test tools are off/,
);
await q(`UPDATE app_switches SET enabled = true WHERE key = 'billing_test_tools'`);
await expectError(
  "too far",
  () => svc(`SELECT staff_billing_test_shift($1, $2, -400)`, [ADMIN, M]),
  /60 days/,
);
await svc(`SELECT staff_billing_test_shift($1, $2, -2)`, [ADMIN, M]);
s = (await svc(`SELECT staff_billing_state() AS s`)).s;
check(
  "two days past renewal shows as past due",
  s.subscriptions.find((x) => x.id === M).status === "past_due",
);
await svc(`SELECT staff_billing_test_shift($1, $2, -9)`, [ADMIN, M]);
s = (await svc(`SELECT staff_billing_state() AS s`)).s;
check(
  "nine days past: restricted",
  s.subscriptions.find((x) => x.id === M).status === "restricted",
);

// --- The audit log: one entry per write, ids only --------------------------------------------------
const audit = await q(
  `SELECT action, target_type, target_id, metadata FROM staff_audit_log ORDER BY id`,
);
const actions = audit.map((a) => a.action);
for (const a of [
  "subscription.plan_set",
  "plan.version_published",
  "plan.created",
  "plan.status_changed",
  "plan.deleted",
  "plan.reordered",
  "addon.saved",
  "switch.changed",
  "subscription.cancel_at_period_end",
  "subscription.resumed",
  "subscription.test_shift",
]) {
  check(`audited: ${a}`, actions.includes(a));
}
check(
  "no names, emails or amounts in it",
  !JSON.stringify(audit).match(/Ben|Reyes|@example|24900|19900|Cleared by legal/),
  audit,
);
check("refused writes left no entry", actions.filter((a) => a === "switch.changed").length === 2);

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
