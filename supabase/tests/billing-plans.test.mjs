// Runs 016-billing-plans.sql against a real Postgres (PGlite): plans and settings
// are closed to the app roles, the public readers show only what the pricing
// page may, staff writes are validated and audited with ids only, and applying
// the file twice leaves the data alone (S-22, S-27).
//
//   node supabase/tests/billing-plans.test.mjs
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
  "012-operations.sql",
  "013-roles.sql",
  "014-roles-fixes.sql",
  "016-billing-plans.sql",
]) {
  await db.exec(readFileSync(resolve(REPO, file), "utf8"));
}

const A1 = id(900);
const U = id(1);
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${U}', 'ana@example.com'), ('${A1}', 'a1@example.com');
`);

const audits = async () =>
  q(`SELECT action, target_type, target_id, metadata FROM public.staff_audit_log ORDER BY id`);
const save = (plan) =>
  one(`SELECT public.billing_save_plan($1, $2::jsonb) AS id`, [A1, JSON.stringify(plan)]).then(
    (r) => r.id,
  );
const list = () => one(`SELECT public.billing_list_plans($1) AS r`, [A1]).then((r) => r.r);
const setStatus = (planId, status) =>
  svc(`SELECT public.billing_set_plan_status($1, $2, $3)`, [A1, planId, status]);
const publicPlans = (role) =>
  as(role, () => q(`SELECT public.billing_public_plans() AS r`)).then((r) => r[0].r);

// --- tables are closed -----------------------------------------------------------
for (const role of ["anon", "authenticated"]) {
  for (const table of ["billing_plans", "billing_settings"]) {
    await expectError(
      `${role} can't read ${table}`,
      () => as(role, () => q(`SELECT * FROM public.${table}`)),
      /permission denied/,
    );
  }
}
const rls = await q(
  `SELECT relname, relrowsecurity FROM pg_class
   WHERE relname IN ('billing_plans', 'billing_settings') ORDER BY relname`,
);
check(
  "row level security is on for both tables",
  rls.length === 2 && rls.every((r) => r.relrowsecurity),
  rls,
);
const policies = await q(
  `SELECT count(*)::int AS n FROM pg_policies WHERE tablename IN ('billing_plans', 'billing_settings')`,
);
check("neither table has a policy", policies[0].n === 0, policies);

// --- staff functions are for the server key only ----------------------------------
for (const role of ["anon", "authenticated"]) {
  for (const call of [
    `billing_list_plans('${A1}')`,
    `billing_save_plan('${A1}', '{"name":"X","interval":"monthly"}'::jsonb)`,
    `billing_set_plan_status('${A1}', '${id(5)}', 'active')`,
    `billing_get_settings('${A1}')`,
    `billing_save_settings('${A1}', '{"free_tier_enabled":true}'::jsonb)`,
    `billing_audit('${A1}', 'x', 'plan', 'y', '{}'::jsonb)`,
  ]) {
    await expectError(
      `${role} can't run ${call.split("(")[0]}`,
      () => as(role, () => q(`SELECT * FROM public.${call}`)),
      /permission denied/,
    );
  }
}
await expectError(
  "anon can't read the household settings",
  () => as("anon", () => q(`SELECT public.billing_settings_public()`)),
  /permission denied/,
);
check(
  "authenticated can read the free-tier settings",
  (await as("authenticated", () => q(`SELECT public.billing_settings_public() AS r`)))[0].r
    .free_tier_enabled === true,
);
check("anon sees no plans before any exist", (await publicPlans("anon")).length === 0);

// --- save, list, publish, unpublish ------------------------------------------------
let before = (await audits()).length;
const P1 = await save({
  name: "Family",
  tagline: "For one busy home",
  inclusions: ["Unlimited tasks", "  Payroll sheets  ", ""],
  interval: "monthly",
  base_centavos: 29900,
  included_helpers: 2,
  included_managers: null,
  extra_helper_centavos: 5000,
  trial_days: 14,
  is_public: true,
  sort_order: 2,
});
const P2 = await save({ name: "Starter", interval: "one_time", is_public: true, sort_order: 1 });
const P3 = await save({ name: "Hidden", interval: "yearly", base_centavos: 100000 });
let plans = await list();
const p1 = plans.find((p) => p.id === P1);
check(
  "a new plan lands as a draft with its fields",
  p1.status === "draft" &&
    p1.base_centavos === 29900 &&
    p1.included_helpers === 2 &&
    p1.included_managers === null &&
    p1.extra_manager_centavos === null &&
    p1.trial_days === 14 &&
    JSON.stringify(p1.inclusions) === JSON.stringify(["Unlimited tasks", "Payroll sheets"]),
  p1,
);
check(
  "the list shows all three in sort order",
  plans.map((p) => p.id).join() === [P3, P2, P1].join(),
);
check("anon sees no draft plans", (await publicPlans("anon")).length === 0);

await setStatus(P1, "active");
await setStatus(P2, "active");
await setStatus(P3, "active");
let pub = await publicPlans("anon");
check(
  "anon sees active public plans in order, not the private one",
  pub.map((p) => p.id).join() === [P2, P1].join() && pub[1].name === "Family",
  pub,
);
check(
  "authenticated sees the same",
  (await publicPlans("authenticated")).map((p) => p.id).join() === [P2, P1].join(),
);

await svc(`SELECT public.billing_set_plan_status($1, $2, 'draft')`, [A1, P1]);
pub = await publicPlans("anon");
check("unpublishing removes the plan from the public list", pub.map((p) => p.id).join() === P2);
await setStatus(P1, "active");

// update never touches status
await save({
  id: P1,
  name: "Family Plus",
  interval: "yearly",
  base_centavos: 299000,
  is_public: true,
});
plans = await list();
const upd = plans.find((p) => p.id === P1);
check(
  "update replaces fields but keeps the status",
  upd.name === "Family Plus" &&
    upd.interval === "yearly" &&
    upd.base_centavos === 299000 &&
    upd.status === "active" &&
    upd.included_helpers === null,
  upd,
);
check("update didn't add a plan", plans.length === 3, plans.length);
check("updating the row moves updated_at", new Date(upd.updated_at) >= new Date(upd.created_at));

// status transitions
await expectError(
  "draft can't go straight to archived",
  () => setStatus(P3, "draft").then(() => setStatus(P3, "archived")),
  /can't be moved to archived/,
);
await setStatus(P3, "active");
await setStatus(P3, "archived");
await expectError("archived can't go live again", () => setStatus(P3, "active"), /can't be moved/);
await setStatus(P3, "draft");
await expectError("an unknown status is refused", () => setStatus(P3, "retired"), /must be draft/);
await expectError("a missing plan is refused", () => setStatus(id(777), "active"), /doesn't exist/);

// --- validation ----------------------------------------------------------------------
const refused = async (label, plan, pattern) => {
  const n = (await audits()).length;
  await expectError(label, () => save(plan), pattern);
  check(`${label}: nothing audited`, (await audits()).length === n);
};
await refused(
  "an invalid interval is refused",
  { name: "A", interval: "weekly" },
  /interval must be/,
);
await refused("a missing interval is refused", { name: "A" }, /interval must be/);
await refused(
  "a negative price is refused",
  { name: "A", interval: "monthly", base_centavos: -1 },
  /base price can't be negative/,
);
await refused(
  "a fractional price is refused",
  { name: "A", interval: "monthly", base_centavos: 10.5 },
  /whole number/,
);
await refused(
  "a text price is refused",
  { name: "A", interval: "monthly", base_centavos: "100" },
  /whole number/,
);
await refused(
  "a negative seat count is refused",
  { name: "A", interval: "monthly", included_helpers: -2 },
  /can't be negative/,
);
await refused(
  "a negative extra price is refused",
  { name: "A", interval: "monthly", extra_home_centavos: -5 },
  /can't be negative/,
);
await refused("an empty name is refused", { name: "  ", interval: "monthly" }, /needs a name/);
await refused(
  "a 61 character name is refused",
  { name: "x".repeat(61), interval: "monthly" },
  /too long/,
);
await refused(
  "a non-list of inclusions is refused",
  { name: "A", interval: "monthly", inclusions: "all" },
  /list of short sentences/,
);
await refused(
  "a text public flag is refused",
  { name: "A", interval: "monthly", is_public: "yes" },
  /yes or no/,
);
await refused(
  "updating a plan that isn't there is refused",
  { id: id(777), name: "A", interval: "monthly" },
  /doesn't exist/,
);
await expectError(
  "a non-object plan is refused",
  () => one(`SELECT public.billing_save_plan($1, '[]'::jsonb)`, [A1]),
  /set of fields/,
);
check("refusals left the plan count alone", (await list()).length === 3);

// --- settings -------------------------------------------------------------------------
const settings = await one(`SELECT public.billing_get_settings($1) AS r`, [A1]).then((r) => r.r);
check(
  "settings start on with unlimited free seats",
  settings.id === 1 && settings.free_tier_enabled === true && settings.free_helper_seats === null,
  settings,
);
await svc(`SELECT public.billing_save_settings($1, $2::jsonb)`, [
  A1,
  JSON.stringify({
    free_tier_enabled: false,
    free_helper_seats: 1,
    free_manager_seats: 2,
    support_email: " help@linara.example ",
  }),
]);
const saved = await one(`SELECT public.billing_get_settings($1) AS r`, [A1]).then((r) => r.r);
check(
  "settings round-trip",
  saved.free_tier_enabled === false &&
    saved.free_helper_seats === 1 &&
    saved.free_manager_seats === 2 &&
    saved.support_email === "help@linara.example",
  saved,
);
check(
  "households read the saved settings",
  (await as("authenticated", () => q(`SELECT public.billing_settings_public() AS r`)))[0].r
    .free_tier_enabled === false,
);
await expectError(
  "a bad support email is refused",
  () =>
    svc(
      `SELECT public.billing_save_settings($1, '{"free_tier_enabled":true,"support_email":"nope"}'::jsonb)`,
      [A1],
    ),
  /doesn't look like an email/,
);
await expectError(
  "negative free seats are refused",
  () =>
    svc(
      `SELECT public.billing_save_settings($1, '{"free_tier_enabled":true,"free_helper_seats":-1}'::jsonb)`,
      [A1],
    ),
  /can't be negative/,
);
await expectError(
  "settings without the free-tier switch are refused",
  () => svc(`SELECT public.billing_save_settings($1, '{}'::jsonb)`, [A1]),
  /free tier is on/,
);

// --- audit ------------------------------------------------------------------------------
const log = (await audits()).slice(before);
const saves = log.filter((a) => a.action === "billing.plan_saved");
const statuses = log.filter((a) => a.action === "billing.plan_status");
const sets = log.filter((a) => a.action === "billing.settings_saved");
check("every plan save left one audit row", saves.length === 4, saves.length);
check(
  "plan audit rows target the plan with ids only",
  saves.every((a) => a.target_type === "plan" && /^[0-9a-f-]{36}$/.test(a.target_id)) &&
    saves[0].metadata.plan_id === P1 &&
    saves[0].metadata.created === true &&
    saves[3].metadata.created === false,
  saves,
);
check(
  "every status change left an audit row with from and to",
  statuses.length === 9 &&
    statuses[0].metadata.from === "draft" &&
    statuses[0].metadata.to === "active",
  statuses.length,
);
check(
  "the settings save left one audit row",
  sets.length === 1 && sets[0].target_type === "settings" && sets[0].target_id === "1",
  sets,
);
check(
  "no audit row carries an amount or a seat count",
  !log.some((a) => /centavos|price|amount|seats|base/.test(JSON.stringify(a.metadata))),
  log.map((a) => a.metadata),
);

// --- applying the file twice ---------------------------------------------------------------
const snapshot = async () => ({
  plans: await list(),
  settings: await one(`SELECT public.billing_get_settings($1) AS r`, [A1]).then((r) => r.r),
  audit: (await audits()).length,
});
const first = await snapshot();
await db.exec(readFileSync(resolve(REPO, "016-billing-plans.sql"), "utf8"));
const second = await snapshot();
check(
  "a second apply leaves plans, settings and the audit log untouched",
  JSON.stringify(first) === JSON.stringify(second),
);
check(
  "a second apply keeps the privileges",
  (await publicPlans("anon")).length === 2 &&
    (await as("authenticated", () => q(`SELECT public.billing_settings_public() AS r`)))[0].r !==
      null,
);
await expectError(
  "a second apply keeps staff functions closed to authenticated",
  () => as("authenticated", () => q(`SELECT public.billing_list_plans('${A1}')`)),
  /permission denied/,
);

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
