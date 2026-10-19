// Runs 017-billing-subscriptions.sql against a real Postgres (PGlite): the four
// tables are closed to the app roles, a primary manager quotes and starts a
// subscription, the Xendit webhook (service_role) pays it once however often it
// calls and ignores what it shouldn't act on, a renewal extends the period from
// the previous end, an underpaid invoice marks it past due, paying a new plan
// replaces an old one whose homes it all covers (and expires its pending
// invoices), a payment that can't apply (after a manual mark, a second session,
// a replaced plan) is noted for a refund, a co-manager, an ex-primary and a
// second household can't act on what isn't theirs, billing_my_billing never
// shows notes or raw callbacks, staff mark an invoice paid by hand and comp a
// household with ids-only audit rows, trials can't be farmed, a renewed comp
// gets concrete seats, a deleted owner leaves the revenue record, entitlements
// fall back to the free tier, a paid plan cancels an abandoned checkout for its
// homes (a late payment of it is noted for a refund), a renewal replaces
// nothing, Xendit confirming a manual mark asks staff to check, a trial gives
// only the plan's included seats, seat counts stay within 0 to 1000, a first
// payment from a buyer who has since handed over replaces nothing, staff revoke
// a subscription for good (no renew, cancel, link or payment brings it back),
// the server key is nobody's household, a household's cancel expires its
// pending invoices (a late payment of one is noted for a refund, staff can't
// mark one paid), the free tier never names a revoked subscription, a plan
// with subscribers keeps its interval, applying the file again leaves the
// data alone, and it upgrades a database from before revoked_at. Ported from LINARA 594daf6
// supabase/tests/subscriptions.test.mjs (S-22, S-27).
//
//   node supabase/tests/billing-subscriptions.test.mjs
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
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
/** As an API role, signed in as uid (auth.uid()) or not; back to the owner afterwards. */
const asRole = async (role, uid, fn) => {
  await db.query("SELECT set_config('test.uid', $1, false)", [uid ?? ""]);
  await db.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('test.uid', '', false)");
  }
};
/** The signed-in household user the next household calls run as. */
let me = null;
const as = (uid) => {
  me = uid;
};
const asMe = (fn) => asRole("authenticated", me, fn);
const rpc = (sql, params) => asMe(() => one(`SELECT ${sql} AS r`, params)).then((row) => row.r);
/** The server key: the console's server and LINARA's edge functions (no auth.uid()). */
const svc = (sql, params) => asRole("service_role", null, () => q(sql, params));
const svcRpc = (sql, params) => svc(`SELECT ${sql} AS r`, params).then((rows) => rows[0].r);

const SQL_FILES = [
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
  "015-business-permissions.sql",
  "016-billing-plans.sql",
  "017-billing-subscriptions.sql",
];
for (const file of SQL_FILES) {
  await db.exec(readFileSync(resolve(REPO, file), "utf8"));
}
await db.exec(readFileSync(resolve(REPO, "017-billing-subscriptions.sql"), "utf8"));
check("017 applies twice", true);

const A1 = "00000000-0000-0000-0000-000000000900"; // console staff member
const P = "00000000-0000-0000-0000-00000000000a"; // primary of H1, H4 and H6
const C = "00000000-0000-0000-0000-00000000000c"; // co-manager of H1
const M2 = "00000000-0000-0000-0000-0000000000b2"; // primary of H2
const Q = "00000000-0000-0000-0000-0000000000b3"; // primary of H3, later hands over
const R = "00000000-0000-0000-0000-0000000000b4"; // co-manager of H3, later its primary
const T = "00000000-0000-0000-0000-0000000000b5"; // primary of H5 and H10
const S = "00000000-0000-0000-0000-0000000000b6"; // primary of H8 and H9
const V = "00000000-0000-0000-0000-0000000000b7"; // co-manager of H9, later its primary
const H1 = "10000000-0000-0000-0000-000000000001";
const H2 = "10000000-0000-0000-0000-000000000002";
const H3 = "10000000-0000-0000-0000-000000000003";
const H4 = "10000000-0000-0000-0000-000000000004";
const H5 = "10000000-0000-0000-0000-000000000005";
const H6 = "10000000-0000-0000-0000-000000000006";
const H7 = "10000000-0000-0000-0000-000000000007"; // nobody manages it
const H8 = "10000000-0000-0000-0000-000000000008";
const H9 = "10000000-0000-0000-0000-000000000009";
const H10 = "10000000-0000-0000-0000-000000000010";
const helper = (n) => `20000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

await db.exec(`
  INSERT INTO auth.users (id, email) VALUES
    ('${A1}', 'staff@example.com'), ('${P}', 'ben@example.com'), ('${C}', 'carla@example.com'),
    ('${M2}', 'ana@example.com'), ('${Q}', 'quin@example.com'), ('${R}', 'rico@example.com'),
    ('${T}', 'tess@example.com'), ('${S}', 'sol@example.com'), ('${V}', 'vic@example.com');
  INSERT INTO public.households (id, name) VALUES
    ('${H1}', 'Reyes Household'), ('${H2}', 'Cruz Household'), ('${H3}', 'Lim Household'),
    ('${H4}', 'Reyes Beach House'), ('${H5}', 'Tan Household'), ('${H6}', 'Reyes Farm'),
    ('${H7}', 'Empty House'), ('${H8}', 'Santos Household'), ('${H9}', 'Santos Annex'),
    ('${H10}', 'Tan Beach House');
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES
    ('${H1}', '${P}', 'primary_manager'), ('${H1}', '${C}', 'co_manager'),
    ('${H4}', '${P}', 'primary_manager'), ('${H6}', '${P}', 'primary_manager'),
    ('${H2}', '${M2}', 'primary_manager'),
    ('${H3}', '${Q}', 'primary_manager'), ('${H3}', '${R}', 'co_manager'),
    ('${H5}', '${T}', 'primary_manager'), ('${H10}', '${T}', 'primary_manager'),
    ('${H8}', '${S}', 'primary_manager'), ('${H9}', '${S}', 'primary_manager'),
    ('${H9}', '${V}', 'co_manager');
  INSERT INTO public.helper_profiles (id, household_id, name, station, monthly_rate, status) VALUES
    ('${helper(1)}', '${H1}', 'Rosa', 'Cook', 7000, 'ACTIVE'),
    ('${helper(2)}', '${H1}', 'Marites', 'Yaya', 8000, 'PENDING_CLAIM'),
    ('${helper(3)}', '${H1}', 'Lorna', 'Laundry', 6000, 'INACTIVE'),
    ('${helper(4)}', '${H2}', 'Nena', 'Cook', 7000, 'ACTIVE');
`);
const YEAR = (await one(`SELECT EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Manila')::int AS y`)).y;

const XENDIT = (session) => `https://checkout-staging.xendit.co/web/${session}`;
const quote = (plan, helpers, managers, homes) =>
  rpc(`public.billing_quote($1, $2, $3, $4::uuid[])`, [plan, helpers, managers, homes]);
const start = (plan, helpers, managers, homes) =>
  rpc(`public.billing_start($1, $2, $3, $4::uuid[])`, [plan, helpers, managers, homes]);
const renew = (id) => rpc(`public.billing_renew($1)`, [id]);
const cancel = (id) => rpc(`public.billing_cancel($1)`, [id]);
const entitlements = (household) => rpc(`public.billing_household_entitlements($1)`, [household]);
const myBilling = (household) => rpc(`public.billing_my_billing($1)`, [household]);
const trialEligible = (plan, homes) =>
  rpc(`public.billing_trial_eligible($1, $2::uuid[])`, [plan, homes]);
const attach = (invoiceId, session, url, email = null) =>
  asMe(() =>
    q(`SELECT public.billing_attach_session($1, $2, $3, now() + interval '1 day', $4)`, [
      invoiceId,
      session,
      url,
      email,
    ]),
  );
const pay = (externalId, status, paidCentavos, session = "ps_webhook") =>
  svcRpc(
    `public.billing_record_invoice_result($1, $4, $2, $3, now(), 'GCASH', '{"event":"payment_session.completed"}'::jsonb)`,
    [externalId, status, paidCentavos, session],
  );
const grant = (household, plan, helpers, managers, endSql, note, reason) =>
  svcRpc(`public.billing_grant($1, $2, $3, $4, $5, ${endSql}, $6, $7)`, [
    A1,
    household,
    plan,
    helpers,
    managers,
    note,
    reason,
  ]);
const markPaid = (invoiceId, channel, note, reason = "Paid by GCash to the owner") =>
  svcRpc(`public.billing_mark_paid($1, $2, $3, $4, $5)`, [A1, invoiceId, channel, note, reason]);
const revoke = (subscriptionId, reason) =>
  svcRpc(`public.billing_revoke($1, $2, $3)`, [A1, subscriptionId, reason]);
const householdDetail = (household, nowSql = "now()") =>
  svcRpc(`public.billing_household_detail($1, $2, ${nowSql})`, [A1, household]);
const invoiceDetail = (invoiceId) =>
  svcRpc(`public.billing_invoice_detail($1, $2)`, [A1, invoiceId]);
const subRow = (id) => one(`SELECT * FROM public.billing_subscriptions WHERE id = $1`, [id]);
const invoiceRow = (id) => one(`SELECT * FROM public.billing_invoices WHERE id = $1`, [id]);
const snapshot = async (subId, invoiceId) =>
  JSON.stringify([
    await one(`SELECT to_jsonb(s) AS j FROM public.billing_subscriptions s WHERE id = $1`, [subId]),
    await one(`SELECT to_jsonb(i) AS j FROM public.billing_invoices i WHERE id = $1`, [invoiceId]),
  ]);
const nearNow = async (ts) =>
  (await one(`SELECT abs(extract(epoch FROM ($1::timestamptz - now()))) < 120 AS ok`, [ts])).ok;
const setEnd = (id, sql) =>
  q(`UPDATE public.billing_subscriptions SET current_period_end = ${sql} WHERE id = $1`, [id]);

// --- The tables are closed ------------------------------------------------------------
const TABLES = [
  "billing_subscriptions",
  "billing_subscription_homes",
  "billing_invoice_counters",
  "billing_invoices",
];
for (const role of ["anon", "authenticated"]) {
  for (const table of TABLES) {
    await expectError(
      `${role} can't read ${table}`,
      () => asRole(role, P, () => q(`SELECT * FROM public.${table}`)),
      /permission denied/,
    );
  }
}
const rls = await q(
  `SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY ($1::text[]) ORDER BY relname`,
  [TABLES],
);
check(
  "row level security is on for all four tables",
  rls.length === 4 && rls.every((r) => r.relrowsecurity),
  rls,
);
check(
  "none of them has a policy",
  (
    await one(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = ANY ($1::text[])`, [
      TABLES,
    ])
  ).n === 0,
);

// --- Function privileges ----------------------------------------------------------------
const HOUSEHOLD_FNS = [
  "public.billing_quote(uuid, int, int, uuid[])",
  "public.billing_trial_eligible(uuid, uuid[])",
  "public.billing_start(uuid, int, int, uuid[])",
  "public.billing_attach_session(uuid, text, text, timestamptz, text)",
  "public.billing_renew(uuid)",
  "public.billing_cancel(uuid)",
  "public.billing_household_entitlements(uuid)",
  "public.billing_my_billing(uuid)",
];
const SERVER_FNS = [
  "public.billing_record_invoice_result(text, text, text, bigint, timestamptz, text, jsonb)",
  "public.billing_grant(uuid, uuid, uuid, int, int, timestamptz, text, text)",
  "public.billing_mark_paid(uuid, uuid, text, text, text)",
  "public.billing_revoke(uuid, uuid, text)",
  "public.billing_household_detail(uuid, uuid, timestamptz)",
  "public.billing_invoice_detail(uuid, uuid)",
  "public.billing_audit(uuid, text, text, text, text, jsonb)",
  "public.billing_manages(uuid, uuid)",
  "public.billing_can_manage(uuid, uuid)",
  "public.billing_period_end(timestamptz, text)",
  "public.billing_peso(bigint)",
  "public.billing_add_note(text, text)",
  "public.billing_text(text, text, int)",
  "public.billing_check_seats(int, int)",
  "public.billing_next_invoice_number()",
  "public.billing_price(public.billing_plans, int, int, int)",
  "public.billing_new_invoice(uuid, timestamptz, jsonb)",
  "public.billing_settle_invoice(uuid, text, bigint, timestamptz, text, jsonb, text)",
  "public.billing_entitlements(uuid, timestamptz)",
  "public.billing_usage(uuid)",
];
const privileges = await Promise.all(
  [...HOUSEHOLD_FNS, ...SERVER_FNS].map((fn) =>
    one(
      `SELECT $1 AS fn, has_function_privilege('anon', $1, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated,
              has_function_privilege('service_role', $1, 'EXECUTE') AS service`,
      [fn],
    ),
  ),
);
check(
  "anon executes none of 017's functions",
  privileges.every((p) => !p.anon),
  privileges.filter((p) => p.anon).map((p) => p.fn),
);
check(
  "authenticated executes exactly the household functions",
  privileges.every((p) => p.authenticated === HOUSEHOLD_FNS.includes(p.fn)),
  privileges.filter((p) => p.authenticated !== HOUSEHOLD_FNS.includes(p.fn)).map((p) => p.fn),
);
check(
  "service_role executes every one of them",
  privileges.every((p) => p.service),
  privileges.filter((p) => !p.service).map((p) => p.fn),
);
const everyBilling = await q(
  `SELECT p.oid::regprocedure::text AS fn,
          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'billing\\_%'`,
);
const PUBLIC_016 = ["billing_public_plans()", "billing_settings_public()"];
check(
  "no billing function outside the lists is open to anon or authenticated",
  everyBilling.every(
    (p) =>
      (!p.anon || p.fn === "billing_public_plans()") &&
      (!p.authenticated ||
        PUBLIC_016.includes(p.fn) ||
        HOUSEHOLD_FNS.some((f) => f.startsWith(`public.${p.fn.split("(")[0]}(`))),
  ),
  everyBilling.filter((p) => p.anon || p.authenticated).map((p) => p.fn),
);
for (const role of ["anon", "authenticated"]) {
  for (const call of [
    `billing_record_invoice_result('sub_x_1', 'ps', 'PAID', 1, now(), 'GCASH', '{}'::jsonb)`,
    `billing_grant('${A1}', '${H2}', gen_random_uuid(), 1, 1, NULL, 'x', 'reason')`,
    `billing_mark_paid('${A1}', gen_random_uuid(), 'gcash', 'x', 'reason')`,
    `billing_revoke('${A1}', gen_random_uuid(), 'reason')`,
    `billing_check_seats(1, 1)`,
    `billing_household_detail('${A1}', '${H1}', now())`,
    `billing_invoice_detail('${A1}', gen_random_uuid())`,
    `billing_audit('${A1}', 'x', 'invoice', 'y', 'r', '{}'::jsonb)`,
    `billing_next_invoice_number()`,
    `billing_settle_invoice(gen_random_uuid(), 'PAID', 1, now(), 'x', '{}'::jsonb, 'ps')`,
    `billing_new_invoice(gen_random_uuid(), now(), '{}'::jsonb)`,
    `billing_entitlements('${H1}', now())`,
    `billing_can_manage('${P}', gen_random_uuid())`,
  ]) {
    await expectError(
      `${role} can't run ${call.split("(")[0]}`,
      () => asRole(role, P, () => q(`SELECT public.${call}`)),
      /permission denied/,
    );
  }
}
for (const call of [
  `billing_my_billing('${H1}')`,
  `billing_household_entitlements('${H1}')`,
  `billing_quote(gen_random_uuid(), 1, 1, ARRAY['${H1}']::uuid[])`,
  `billing_start(gen_random_uuid(), 1, 1, ARRAY['${H1}']::uuid[])`,
]) {
  await expectError(
    `anon can't run ${call.split("(")[0]}`,
    () => asRole("anon", null, () => q(`SELECT public.${call}`)),
    /permission denied/,
  );
}

// --- Plans staff price (016's table, written as the owner here) -------------------------
const newPlan = async (name, interval, base, h, xh, m, xm, homes, xhome, trial, status) =>
  (
    await one(
      `INSERT INTO public.billing_plans
         (name, interval, base_centavos, included_helpers, extra_helper_centavos,
          included_managers, extra_manager_centavos, included_homes, extra_home_centavos,
          trial_days, status, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true) RETURNING id`,
      [name, interval, base, h, xh, m, xm, homes, xhome, trial, status],
    )
  ).id;
const MONTHLY = await newPlan(
  "Household",
  "monthly",
  49900,
  1,
  9900,
  2,
  null,
  null,
  null,
  0,
  "active",
);
const LIFETIME = await newPlan(
  "Lifetime",
  "one_time",
  99900,
  1,
  9900,
  2,
  null,
  1,
  null,
  0,
  "active",
);
const STARTER = await newPlan(
  "Starter",
  "monthly",
  29900,
  2,
  null,
  2,
  null,
  1,
  10000,
  14,
  "active",
);
const BIG = await newPlan(
  "Big house",
  "yearly",
  199900,
  null,
  null,
  null,
  null,
  null,
  null,
  0,
  "active",
);
const DRAFT = await newPlan("Draft", "monthly", 100, 1, null, 1, null, null, null, 0, "draft");

// --- Quotes -----------------------------------------------------------------------------
as(P);
const q1 = await quote(MONTHLY, 3, 2, [H1]);
check(
  "quote: 3 helpers, 2 managers, one home = 49900 + 2 x 9900",
  q1.amount_centavos === 69700 &&
    q1.base_centavos === 49900 &&
    q1.helper_extra_centavos === 19800 &&
    q1.manager_extra_centavos === 0 &&
    q1.home_extra_centavos === 0 &&
    q1.helper_seats === 3 &&
    q1.manager_seats === 2 &&
    q1.home_seats === 1 &&
    q1.interval === "monthly",
  q1,
);
await expectError(
  "quote: a third manager on a plan that sells none raises SEATS_OVER_PLAN:manager",
  () => quote(MONTHLY, 3, 3, [H1]),
  /^SEATS_OVER_PLAN:manager/,
);
await expectError(
  "quote: a helper over a hard cap raises SEATS_OVER_PLAN:helper",
  () => quote(STARTER, 3, 2, [H1]),
  /^SEATS_OVER_PLAN:helper/,
);
await expectError(
  "quote: a second home over a hard cap raises SEATS_OVER_PLAN:home",
  () => quote(LIFETIME, 1, 2, [H1, H4]),
  /^SEATS_OVER_PLAN:home/,
);
const qHomes = await quote(STARTER, 2, 2, [H1, H4, H4]);
check(
  "quote: an extra home is priced, a repeated home counts once",
  qHomes.home_seats === 2 &&
    qHomes.home_extra_centavos === 10000 &&
    qHomes.amount_centavos === 39900,
  qHomes,
);
const qLow = await quote(MONTHLY, 0, null, [H1]);
check(
  "quote: never fewer seats than the plan includes",
  qLow.helper_seats === 1 && qLow.manager_seats === 2 && qLow.amount_centavos === 49900,
  qLow,
);
const qBig = await quote(BIG, 9, 9, [H1]);
check(
  "quote: a plan with unlimited seats gives NULL seats and no extras",
  qBig.helper_seats === null &&
    qBig.manager_seats === null &&
    qBig.amount_centavos === 199900 &&
    qBig.interval === "yearly",
  qBig,
);
await expectError(
  "quote: a draft plan raises PLAN_NOT_ACTIVE",
  () => quote(DRAFT, 1, 1, [H1]),
  /^PLAN_NOT_ACTIVE/,
);
await expectError("quote: no homes raises NOT_FOUND", () => quote(MONTHLY, 1, 1, []), /^NOT_FOUND/);
for (const [label, helpers, managers, pattern] of [
  ["1001 helper seats", 1001, 2, /^BAD_SEATS:helper$/],
  ["-1 helper seats", -1, 2, /^BAD_SEATS:helper$/],
  ["1001 manager seats", 1, 1001, /^BAD_SEATS:manager$/],
  ["-1 manager seats", 1, -1, /^BAD_SEATS:manager$/],
]) {
  await expectError(
    `quote: ${label} raises BAD_SEATS`,
    () => quote(BIG, helpers, managers, [H1]),
    pattern,
  );
}
check(
  "quote: 1000 seats is the most you can ask for",
  (await quote(MONTHLY, 1000, 2, [H1])).helper_seats === 1000,
);
await expectError(
  "quote: the server key (no signed-in user) raises NOT_FOUND",
  () => svcRpc(`public.billing_quote($1, 1, 2, $2::uuid[])`, [MONTHLY, [H1]]),
  /^NOT_FOUND/,
);
await expectError(
  "start: 1001 helper seats raises BAD_SEATS",
  () => start(MONTHLY, 1001, 2, [H1]),
  /^BAD_SEATS:helper$/,
);

// --- Starting -----------------------------------------------------------------------------
as(C);
await expectError(
  "start: a co-manager raises NOT_PRIMARY",
  () => start(MONTHLY, 3, 2, [H1]),
  /^NOT_PRIMARY/,
);
as(M2);
await expectError(
  "start: another household's manager raises NOT_PRIMARY",
  () => start(MONTHLY, 3, 2, [H1]),
  /^NOT_PRIMARY/,
);
as(P);
await expectError(
  "start: one home the caller isn't primary of raises NOT_PRIMARY",
  () => start(MONTHLY, 3, 2, [H1, H2]),
  /^NOT_PRIMARY/,
);
const s1 = await start(MONTHLY, 3, 2, [H1]);
check(
  "start: pending subscription, invoice LIN-<year>-000001, external_id sub_<id>_1",
  s1.status === "pending" &&
    s1.invoice_number === `LIN-${YEAR}-000001` &&
    s1.external_id === `sub_${s1.subscription_id}_1` &&
    s1.amount_centavos === 69700 &&
    typeof s1.invoice_id === "string",
  s1,
);
const s1Row = await subRow(s1.subscription_id);
check(
  "start: the subscription keeps the quote's seats and amount, no period yet",
  s1Row.owner_user_id === P &&
    s1Row.plan_id === MONTHLY &&
    s1Row.helper_seats === 3 &&
    s1Row.manager_seats === 2 &&
    s1Row.home_seats === 1 &&
    Number(s1Row.amount_centavos) === 69700 &&
    s1Row.current_period_start === null &&
    s1Row.current_period_end === null,
  s1Row,
);
const s1Invoice = await one(
  `SELECT status, currency, amount_centavos::int AS amount,
          period_end = period_start + interval '1 month' AS month_long,
          abs(extract(epoch FROM (period_start - now()))) < 120 AS starts_now
   FROM public.billing_invoices WHERE id = $1`,
  [s1.invoice_id],
);
check(
  "start: one pending PHP invoice for this month",
  s1Invoice.status === "pending" &&
    s1Invoice.currency === "PHP" &&
    s1Invoice.amount === 69700 &&
    s1Invoice.month_long &&
    s1Invoice.starts_now,
  s1Invoice,
);
const s1Homes = await q(
  `SELECT household_id FROM public.billing_subscription_homes WHERE subscription_id = $1`,
  [s1.subscription_id],
);
check("start: the home is recorded", s1Homes.length === 1 && s1Homes[0].household_id === H1);
const s1Quote = (await invoiceRow(s1.invoice_id)).quote;
check(
  "start: the invoice keeps the quote it was priced from",
  s1Quote.helper_seats === 3 &&
    s1Quote.manager_seats === 2 &&
    s1Quote.home_seats === 1 &&
    s1Quote.amount_centavos === 69700,
  s1Quote,
);

as(Q);
const s3 = await start(MONTHLY, 3, 2, [H3]);
check(
  "start: the next invoice number is 000002",
  s3.invoice_number === `LIN-${YEAR}-000002`,
  s3.invoice_number,
);

// --- Who reads what: billing_my_billing ------------------------------------------------------
const SAFE_INVOICE_KEYS = [
  "amount_centavos",
  "created_at",
  "currency",
  "expires_at",
  "external_id",
  "id",
  "invoice_number",
  "paid_at",
  "payment_url",
  "period_end",
  "period_start",
  "status",
  "subscription_id",
];
as(P);
const mineP = await myBilling(H1);
check(
  "my billing: the owner sees the subscription and its invoice",
  mineP.subscriptions.length === 1 &&
    mineP.subscriptions[0].id === s1.subscription_id &&
    mineP.subscriptions[0].plan_name === "Household" &&
    mineP.subscriptions[0].interval === "monthly" &&
    mineP.invoices.length === 1 &&
    mineP.invoices[0].id === s1.invoice_id,
  mineP,
);
check(
  "my billing: invoices carry exactly the 13 safe columns",
  JSON.stringify(Object.keys(mineP.invoices[0]).sort()) === JSON.stringify(SAFE_INVOICE_KEYS),
  Object.keys(mineP.invoices[0]),
);
check(
  "my billing: subscriptions carry no note",
  mineP.subscriptions.every((s) => !("note" in s)),
  Object.keys(mineP.subscriptions[0]),
);
check(
  "my billing: a pending subscription covers nothing yet",
  mineP.entitlements.source === "free" && mineP.entitlements.subscription_id === null,
  mineP.entitlements,
);
check(
  "my billing: seats in use count helpers that aren't INACTIVE and every manager",
  mineP.usage.helpers === 2 && mineP.usage.managers === 2,
  mineP.usage,
);
check(
  "my billing: the caller's homes by name, with where they're primary",
  JSON.stringify(mineP.homes) ===
    JSON.stringify([
      { id: H4, name: "Reyes Beach House", primary: true },
      { id: H6, name: "Reyes Farm", primary: true },
      { id: H1, name: "Reyes Household", primary: true },
    ]),
  mineP.homes,
);
check(
  "my billing: only active public plans with a trial are asked about",
  JSON.stringify(Object.keys(mineP.trial_eligible_by_plan)) === JSON.stringify([STARTER]),
  mineP.trial_eligible_by_plan,
);
as(C);
const mineC = await myBilling(H1);
check(
  "my billing: a co-manager of a covered home sees it, not as primary",
  mineC.subscriptions.length === 1 &&
    mineC.invoices.length === 1 &&
    JSON.stringify(mineC.homes) ===
      JSON.stringify([{ id: H1, name: "Reyes Household", primary: false }]) &&
    mineC.trial_eligible_by_plan[STARTER] === false,
  mineC,
);
as(M2);
await expectError(
  "my billing: another household's manager raises NOT_FOUND",
  () => myBilling(H1),
  /^NOT_FOUND/,
);
const mineM2 = await myBilling(H2);
check(
  "my billing: another household's manager sees none of it in their own",
  mineM2.subscriptions.length === 0 && mineM2.invoices.length === 0,
  mineM2,
);
await expectError(
  "entitlements: another household's manager raises NOT_FOUND",
  () => entitlements(H1),
  /^NOT_FOUND/,
);
as(P);
await expectError(
  "nobody inserts a subscription directly",
  () =>
    asMe(() =>
      q(
        `INSERT INTO public.billing_subscriptions (plan_id, owner_user_id, status, amount_centavos) VALUES ($1, $2, 'active', 0)`,
        [MONTHLY, P],
      ),
    ),
  /permission denied/,
);
await expectError(
  "nobody updates an invoice directly",
  () =>
    asMe(() =>
      q(`UPDATE public.billing_invoices SET status = 'paid' WHERE id = $1`, [s1.invoice_id]),
    ),
  /permission denied/,
);
await expectError(
  "nobody deletes a home row directly",
  () =>
    asMe(() =>
      q(`DELETE FROM public.billing_subscription_homes WHERE subscription_id = $1`, [
        s1.subscription_id,
      ]),
    ),
  /permission denied/,
);

// The server key runs the household functions with no auth.uid(): it is nobody's household.
await expectError(
  "server key: billing_my_billing raises NOT_FOUND",
  () => svcRpc(`public.billing_my_billing($1)`, [H1]),
  /^NOT_FOUND/,
);
await expectError(
  "server key: billing_renew raises NOT_FOUND",
  () => svcRpc(`public.billing_renew($1)`, [s1.subscription_id]),
  /^NOT_FOUND/,
);
await expectError(
  "server key: billing_attach_session raises NOT_FOUND",
  () =>
    svc(`SELECT public.billing_attach_session($1, 'ps_svc', $2, now() + interval '1 day', NULL)`, [
      s1.invoice_id,
      XENDIT("ps_svc"),
    ]),
  /^NOT_FOUND/,
);
await expectError(
  "server key: billing_start raises NOT_PRIMARY",
  () => svcRpc(`public.billing_start($1, 1, 2, $2::uuid[])`, [MONTHLY, [H1]]),
  /^NOT_PRIMARY/,
);
check(
  "server key: billing_trial_eligible is false",
  (await svcRpc(`public.billing_trial_eligible($1, $2::uuid[])`, [STARTER, [H5]])) === false,
);
check(
  "server key: and none of that changed anything",
  (await invoiceRow(s1.invoice_id)).xendit_session_id === null &&
    (await one(`SELECT count(*)::int AS n FROM public.billing_subscriptions`)).n === 2,
);

// --- Attaching the Xendit session ---------------------------------------------------------
as(C);
await expectError(
  "attach: a co-manager raises NOT_FOUND",
  () => attach(s1.invoice_id, "ps_1", XENDIT("ps_1")),
  /^NOT_FOUND/,
);
as(P);
for (const url of [
  "https://pay.example/ps_1",
  "http://xen.to/abc",
  "https://xendit.co.evil.com/abc",
  "https://evil.com/?u=checkout.xendit.co/",
  null,
]) {
  await expectError(
    `attach: ${url} raises BAD_URL`,
    () => attach(s1.invoice_id, "ps_1", url),
    /^BAD_URL/,
  );
}
await attach(s1.invoice_id, "ps_0", "HTTPS://XEN.TO/abc");
check(
  "attach: a xen.to link is accepted, in any case",
  (await invoiceRow(s1.invoice_id)).payment_url === "HTTPS://XEN.TO/abc",
);
for (const session of ["   ", null]) {
  await expectError(
    `attach: session id ${JSON.stringify(session)} raises BAD_SESSION`,
    () => attach(s1.invoice_id, session, XENDIT("ps_1")),
    /^BAD_SESSION/,
  );
}
await attach(s1.invoice_id, "  ps_1  ", XENDIT("ps_1"), "ben@example.com");
const attached = await invoiceRow(s1.invoice_id);
check(
  "attach: the primary stores the session id (trimmed), xendit.co URL, expiry and payer email",
  attached.xendit_session_id === "ps_1" &&
    attached.payment_url === XENDIT("ps_1") &&
    attached.expires_at instanceof Date &&
    attached.payer_email === "ben@example.com",
  attached,
);
check(
  "my billing: the payment link shows, the session and payer email don't",
  (await myBilling(H1)).invoices[0].payment_url === XENDIT("ps_1") &&
    !("xendit_session_id" in (await myBilling(H1)).invoices[0]) &&
    !("payer_email" in (await myBilling(H1)).invoices[0]),
);

// --- The webhook ------------------------------------------------------------------------------
const unknown = await pay("sub_nope_1", "PAID", 69700);
check(
  "webhook: an unknown external_id is not applied",
  unknown.applied === false && unknown.invoice_status === null,
  unknown,
);
const paid1 = await pay(s1.external_id, "PAID", 69700);
check(
  "webhook: PAID for the full amount is applied and activates",
  paid1.applied === true &&
    paid1.invoice_status === "paid" &&
    paid1.subscription_status === "active",
  paid1,
);
const active1 = await one(
  `SELECT status, current_period_end = current_period_start + interval '1 month' AS month_long,
          abs(extract(epoch FROM (current_period_start - now()))) < 120 AS starts_now,
          current_period_end AS period_end
   FROM public.billing_subscriptions WHERE id = $1`,
  [s1.subscription_id],
);
check(
  "webhook: the period runs from now to now + 1 month",
  active1.status === "active" && active1.month_long && active1.starts_now,
  active1,
);
const paidInvoice = await invoiceRow(s1.invoice_id);
check(
  "webhook: the invoice records amount, channel, time, the paying session and the callback",
  paidInvoice.status === "paid" &&
    Number(paidInvoice.paid_centavos) === 69700 &&
    paidInvoice.paid_channel === "GCASH" &&
    paidInvoice.paid_at instanceof Date &&
    paidInvoice.xendit_session_id === "ps_webhook" &&
    paidInvoice.raw_callback.event === "payment_session.completed",
  paidInvoice,
);
const beforeRepeat = await snapshot(s1.subscription_id, s1.invoice_id);
const repeat = await pay(s1.external_id, "PAID", 69700);
check(
  "webhook: the same PAID again is not applied",
  repeat.applied === false &&
    repeat.invoice_status === "paid" &&
    repeat.subscription_status === "active",
  repeat,
);
check(
  "webhook: and changes nothing",
  (await snapshot(s1.subscription_id, s1.invoice_id)) === beforeRepeat,
);
const expireAfterPaid = await pay(s1.external_id, "EXPIRED", null);
check(
  "webhook: EXPIRED after PAID is not applied",
  expireAfterPaid.applied === false && expireAfterPaid.invoice_status === "paid",
  expireAfterPaid,
);

// Staff's full view of an invoice (raw_callback and note included).
const detail = await invoiceDetail(s1.invoice_id);
check(
  "invoice detail: staff read the raw callback and the subscription with its note",
  detail.invoice.raw_callback.event === "payment_session.completed" &&
    detail.invoice.payer_email === "ben@example.com" &&
    detail.subscription.id === s1.subscription_id &&
    "note" in detail.subscription,
  detail,
);
await expectError(
  "invoice detail: an unknown invoice is refused in a sentence",
  () => invoiceDetail("30000000-0000-0000-0000-000000000001"),
  /^That invoice doesn't exist\.$/,
);

// --- Renewing ---------------------------------------------------------------------------------
as(C);
await expectError(
  "renew: a co-manager raises NOT_FOUND",
  () => renew(s1.subscription_id),
  /^NOT_FOUND/,
);
as(P);
const r1 = await renew(s1.subscription_id);
check(
  "renew: a new pending invoice, not reused",
  r1.reused === false &&
    r1.invoice_id !== s1.invoice_id &&
    r1.external_id === `sub_${s1.subscription_id}_2` &&
    r1.invoice_number === `LIN-${YEAR}-000003` &&
    r1.amount_centavos === 69700,
  r1,
);
const r1Period = await one(
  `SELECT i.period_start = s.current_period_end AS from_end,
          i.period_end = s.current_period_end + interval '1 month' AS month_long
   FROM public.billing_invoices i JOIN public.billing_subscriptions s ON s.id = i.subscription_id
   WHERE i.id = $1`,
  [r1.invoice_id],
);
check(
  "renew: the invoice covers the month after the current period",
  r1Period.from_end && r1Period.month_long,
  r1Period,
);
const r2 = await renew(s1.subscription_id);
check(
  "renew: again returns the same pending invoice, reused",
  r2.reused === true && r2.invoice_id === r1.invoice_id,
  r2,
);
const paid2 = await pay(r1.external_id, "PAID", 69700);
const extended = await one(
  `SELECT current_period_start = $2::timestamptz AS from_old_end,
          current_period_end = $2::timestamptz + interval '1 month' AS month_long
   FROM public.billing_subscriptions WHERE id = $1`,
  [s1.subscription_id, active1.period_end],
);
check(
  "webhook: paying the renewal moves the period end +1 month from the previous end",
  paid2.applied === true && extended.from_old_end && extended.month_long,
  { paid2, extended },
);

// --- What the webhook acts on -----------------------------------------------------------------
as(P);
const r3 = await renew(s1.subscription_id);
await attach(r3.invoice_id, "xs_r3", XENDIT("xs_r3"));
const ignored = await pay(r3.external_id, "OTHER", null, "xs_r3");
const ignoredNull = await pay(r3.external_id, null, null, "xs_r3");
check(
  "webhook: a status other than PAID, EXPIRED or FAILED (or none) is not applied",
  ignored.applied === false &&
    ignoredNull.applied === false &&
    (await invoiceRow(r3.invoice_id)).status === "pending",
  { ignored, ignoredNull },
);
const stale = await pay(r3.external_id, "EXPIRED", null, "xs_stale");
check(
  "webhook: EXPIRED from another session than the stored one is not applied",
  stale.applied === false && (await invoiceRow(r3.invoice_id)).status === "pending",
  stale,
);
const beforeExpire = await subRow(s1.subscription_id);
const expired = await pay(r3.external_id, "EXPIRED", null, "xs_r3");
const afterExpire = await subRow(s1.subscription_id);
check(
  "webhook: EXPIRED from the stored session expires the invoice and leaves the subscription alone",
  r3.reused === false &&
    expired.applied === true &&
    expired.invoice_status === "expired" &&
    afterExpire.status === "active" &&
    afterExpire.current_period_end.getTime() === beforeExpire.current_period_end.getTime(),
  { r3, expired },
);
const failAfterExpire = await pay(r3.external_id, "FAILED", null, "xs_r3");
check(
  "webhook: FAILED on an expired invoice is not applied",
  failAfterExpire.applied === false && failAfterExpire.invoice_status === "expired",
  failAfterExpire,
);
const r4 = await renew(s1.subscription_id);
const failed = await pay(r4.external_id, "FAILED", null, "xs_any");
check(
  "webhook: FAILED fails an invoice with no stored session",
  r4.reused === false && failed.applied === true && failed.invoice_status === "failed",
  { r4, failed },
);
const beforeLatePay = await subRow(s1.subscription_id);
const latePay = await pay(r4.external_id, "PAID", 69700, "xs_r4");
const lateExtended = await one(
  `SELECT current_period_end = $2::timestamptz + interval '1 month' AS month_long
   FROM public.billing_subscriptions WHERE id = $1`,
  [s1.subscription_id, beforeLatePay.current_period_end],
);
check(
  "webhook: PAID on a failed invoice still settles it and extends the period",
  latePay.applied === true && latePay.invoice_status === "paid" && lateExtended.month_long,
  latePay,
);
const duplicate = await pay(r4.external_id, "PAID", 69700, "xs_r4b");
const dupNote = (await subRow(s1.subscription_id)).note ?? "";
check(
  "webhook: PAID from a second session on a paid invoice is not applied, and noted for a refund",
  duplicate.applied === false &&
    dupNote.includes(
      `Duplicate payment: session xs_r4b paid invoice ${r4.invoice_number} again on `,
    ) &&
    dupNote.endsWith("; refund in Xendit"),
  { duplicate, dupNote },
);
await pay(r4.external_id, "PAID", 69700, "xs_r4b");
const samePaid = await pay(r4.external_id, "PAID", 69700, "xs_r4");
const dupNoteAgain = (await subRow(s1.subscription_id)).note ?? "";
check(
  "webhook: the same duplicate again is noted once, and the paying session again not at all",
  samePaid.applied === false &&
    dupNoteAgain === dupNote &&
    dupNoteAgain.split("Duplicate payment").length === 2,
  dupNoteAgain,
);
check(
  "my billing: the household never sees the refund note",
  !JSON.stringify(await myBilling(H1)).includes("Duplicate payment"),
);

// --- One-time plans ---------------------------------------------------------------------------
as(P);
const s4 = await start(LIFETIME, 1, 2, [H4]);
const s4Invoice = await invoiceRow(s4.invoice_id);
check(
  "one-time: the invoice has no period end",
  s4.status === "pending" && s4Invoice.period_end === null,
  s4,
);
await expectError(
  "one-time: renew raises ONE_TIME_PLAN",
  () => renew(s4.subscription_id),
  /^ONE_TIME_PLAN/,
);

// --- Paid the wrong amount --------------------------------------------------------------------
const under = await pay(s3.external_id, "PAID", 100);
const s3Row = await subRow(s3.subscription_id);
const s3Invoice = await invoiceRow(s3.invoice_id);
check(
  "webhook: PAID 100 on a 69700 invoice records the payment and marks it past due",
  under.applied === true &&
    under.invoice_status === "paid" &&
    under.subscription_status === "past_due" &&
    Number(s3Invoice.paid_centavos) === 100 &&
    s3Row.status === "past_due" &&
    s3Row.note === "Paid ₱1.00 for an invoice of ₱697.00; check in Xendit",
  { under, note: s3Row.note },
);

// --- PAID without an amount (a Payment Session) means as invoiced ----------------------------
const asInvoiced = await pay(s4.external_id, "PAID", null);
const s4Row = await subRow(s4.subscription_id);
const s4Paid = await invoiceRow(s4.invoice_id);
check(
  "webhook: PAID with no amount on a fresh invoice is applied and activates",
  asInvoiced.applied === true &&
    asInvoiced.subscription_status === "active" &&
    Number(s4Paid.paid_centavos) === 99900 &&
    s4Row.current_period_end === null &&
    (await nearNow(s4Row.current_period_start)),
  { asInvoiced, s4Row },
);

// --- Entitlements -----------------------------------------------------------------------------
as(P);
const e1 = await entitlements(H1);
check(
  "entitlements: H1 has its subscription's seats (three paid months)",
  e1.source === "subscription" &&
    e1.subscription_id === s1.subscription_id &&
    e1.plan_name === "Household" &&
    e1.status === "active" &&
    e1.effective_status === "active" &&
    e1.helper_seats === 3 &&
    e1.manager_seats === 2 &&
    e1.days_left >= 85 &&
    e1.days_left <= 95,
  e1,
);
check(
  "my billing: the same entitlements",
  JSON.stringify((await myBilling(H1)).entitlements) === JSON.stringify(e1),
);
const e4 = await entitlements(H4);
check(
  "entitlements: a paid one-time plan has no end",
  e4.source === "subscription" &&
    e4.period_end === null &&
    e4.days_left === null &&
    e4.helper_seats === 1,
  e4,
);
as(C);
check("entitlements: a co-manager reads them", (await entitlements(H1)).source === "subscription");
as(Q);
const e3 = await entitlements(H3);
check(
  "entitlements: an underpaid subscription that never started gives no seats",
  e3.source === "free",
  e3,
);
as(M2);
const e2 = await entitlements(H2);
check(
  "entitlements: no subscription and the free tier on: free, unlimited seats",
  e2.source === "free" &&
    e2.subscription_id === null &&
    e2.helper_seats === null &&
    e2.manager_seats === null,
  e2,
);
await q(`UPDATE public.billing_settings SET free_tier_enabled = false`);
const e2None = await entitlements(H2);
check(
  "entitlements: with the free tier off: none, 0 seats",
  e2None.source === "none" && e2None.helper_seats === 0 && e2None.manager_seats === 0,
  e2None,
);
await q(
  `UPDATE public.billing_settings SET free_tier_enabled = true, free_helper_seats = 2, free_manager_seats = 1`,
);
const e2Seats = await entitlements(H2);
check(
  "entitlements: the free tier's seat numbers",
  e2Seats.source === "free" && e2Seats.helper_seats === 2 && e2Seats.manager_seats === 1,
  e2Seats,
);
await q(`UPDATE public.billing_settings SET free_helper_seats = NULL, free_manager_seats = NULL`);
check(
  "entitlements: the server key (no signed-in user) reads any household's",
  (await svcRpc(`public.billing_household_entitlements($1)`, [H1])).source === "subscription",
);

// A pending subscription that's canceled was never paid for: no seats.
as(Q);
const s3b = await start(MONTHLY, 1, 2, [H3]);
await cancel(s3b.subscription_id);
const e3b = await entitlements(H3);
check(
  "entitlements: a canceled subscription that never started gives no seats",
  e3b.source === "free",
  e3b,
);

// --- Canceling --------------------------------------------------------------------------------
as(C);
await expectError(
  "cancel: a co-manager raises NOT_FOUND",
  () => cancel(s1.subscription_id),
  /^NOT_FOUND/,
);
const beforeCancel = await subRow(s1.subscription_id);
as(P);
await cancel(s1.subscription_id);
const canceled = await subRow(s1.subscription_id);
check(
  "cancel: the primary cancels, the period end is kept",
  canceled.status === "canceled" &&
    canceled.canceled_at instanceof Date &&
    canceled.current_period_end.getTime() === beforeCancel.current_period_end.getTime(),
  canceled,
);
const eCanceled = await entitlements(H1);
check(
  "entitlements: canceled stays entitled until the period ends",
  eCanceled.source === "subscription" &&
    eCanceled.status === "canceled" &&
    eCanceled.effective_status === "canceled" &&
    eCanceled.helper_seats === 3,
  eCanceled,
);

// --- Trials -----------------------------------------------------------------------------------
as(C);
check(
  "trial_eligible: not for a home the caller isn't primary of",
  (await trialEligible(STARTER, [H1])) === false,
);
as(T);
check(
  "trial_eligible: not on a plan without a trial",
  (await trialEligible(MONTHLY, [H5])) === false,
);
check(
  "trial_eligible: a new home and a new buyer get the trial",
  (await trialEligible(STARTER, [H5])) === true,
);
check(
  "my billing: says the same per plan",
  (await myBilling(H5)).trial_eligible_by_plan[STARTER] === true,
);
const s5 = await start(STARTER, 2, 2, [H5]);
const s5Row = await one(
  `SELECT status, current_period_end - current_period_start = interval '14 days' AS two_weeks,
          abs(extract(epoch FROM (current_period_start - now()))) < 120 AS starts_now,
          (SELECT count(*)::int FROM public.billing_invoices WHERE subscription_id = $1) AS invoices
   FROM public.billing_subscriptions WHERE id = $1`,
  [s5.subscription_id],
);
check(
  "trial: trialing for 14 days, no invoice",
  s5.status === "trialing" &&
    s5.invoice_id === null &&
    s5Row.two_weeks &&
    s5Row.starts_now &&
    s5Row.invoices === 0,
  { s5, s5Row },
);
const e5 = await entitlements(H5);
check(
  "entitlements: a trial gives its seats",
  e5.source === "subscription" &&
    e5.status === "trialing" &&
    e5.helper_seats === 2 &&
    e5.days_left === 14,
  e5,
);
check(
  "trial_eligible: not once the home has had a trial",
  (await trialEligible(STARTER, [H5])) === false &&
    (await myBilling(H5)).trial_eligible_by_plan[STARTER] === false,
);
const s6 = await start(STARTER, 2, 2, [H5]);
check(
  "trial: a home that had a subscription gets no second trial",
  s6.status === "pending" && typeof s6.invoice_id === "string",
  s6,
);
as(Q);
check(
  "trial_eligible: unpaid checkouts (pending, canceled before starting, underpaid) don't use it up",
  (await trialEligible(STARTER, [H3])) === true,
);
as(P);
check(
  "trial_eligible: not for a buyer who already owns a subscription that started, even on a new home",
  (await trialEligible(STARTER, [H6])) === false,
);
const sFarm = await start(STARTER, 2, 2, [H6]);
check(
  "trial: billing_start follows billing_trial_eligible (no trial farming through a new household)",
  sFarm.status === "pending" && typeof sFarm.invoice_id === "string",
  sFarm,
);
as(T);
check(
  "trial_eligible: an owner who has had a trial gets none on another home",
  (await trialEligible(STARTER, [H10])) === false,
);
const sTanBeach = await start(STARTER, 2, 2, [H10]);
check(
  "trial: a second start by the same owner, on a new home, is not a trial",
  sTanBeach.status === "pending" && typeof sTanBeach.invoice_id === "string",
  sTanBeach,
);

// The grace week after a period ends, then the free tier.
as(T);
await setEnd(s5.subscription_id, `now() - interval '2 days'`);
const eGrace = await entitlements(H5);
check(
  "entitlements: ended 2 days ago: past due, still entitled",
  eGrace.source === "subscription" &&
    eGrace.effective_status === "past_due" &&
    eGrace.days_left === 0,
  eGrace,
);
await setEnd(s5.subscription_id, `now() - interval '8 days'`);
const eLapsed = await entitlements(H5);
check(
  "entitlements: ended 8 days ago: expired, back to the free tier",
  eLapsed.source === "free" &&
    eLapsed.effective_status === "expired" &&
    eLapsed.subscription_id === s5.subscription_id &&
    eLapsed.helper_seats === null,
  eLapsed,
);
await q(
  `UPDATE public.billing_subscriptions SET status = 'canceled', current_period_end = now() - interval '1 hour' WHERE id = $1`,
  [s5.subscription_id],
);
const eCanceledEnded = await entitlements(H5);
check(
  "entitlements: canceled and ended: expired at once",
  eCanceledEnded.source === "free" && eCanceledEnded.effective_status === "expired",
  eCanceledEnded,
);

// --- Marking an invoice paid by hand -------------------------------------------------------------
// A checkout left open on the invoice staff are about to mark paid.
as(T);
await attach(s6.invoice_id, "xs_s6", XENDIT("xs_s6"));
as(P);
await expectError(
  "mark paid: a household can't run it",
  () =>
    asMe(() =>
      q(`SELECT public.billing_mark_paid($1, $2, 'gcash', 'at the counter', 'x')`, [
        P,
        s6.invoice_id,
      ]),
    ),
  /permission denied/,
);
await expectError(
  "mark paid: without a reason is refused in a sentence",
  () => markPaid(s6.invoice_id, "gcash", "GCash ref 123", "   "),
  /^Give a reason for marking this invoice paid\.$/,
);
const manual = await markPaid(s6.invoice_id, "gcash", "GCash ref 123");
const manualInvoice = await invoiceRow(s6.invoice_id);
check(
  "mark paid: staff activate the subscription, channel manual:gcash",
  manual.applied === true &&
    manual.subscription_status === "active" &&
    manualInvoice.paid_channel === "manual:gcash" &&
    Number(manualInvoice.paid_centavos) === Number(manualInvoice.amount_centavos) &&
    manualInvoice.raw_callback.manual === true &&
    manualInvoice.raw_callback.note === "GCash ref 123" &&
    manualInvoice.raw_callback.by === A1,
  { manual, manualInvoice },
);
const manualAgain = await markPaid(s6.invoice_id, "gcash", "twice");
check("mark paid: again is not applied", manualAgain.applied === false, manualAgain);
await expectError(
  "mark paid: an unknown invoice is refused in a sentence",
  () => markPaid("30000000-0000-0000-0000-000000000002", "gcash", "x"),
  /^That invoice doesn't exist\.$/,
);
// The customer then completes that open checkout too.
const afterManual = await pay(s6.external_id, "PAID", null, "xs_s6");
const afterManualInvoice = await invoiceRow(s6.invoice_id);
const afterManualNote = (await subRow(s6.subscription_id)).note ?? "";
const manilaToday = (
  await one(`SELECT to_char(now() AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS d`)
).d;
check(
  "Xendit confirming the stored session after a manual mark is not applied, noted asking staff to check, its callback kept",
  afterManual.applied === false &&
    afterManualNote ===
      `Xendit confirmed session xs_s6 after invoice ${s6.invoice_number} was marked paid by hand on ${manilaToday}; check Xendit and refund if the hand-marked payment was separate` &&
    afterManualInvoice.raw_callback.manual === true &&
    afterManualInvoice.raw_callback.callback_xs_s6?.event === "payment_session.completed",
  { afterManual, afterManualNote, raw: afterManualInvoice.raw_callback },
);
const confirmedAgain = await pay(s6.external_id, "PAID", null, "xs_s6");
check(
  "the same confirmation again adds no second note",
  confirmedAgain.applied === false &&
    ((await subRow(s6.subscription_id)).note ?? "") === afterManualNote,
  confirmedAgain,
);
const otherAfterManual = await pay(s6.external_id, "PAID", null, "xs_s6_other");
const otherAfterManualNote = (await subRow(s6.subscription_id)).note ?? "";
check(
  "another session paying an invoice marked paid by hand is a duplicate payment to refund",
  otherAfterManual.applied === false &&
    otherAfterManualNote.includes(
      `Duplicate payment: session xs_s6_other paid invoice ${s6.invoice_number} again on `,
    ) &&
    otherAfterManualNote.endsWith("; refund in Xendit"),
  { otherAfterManual, otherAfterManualNote },
);

// H5 now has s5 (canceled, ended an hour ago: expired) and s6 (active). With s6
// two days into its grace week, the later-ending s5 still loses to it.
await setEnd(s6.subscription_id, `now() - interval '2 days'`);
as(T);
const eBest = await entitlements(H5);
check(
  "entitlements: a subscription in its grace week beats a later-ending expired one",
  eBest.source === "subscription" &&
    eBest.subscription_id === s6.subscription_id &&
    eBest.effective_status === "past_due",
  eBest,
);

// --- Comping a household ------------------------------------------------------------------------
const THIRTY_DAYS = `now() + interval '30 days'`;
as(P);
await expectError(
  "grant: a household can't run it",
  () =>
    asMe(() =>
      q(`SELECT public.billing_grant($1, $2, $3, 2, 2, NULL, 'x', 'y')`, [P, H2, MONTHLY]),
    ),
  /permission denied/,
);
await expectError(
  "grant: a household with no primary manager is refused in a sentence",
  () => grant(H7, MONTHLY, 2, 2, THIRTY_DAYS, "pilot", "Pilot household"),
  /^That household has no primary manager to hold the plan\.$/,
);
await expectError(
  "grant: a period end in the past is refused (was BAD_PERIOD)",
  () => grant(H2, MONTHLY, 2, 2, `now() - interval '1 day'`, "late", "Pilot household"),
  /^The end date must be in the future\.$/,
);
await expectError(
  "grant: negative helper seats are refused (was BAD_SEATS:helper)",
  () => grant(H2, MONTHLY, -1, 2, "NULL", "x", "Pilot household"),
  /^Helper seats can't be negative\.$/,
);
await expectError(
  "grant: negative manager seats are refused (was BAD_SEATS:manager)",
  () => grant(H2, MONTHLY, 2, -1, "NULL", "x", "Pilot household"),
  /^Manager seats can't be negative\.$/,
);
await expectError(
  "grant: more than 1000 helper seats are refused",
  () => grant(H2, MONTHLY, 1001, 2, "NULL", "x", "Pilot household"),
  /^Helper seats can be 1000 at most/,
);
await expectError(
  "grant: more than 1000 manager seats are refused",
  () => grant(H2, MONTHLY, 2, 1001, "NULL", "x", "Pilot household"),
  /^Manager seats can be 1000 at most/,
);
await expectError(
  "grant: an unknown plan is refused",
  () => grant(H2, "30000000-0000-0000-0000-000000000003", 2, 2, "NULL", "x", "Pilot household"),
  /^That plan doesn't exist\.$/,
);
await expectError(
  "grant: without a reason is refused",
  () => grant(H2, MONTHLY, 2, 2, THIRTY_DAYS, "pilot", null),
  /^Give a reason for granting this plan\.$/,
);
await expectError(
  "grant: a reason over 300 characters is refused",
  () => grant(H2, MONTHLY, 2, 2, THIRTY_DAYS, "pilot", "x".repeat(301)),
  /^The reason is too long \(300 characters at most\)\.$/,
);
check(
  "grant: refusals left no subscription for H2",
  (
    await one(
      `SELECT count(*)::int AS n FROM public.billing_subscription_homes WHERE household_id = $1`,
      [H2],
    )
  ).n === 0,
);
const granted = await grant(H2, MONTHLY, 2, 2, THIRTY_DAYS, "pilot", "Pilot household");
const grantedSub = await subRow(granted.subscription_id);
const grantedInvoice = await invoiceRow(granted.invoice_id);
check(
  "grant: an active subscription owned by the household's primary, amount 0",
  grantedSub.status === "active" &&
    grantedSub.owner_user_id === M2 &&
    Number(grantedSub.amount_centavos) === 0 &&
    grantedSub.note === "pilot",
  grantedSub,
);
check(
  "grant: a paid invoice of 0 with channel comp",
  grantedInvoice.status === "paid" &&
    Number(grantedInvoice.amount_centavos) === 0 &&
    Number(grantedInvoice.paid_centavos) === 0 &&
    grantedInvoice.paid_channel === "comp" &&
    grantedInvoice.raw_callback.comp === true &&
    grantedInvoice.raw_callback.by === A1,
  grantedInvoice,
);
as(M2);
const eGranted = await entitlements(H2);
check(
  "grant: H2 is entitled through the subscription",
  eGranted.source === "subscription" &&
    eGranted.helper_seats === 2 &&
    eGranted.manager_seats === 2 &&
    eGranted.days_left === 30,
  eGranted,
);

// --- Paying for a new plan replaces the running one ----------------------------------------------
as(Q);
const s3c = await start(MONTHLY, 1, 2, [H3]);
await q(
  `UPDATE public.billing_invoices SET period_start = now() - interval '10 days', period_end = now() - interval '9 days' WHERE id = $1`,
  [s3c.invoice_id],
);
await pay(s3c.external_id, "PAID", 49900, "xs_s3c");
const s3cPeriods = await one(
  `SELECT i.period_start = s.current_period_start AND i.period_end = s.current_period_end AS same
   FROM public.billing_invoices i JOIN public.billing_subscriptions s ON s.id = i.subscription_id
   WHERE i.id = $1`,
  [s3c.invoice_id],
);
check(
  "settling rewrites the invoice's period to the one granted",
  s3cPeriods.same === true,
  s3cPeriods,
);
check(
  "trial_eligible: not once a subscription on the home has started",
  (await trialEligible(STARTER, [H3])) === false,
);
const r3c = await renew(s3c.subscription_id);
const s3d = await start(MONTHLY, 3, 2, [H3]);
await pay(s3d.external_id, "PAID", 69700, "xs_s3d");
const replaced = await one(
  `SELECT status, canceled_at IS NOT NULL AS canceled_at, current_period_end <= now() AS ended, note
   FROM public.billing_subscriptions WHERE id = $1`,
  [s3c.subscription_id],
);
check(
  "paying for a new plan ends the running one on the same home, noted",
  replaced.status === "canceled" &&
    replaced.canceled_at &&
    replaced.ended &&
    replaced.note === `Replaced by ${s3d.subscription_id}`,
  replaced,
);
check(
  "a subscription that never started isn't touched by the replacement",
  (await subRow(s3.subscription_id)).status === "past_due",
);
const s3dRow = await subRow(s3d.subscription_id);
check(
  "settling copies the quoted seats onto the subscription",
  s3dRow.helper_seats === 3 && s3dRow.manager_seats === 2 && s3dRow.home_seats === 1,
  s3dRow,
);
const e3d = await entitlements(H3);
check(
  "entitlements: the new plan is the home's",
  e3d.source === "subscription" && e3d.subscription_id === s3d.subscription_id,
  e3d,
);
const r3cRow = await invoiceRow(r3c.invoice_id);
check(
  "the replaced subscription's pending invoice expires, marked replaced",
  r3c.reused === false &&
    r3cRow.status === "expired" &&
    r3cRow.raw_callback.replaced_by === s3d.subscription_id &&
    r3cRow.raw_callback.note === `Replaced by ${s3d.subscription_id}`,
  r3cRow,
);
const lateOnReplaced = await pay(r3c.external_id, "PAID", 49900, "xs_r3c");
const s3cAfter = await subRow(s3c.subscription_id);
check(
  "paying a replaced plan's invoice is not applied: it stays ended, the new plan stays, a refund is noted",
  lateOnReplaced.applied === false &&
    s3cAfter.status === "canceled" &&
    (await subRow(s3d.subscription_id)).status === "active" &&
    s3cAfter.note.includes(`Late payment: session xs_r3c paid invoice ${r3c.invoice_number} on `) &&
    s3cAfter.note.endsWith("; refund in Xendit") &&
    (await invoiceRow(r3c.invoice_id)).raw_callback.callback_xs_r3c?.event ===
      "payment_session.completed",
  { lateOnReplaced, note: s3cAfter.note },
);

// A subscription that also covers a home the new one doesn't is left alone.
as(S);
const multi = await start(MONTHLY, 1, 2, [H8, H9]);
await pay(multi.external_id, "PAID", 49900, "xs_multi");
const multiBefore = await subRow(multi.subscription_id);
const single = await start(MONTHLY, 1, 2, [H8]);
await pay(single.external_id, "PAID", 49900, "xs_single");
const multiAfter = await subRow(multi.subscription_id);
check(
  "paying a one-home plan doesn't end a subscription that also covers another home",
  multiAfter.status === "active" &&
    multiAfter.current_period_end.getTime() === multiBefore.current_period_end.getTime() &&
    multiAfter.note === null &&
    (await subRow(single.subscription_id)).status === "active",
  multiAfter,
);

// Acting for a 2-home subscription takes being primary of both homes.
const setPrimary = async (household, primary, demoted) => {
  await q(
    `UPDATE public.household_managers SET role = 'co_manager' WHERE household_id = $1 AND user_id = $2`,
    [household, demoted],
  );
  await q(
    `UPDATE public.household_managers SET role = 'primary_manager' WHERE household_id = $1 AND user_id = $2`,
    [household, primary],
  );
};
as(S);
const rMulti = await renew(multi.subscription_id);
check(
  "the primary of both homes renews it",
  rMulti.reused === false && typeof rMulti.invoice_id === "string",
  rMulti,
);
await setPrimary(H9, V, S);
for (const [who, uid] of [
  ["the primary of only the second home", V],
  ["the primary of only the first home", S],
]) {
  as(uid);
  await expectError(`${who} can't renew it`, () => renew(multi.subscription_id), /^NOT_FOUND/);
  await expectError(`${who} can't cancel it`, () => cancel(multi.subscription_id), /^NOT_FOUND/);
}
as(V);
await expectError(
  "the primary of only one home can't attach a payment link to it",
  () => attach(rMulti.invoice_id, "xs_v", XENDIT("xs_v")),
  /^NOT_FOUND/,
);
await setPrimary(H9, S, V);
as(S);
await attach(rMulti.invoice_id, "xs_s", XENDIT("xs_s"));
await cancel(multi.subscription_id);
check(
  "the primary of both homes attaches its payment link and cancels it",
  (await invoiceRow(rMulti.invoice_id)).xendit_session_id === "xs_s" &&
    (await subRow(multi.subscription_id)).status === "canceled",
);

// --- Acting for a subscription after the primary hands over ----------------------------------------
await setPrimary(H3, R, Q);
as(Q);
await expectError(
  "an owner who handed over primary can't renew",
  () => renew(s3d.subscription_id),
  /^NOT_FOUND/,
);
await expectError(
  "an owner who handed over primary can't cancel",
  () => cancel(s3d.subscription_id),
  /^NOT_FOUND/,
);
as(R);
const rR = await renew(s3d.subscription_id);
check(
  "the new primary, not the owner, renews",
  rR.reused === false && typeof rR.invoice_id === "string",
  rR,
);
as(Q);
await expectError(
  "an owner who handed over primary can't attach a payment link",
  () => attach(rR.invoice_id, "xs_q", XENDIT("xs_q")),
  /^NOT_FOUND/,
);
as(R);
await attach(rR.invoice_id, "xs_r", XENDIT("xs_r"), "rico@example.com");
check(
  "the new primary attaches the payment link",
  (await invoiceRow(rR.invoice_id)).payer_email === "rico@example.com",
);
await q(`DELETE FROM public.household_managers WHERE household_id = $1 AND user_id = $2`, [H3, Q]);
as(Q);
await expectError(
  "an owner removed from the household can't renew",
  () => renew(s3d.subscription_id),
  /^NOT_FOUND/,
);
await expectError(
  "an owner removed from the household can't read its billing",
  () => myBilling(H3),
  /^NOT_FOUND/,
);
as(R);
await cancel(s3d.subscription_id);
check("the new primary cancels", (await subRow(s3d.subscription_id)).status === "canceled");

// --- Staff's view of a household ------------------------------------------------------------------
as(P);
const r5 = await renew(s1.subscription_id);
await expectError(
  "household detail: a household can't run it",
  () => asMe(() => q(`SELECT public.billing_household_detail($1, $2, now())`, [P, H1])),
  /permission denied/,
);
const d1 = await householdDetail(H1);
const d1Pending = d1.invoices.filter((i) => i.status === "pending");
check(
  "household detail: H1's entitlements, its latest pending invoice in full, seats in use",
  d1.entitlements.source === "subscription" &&
    d1Pending.length === 1 &&
    d1Pending[0].id === r5.invoice_id &&
    d1Pending[0].invoice_number === r5.invoice_number &&
    d1Pending[0].amount_centavos === 69700 &&
    "raw_callback" in d1Pending[0] &&
    "payer_email" in d1Pending[0] &&
    d1.usage.helpers === 2 &&
    d1.usage.managers === 2 &&
    JSON.stringify(d1.homes) === JSON.stringify([{ id: H1, name: "Reyes Household" }]),
  d1,
);
check(
  "household detail: subscriptions carry their note, plan and homes",
  d1.subscriptions.length === 1 &&
    "note" in d1.subscriptions[0] &&
    d1.subscriptions[0].plan_name === "Household" &&
    JSON.stringify(d1.subscriptions[0].home_ids) === JSON.stringify([H1]),
  d1.subscriptions,
);
const d2 = await householdDetail(H2);
const d3 = await householdDetail(H3);
check(
  "household detail: H2 is comped with no pending invoice",
  d2.entitlements.source === "subscription" &&
    !d2.invoices.some((i) => i.status === "pending") &&
    d2.usage.helpers === 1 &&
    d2.usage.managers === 1 &&
    d2.notes.some((n) => n.note === "pilot"),
  d2,
);
check(
  "household detail: staff see the subscriptions' notes (duplicate payment, underpaid)",
  d1.notes.some((n) => n.note.includes("Duplicate payment")) &&
    d1.notes[0].subscription_id === s1.subscription_id &&
    d3.notes.some((n) => n.note.startsWith("Paid ₱1.00")),
  { H1: d1.notes, H3: d3.notes },
);
const d8 = await householdDetail(H8);
check(
  "household detail: the homes a household's subscriptions cover",
  JSON.stringify(d8.homes) ===
    JSON.stringify([
      { id: H9, name: "Santos Annex" },
      { id: H8, name: "Santos Household" },
    ]),
  d8.homes,
);
const dLater = await householdDetail(H1, `now() + interval '200 days'`);
check(
  "household detail: entitlements are worked out at p_now",
  dLater.entitlements.source === "free" && dLater.entitlements.effective_status === "expired",
  dLater.entitlements,
);
await expectError(
  "household detail: an unknown household is refused in a sentence",
  () => householdDetail("30000000-0000-0000-0000-000000000004"),
  /^That household doesn't exist\.$/,
);

// --- Renewing a comp is priced from its plan ----------------------------------------------------
as(M2);
const rComp = await renew(granted.subscription_id);
check(
  "renewing a comp invoices the plan's price for its seats (49900 + 1 extra helper)",
  rComp.reused === false && rComp.amount_centavos === 59800,
  rComp,
);

// --- Canceling a comp ends it at once ------------------------------------------------------------
await cancel(granted.subscription_id);
const revoked = await one(
  `SELECT status, current_period_end <= now() AS ended FROM public.billing_subscriptions WHERE id = $1`,
  [granted.subscription_id],
);
check(
  "canceling a comp (amount 0): canceled and ended now",
  revoked.status === "canceled" && revoked.ended,
  revoked,
);
check("a canceled comp leaves the free tier", (await entitlements(H2)).source === "free");
as(P);
await cancel(s4.subscription_id);
const paidCanceled = await subRow(s4.subscription_id);
check(
  "canceling a paid subscription keeps its period",
  paidCanceled.status === "canceled" && paidCanceled.current_period_end === null,
  paidCanceled,
);
await expectError(
  "the server key can't cancel through the household function (no household to act for)",
  () => svc(`SELECT public.billing_cancel($1)`, [s4.subscription_id]),
  /^NOT_FOUND/,
);

// --- A comp with unlimited seats renews with concrete ones ---------------------------------------
const openComp = await grant(H2, MONTHLY, null, null, "NULL", "open pilot", "Open-ended pilot");
as(M2);
const rOpen = await renew(openComp.subscription_id);
const rOpenQuote = (await invoiceRow(rOpen.invoice_id)).quote;
check(
  "renewing a comp with NULL seats quotes concrete seats (the plan's included)",
  rOpen.amount_centavos === 49900 &&
    rOpenQuote.helper_seats === 1 &&
    rOpenQuote.manager_seats === 2 &&
    rOpenQuote.home_seats === 1 &&
    rOpenQuote.amount_centavos === 49900,
  rOpenQuote,
);
await pay(rOpen.external_id, "PAID", null, "xs_open");
const openPaid = await subRow(openComp.subscription_id);
check(
  "paying it sets the subscription's seats to the quote's",
  openPaid.status === "active" &&
    openPaid.helper_seats === 1 &&
    openPaid.manager_seats === 2 &&
    Number(openPaid.amount_centavos) === 49900,
  openPaid,
);

// --- Staff revoke a subscription -----------------------------------------------------------------
const farmComp = await grant(H6, MONTHLY, 2, 2, THIRTY_DAYS, "farm pilot", "Farm pilot");
as(P);
check("revoke: the comp covers H6 first", (await entitlements(H6)).source === "subscription");
const rFarm = await renew(farmComp.subscription_id);
for (const role of ["anon", "authenticated"]) {
  await expectError(
    `revoke: ${role} can't run it`,
    () =>
      asRole(role, P, () =>
        q(`SELECT public.billing_revoke($1, $2, 'x')`, [P, farmComp.subscription_id]),
      ),
    /permission denied/,
  );
}
await expectError(
  "revoke: without a reason is refused in a sentence",
  () => revoke(farmComp.subscription_id, "  "),
  /^Give a reason for revoking this plan\.$/,
);
await expectError(
  "revoke: an unknown subscription is refused in a sentence",
  () => revoke("30000000-0000-0000-0000-000000000005", "Pilot ended early"),
  /^That subscription doesn't exist\.$/,
);
check(
  "revoke: refusals changed nothing",
  (await subRow(farmComp.subscription_id)).status === "active" &&
    (await invoiceRow(rFarm.invoice_id)).status === "pending",
);
await revoke(farmComp.subscription_id, "Pilot ended early");
const farmRevoked = await one(
  `SELECT status, canceled_at IS NOT NULL AS canceled, current_period_end <= now() AS ended, note
   FROM public.billing_subscriptions WHERE id = $1`,
  [farmComp.subscription_id],
);
check(
  "revoke: the comp is canceled and ended now, the reason noted",
  farmRevoked.status === "canceled" &&
    farmRevoked.canceled &&
    farmRevoked.ended &&
    farmRevoked.note === "farm pilot\nRevoked by staff: Pilot ended early",
  farmRevoked,
);
const farmRevokedRow = await subRow(farmComp.subscription_id);
check(
  "revoke: revoked_at and revoked_by are set",
  (await nearNow(farmRevokedRow.revoked_at)) && farmRevokedRow.revoked_by === A1,
  farmRevokedRow,
);
check("revoke: H6 falls back to the free tier", (await entitlements(H6)).source === "free");
const rFarmRow = await invoiceRow(rFarm.invoice_id);
check(
  "revoke: its pending renewal invoice expires, marked revoked",
  rFarmRow.status === "expired" && rFarmRow.raw_callback.revoked_by === A1,
  rFarmRow,
);
// The household can't bring it back.
await expectError(
  "revoke: the primary can't renew it (NOT_FOUND:revoked)",
  () => renew(farmComp.subscription_id),
  /^NOT_FOUND:revoked$/,
);
await expectError(
  "revoke: the primary can't cancel it (NOT_FOUND:revoked)",
  () => cancel(farmComp.subscription_id),
  /^NOT_FOUND:revoked$/,
);
await expectError(
  "revoke: the primary can't attach a payment link to its invoice (NOT_FOUND:revoked)",
  () => attach(rFarm.invoice_id, "xs_farm_new", XENDIT("xs_farm_new")),
  /^NOT_FOUND:revoked$/,
);
as(M2);
await expectError(
  "revoke: someone who can't act for it still just gets NOT_FOUND:subscription",
  () => renew(farmComp.subscription_id),
  /^NOT_FOUND:subscription$/,
);
as(P);
const latePayRevoked = await pay(rFarm.external_id, "PAID", null, "xs_farm");
const farmAfter = await subRow(farmComp.subscription_id);
const revokedOn = (
  await one(`SELECT to_char($1::timestamptz AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS d`, [
    farmRevokedRow.revoked_at,
  ])
).d;
const revokedPaidNote = `Paid ${rFarm.invoice_number} after its plan was revoked on ${revokedOn}; refund in Xendit`;
check(
  "revoke: PAID on its old pending invoice is not applied, it stays canceled and revoked, a refund is noted",
  latePayRevoked.applied === false &&
    farmAfter.status === "canceled" &&
    farmAfter.revoked_at !== null &&
    farmAfter.note.endsWith(`\n${revokedPaidNote}`) &&
    (await invoiceRow(rFarm.invoice_id)).raw_callback.revoked_paid_xs_farm?.event ===
      "payment_session.completed" &&
    (await entitlements(H6)).source === "free",
  { latePayRevoked, note: farmAfter.note },
);
await pay(rFarm.external_id, "PAID", null, "xs_farm");
check(
  "revoke: the same PAID again adds no second note",
  (await subRow(farmComp.subscription_id)).note === farmAfter.note,
);
await expectError(
  "revoke: staff can't mark its invoice paid",
  () => markPaid(rFarm.invoice_id, "gcash", "late"),
  /^This invoice's plan was revoked, so it can't be marked paid\. Refund the payment instead\.$/,
);
await expectError(
  "revoke: a second revoke is refused",
  () => revoke(farmComp.subscription_id, "Again"),
  /^That subscription is already revoked\.$/,
);
await setEnd(farmComp.subscription_id, `now() + interval '10 days'`);
const eFarmAhead = await entitlements(H6);
check(
  "revoke: a revoked subscription gives no entitlement even with a period ahead",
  eFarmAhead.source === "free" && eFarmAhead.subscription_id !== farmComp.subscription_id,
  eFarmAhead,
);
await setEnd(farmComp.subscription_id, `now() - interval '1 second'`);
const eFarmOver = await entitlements(H6);
check(
  "revoke: once its period is over, the free tier still doesn't name it (nothing to renew)",
  eFarmOver.source === "free" &&
    eFarmOver.subscription_id === null &&
    (await myBilling(H6)).entitlements.subscription_id === null &&
    (await householdDetail(H6)).entitlements.subscription_id === null,
  eFarmOver,
);
const farmMine = (await myBilling(H6)).subscriptions.find((s) => s.id === farmComp.subscription_id);
check(
  "revoke: the household page still lists it, canceled and revoked (no note)",
  farmMine?.status === "canceled" && farmMine.revoked === true && !("note" in farmMine),
  farmMine,
);
const farmDetail = (await householdDetail(H6)).subscriptions.find(
  (s) => s.id === farmComp.subscription_id,
);
check(
  "revoke: staff see it revoked, with when and by whom",
  farmDetail?.revoked === true && farmDetail.revoked_by === A1 && farmDetail.revoked_at !== null,
  farmDetail,
);
const regrant = await grant(H6, MONTHLY, 2, 2, THIRTY_DAYS, "second pilot", "Pilot restarted");
const eRegrant = await entitlements(H6);
check(
  "revoke: a new grant for the same household works on its own",
  eRegrant.source === "subscription" &&
    eRegrant.subscription_id === regrant.subscription_id &&
    (await subRow(regrant.subscription_id)).revoked_at === null &&
    (await subRow(farmComp.subscription_id)).status === "canceled" &&
    (await myBilling(H6)).subscriptions.find((s) => s.id === regrant.subscription_id)?.revoked ===
      false,
  eRegrant,
);
// The revoked plan ended later than the new grant: the free tier still names the grant.
await setEnd(regrant.subscription_id, `now() - interval '8 days'`);
const eBothOver = await entitlements(H6);
check(
  "revoke: with both over, the free tier names the expired grant, not the revoked plan that ended later",
  eBothOver.source === "free" &&
    eBothOver.subscription_id === regrant.subscription_id &&
    (await myBilling(H6)).entitlements.subscription_id === regrant.subscription_id,
  eBothOver,
);
await setEnd(regrant.subscription_id, THIRTY_DAYS);

// A paid plan with time left ends now too, and every invoice of it not paid is marked.
as(M2);
const rOpen2 = await renew(openComp.subscription_id);
await pay(rOpen2.external_id, "EXPIRED", null, "xs_open_2");
const rOpen3 = await renew(openComp.subscription_id);
await pay(rOpen3.external_id, "FAILED", null, "xs_open_3");
const rOpen4 = await renew(openComp.subscription_id);
check(
  "revoke: before it, the paid plan has an expired, a failed and a pending invoice",
  (await invoiceRow(rOpen2.invoice_id)).status === "expired" &&
    (await invoiceRow(rOpen3.invoice_id)).status === "failed" &&
    (await invoiceRow(rOpen4.invoice_id)).status === "pending",
);
await revoke(openComp.subscription_id, "Chargeback");
const openInvoices = await q(
  `SELECT id, status, raw_callback FROM public.billing_invoices WHERE subscription_id = $1`,
  [openComp.subscription_id],
);
check(
  "revoke: every unpaid invoice (expired, failed, pending) is expired and marked; paid ones are left alone",
  openInvoices.every((i) =>
    [rOpen2.invoice_id, rOpen3.invoice_id, rOpen4.invoice_id].includes(i.id)
      ? i.status === "expired" && i.raw_callback?.revoked_by === A1
      : i.status === "paid" && !("revoked_by" in (i.raw_callback ?? {})),
  ) && openInvoices.length === 5,
  openInvoices,
);
check(
  "revoke: a paid subscription mid-period ends now, back to the free tier",
  (await subRow(openComp.subscription_id)).status === "canceled" &&
    (await entitlements(H2)).source === "free",
);
const failedThenPaid = await pay(rOpen3.external_id, "PAID", null, "xs_open_3");
check(
  "revoke: PAID on an invoice that had failed before the revoke is not applied either",
  failedThenPaid.applied === false &&
    (await subRow(openComp.subscription_id)).status === "canceled" &&
    (await subRow(openComp.subscription_id)).note.includes(
      `Paid ${rOpen3.invoice_number} after its plan was revoked on `,
    ),
  failedThenPaid,
);
const openNoteBefore = (await subRow(openComp.subscription_id)).note;
const retryAfterRevoke = await pay(rOpen.external_id, "PAID", null, "xs_open");
check(
  "revoke: Xendit retrying a payment applied before the revoke is a repeat, not a refund",
  retryAfterRevoke.applied === false &&
    (await subRow(openComp.subscription_id)).note === openNoteBefore,
);
const dupAfterRevoke = await pay(rOpen.external_id, "PAID", null, "xs_open_other");
check(
  "revoke: another session paying an invoice paid before the revoke is a duplicate to refund",
  dupAfterRevoke.applied === false &&
    (await subRow(openComp.subscription_id)).note.includes(
      `Duplicate payment: session xs_open_other paid invoice ${rOpen.invoice_number} again on `,
    ),
);

// --- Deleting the owner's account keeps the revenue record ---------------------------------------
const s6Invoices = async () =>
  (
    await one(`SELECT count(*)::int AS n FROM public.billing_invoices WHERE subscription_id = $1`, [
      s6.subscription_id,
    ])
  ).n;
const invoicesBefore = await s6Invoices();
await q(`DELETE FROM auth.users WHERE id = $1`, [T]);
const orphan = await subRow(s6.subscription_id);
check(
  "deleting the owner's account keeps the subscription, without an owner",
  orphan !== undefined && orphan.owner_user_id === null && orphan.status === "active",
  orphan,
);
check(
  "and its invoices",
  invoicesBefore === 1 && (await s6Invoices()) === invoicesBefore,
  invoicesBefore,
);

// --- An abandoned checkout ends when another plan for its homes is paid ---------------------------
const W = "00000000-0000-0000-0000-0000000000b8"; // primary of H11 and H12
const H11 = "10000000-0000-0000-0000-000000000011";
const H12 = "10000000-0000-0000-0000-000000000012";
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${W}', 'wen@example.com');
  INSERT INTO public.households (id, name) VALUES ('${H11}', 'Uy Household'), ('${H12}', 'Uy Annex');
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES
    ('${H11}', '${W}', 'primary_manager'), ('${H12}', '${W}', 'primary_manager');
`);
as(W);
const abandoned = await start(MONTHLY, 1, 2, [H11]);
await attach(abandoned.invoice_id, "xs_abandoned", XENDIT("xs_abandoned"));
const widerPending = await start(MONTHLY, 1, 2, [H11, H12]);
const chosen = await start(MONTHLY, 3, 2, [H11]);
await pay(chosen.external_id, "PAID", chosen.amount_centavos, "xs_chosen");
const abandonedRow = await subRow(abandoned.subscription_id);
check(
  "paying a plan cancels a checkout for the same home that was never paid, noted",
  abandonedRow.status === "canceled" &&
    abandonedRow.canceled_at !== null &&
    (await nearNow(abandonedRow.canceled_at)) &&
    abandonedRow.current_period_start === null &&
    abandonedRow.current_period_end === null &&
    abandonedRow.note === `Replaced by ${chosen.subscription_id}`,
  abandonedRow,
);
const abandonedInvoice = await invoiceRow(abandoned.invoice_id);
check(
  "and expires its pending invoice, marked replaced",
  abandonedInvoice.status === "expired" &&
    abandonedInvoice.raw_callback.replaced_by === chosen.subscription_id &&
    abandonedInvoice.raw_callback.note === `Replaced by ${chosen.subscription_id}`,
  abandonedInvoice,
);
check(
  "a checkout that also covers a home the paid plan doesn't stays pending",
  (await subRow(widerPending.subscription_id)).status === "pending" &&
    (await invoiceRow(widerPending.invoice_id)).status === "pending",
);
const lateAbandoned = await pay(
  abandoned.external_id,
  "PAID",
  abandoned.amount_centavos,
  "xs_abandoned",
);
const abandonedAfter = await subRow(abandoned.subscription_id);
const eChosen = await entitlements(H11);
check(
  "paying the abandoned checkout later is not applied: the paid plan stays, a refund is noted",
  lateAbandoned.applied === false &&
    abandonedAfter.status === "canceled" &&
    abandonedAfter.note.includes(
      `Late payment: session xs_abandoned paid invoice ${abandoned.invoice_number} on `,
    ) &&
    abandonedAfter.note.endsWith("; refund in Xendit") &&
    (await subRow(chosen.subscription_id)).status === "active" &&
    eChosen.subscription_id === chosen.subscription_id,
  { lateAbandoned, note: abandonedAfter.note, eChosen },
);
const markAbandoned = await markPaid(abandoned.invoice_id, "gcash", "late");
check(
  "nor can staff mark the abandoned checkout's invoice paid",
  markAbandoned.applied === false &&
    (await subRow(abandoned.subscription_id)).status === "canceled" &&
    (await invoiceRow(abandoned.invoice_id)).status === "expired",
  markAbandoned,
);

// --- A renewal replaces nothing -----------------------------------------------------------------
// The wider plan's first payment still replaces the narrower one it covers.
await pay(widerPending.external_id, "PAID", widerPending.amount_centavos, "xs_wider");
check(
  "a first payment of a wider plan replaces the narrower plan it covers",
  (await subRow(chosen.subscription_id)).status === "canceled" &&
    (await subRow(widerPending.subscription_id)).status === "active",
);
as(W);
const narrow = await start(MONTHLY, 1, 2, [H12]);
await pay(narrow.external_id, "PAID", narrow.amount_centavos, "xs_narrow");
const narrowBefore = await subRow(narrow.subscription_id);
const narrowPending = await start(MONTHLY, 2, 2, [H12]);
const rWider = await renew(widerPending.subscription_id);
const widerRenewed = await pay(rWider.external_id, "PAID", rWider.amount_centavos, "xs_wider_2");
const narrowAfter = await subRow(narrow.subscription_id);
check(
  "renewing a wider plan doesn't end a narrower one mid-period",
  widerRenewed.applied === true &&
    narrowBefore.status === "active" &&
    narrowAfter.status === "active" &&
    narrowAfter.canceled_at === null &&
    narrowAfter.note === null &&
    narrowAfter.current_period_end.getTime() === narrowBefore.current_period_end.getTime(),
  narrowAfter,
);
check(
  "nor cancel a checkout for its homes",
  (await subRow(narrowPending.subscription_id)).status === "pending" &&
    (await invoiceRow(narrowPending.invoice_id)).status === "pending",
);

// --- A trial is the plan as it comes --------------------------------------------------------------
const X = "00000000-0000-0000-0000-0000000000b9"; // primary of H13 and H14
const Y = "00000000-0000-0000-0000-0000000000ba"; // primary of H15, later hands over
const Z = "00000000-0000-0000-0000-0000000000bb"; // co-manager of H15, later its primary
const H13 = "10000000-0000-0000-0000-000000000013";
const H14 = "10000000-0000-0000-0000-000000000014";
const H15 = "10000000-0000-0000-0000-000000000015";
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES
    ('${X}', 'xian@example.com'), ('${Y}', 'yna@example.com'), ('${Z}', 'zed@example.com');
  INSERT INTO public.households (id, name) VALUES
    ('${H13}', 'Go Household'), ('${H14}', 'Go Annex'), ('${H15}', 'Ong Household');
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES
    ('${H13}', '${X}', 'primary_manager'), ('${H14}', '${X}', 'primary_manager'),
    ('${H15}', '${Y}', 'primary_manager'), ('${H15}', '${Z}', 'co_manager');
`);
const TRY = (
  await one(
    `INSERT INTO public.billing_plans
       (name, interval, base_centavos, included_helpers, extra_helper_centavos,
        included_managers, extra_manager_centavos, included_homes, extra_home_centavos,
        trial_days, status, is_public)
     VALUES ('Try it', 'monthly', 19900, 1, 5000, 1, 5000, 1, 10000, 7, 'active', false)
     RETURNING id`,
  )
).id;
as(X);
await expectError(
  "trial: 1001 helper seats raises BAD_SEATS",
  () => start(TRY, 1001, 1, [H13]),
  /^BAD_SEATS:helper$/,
);
await expectError(
  "trial: -1 manager seats raises BAD_SEATS",
  () => start(TRY, 1, -1, [H13]),
  /^BAD_SEATS:manager$/,
);
await expectError(
  "trial: more homes than the plan includes raises SEATS_OVER_PLAN:home (extra homes aren't free)",
  () => start(TRY, 1, 1, [H13, H14]),
  /^SEATS_OVER_PLAN:home$/,
);
check(
  "trial: the refusals started nothing",
  (
    await one(
      `SELECT count(*)::int AS n FROM public.billing_subscriptions WHERE owner_user_id = $1`,
      [X],
    )
  ).n === 0,
);
const tTry = await start(TRY, 5, 3, [H13]);
const tTryRow = await subRow(tTry.subscription_id);
check(
  "trial: 5 helpers and 3 managers asked for, the plan's included 1 and 1 given, at the base price",
  tTry.status === "trialing" &&
    tTry.invoice_id === null &&
    tTryRow.helper_seats === 1 &&
    tTryRow.manager_seats === 1 &&
    tTryRow.home_seats === 1 &&
    Number(tTryRow.amount_centavos) === 19900,
  tTryRow,
);
const eTry = await entitlements(H13);
check(
  "trial: the household gets the included seats only",
  eTry.status === "trialing" && eTry.helper_seats === 1 && eTry.manager_seats === 1,
  eTry,
);
const paidTry = await start(TRY, 5, 3, [H13]);
const paidTryRow = await subRow(paidTry.subscription_id);
check(
  "trial: a paid checkout of the same plan keeps the seats asked for, priced",
  paidTry.status === "pending" &&
    paidTryRow.helper_seats === 5 &&
    paidTryRow.manager_seats === 3 &&
    Number(paidTryRow.amount_centavos) === 19900 + 4 * 5000 + 2 * 5000,
  paidTryRow,
);

// --- A first payment from a buyer who has since handed over replaces nothing --------------------
as(Y);
const ongRunning = await start(MONTHLY, 1, 2, [H15]);
await pay(ongRunning.external_id, "PAID", null, "xs_ong_1");
const ongStale = await start(MONTHLY, 3, 2, [H15]);
await attach(ongStale.invoice_id, "xs_ong_2", XENDIT("xs_ong_2"));
await setPrimary(H15, Z, Y);
const stalePaid = await pay(ongStale.external_id, "PAID", null, "xs_ong_2");
const ongRunningAfter = await subRow(ongRunning.subscription_id);
const ongStaleAfter = await subRow(ongStale.subscription_id);
check(
  "stale buyer: the payment is still applied and activates (the money was received)",
  stalePaid.applied === true &&
    stalePaid.subscription_status === "active" &&
    ongStaleAfter.helper_seats === 3,
  { stalePaid, ongStaleAfter },
);
check(
  "stale buyer: the household's running plan is not replaced",
  ongRunningAfter.status === "active" &&
    ongRunningAfter.canceled_at === null &&
    ongRunningAfter.note === null,
  ongRunningAfter,
);
check(
  "stale buyer: a note asks staff to check with the household (and shows as needing attention)",
  ongStaleAfter.note ===
    `Paid after the buyer stopped managing ${H15}; check with the household, and refund in Xendit if the plan wasn't wanted` &&
    (await householdDetail(H15)).notes.some(
      (n) => n.subscription_id === ongStale.subscription_id && /refund/i.test(n.note),
    ),
  ongStaleAfter.note,
);

// --- LINARA's seat-limit trigger reads any household's entitlements -------------------------------
// Stands in for add-seat-limits.sql: a SECURITY DEFINER trigger asking for the
// household being written to, whoever writes.
await db.exec(`
  CREATE TABLE public.test_seat_probe (household_id UUID NOT NULL, seen JSONB);
  CREATE FUNCTION public.test_seat_probe_fill() RETURNS TRIGGER
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
  BEGIN
      NEW.seen := public.billing_household_entitlements(NEW.household_id);
      RETURN NEW;
  END $$;
  CREATE TRIGGER test_seat_probe_fill BEFORE INSERT ON public.test_seat_probe
      FOR EACH ROW EXECUTE FUNCTION public.test_seat_probe_fill();
  GRANT INSERT ON public.test_seat_probe TO authenticated;
`);
as(M2);
const probeError = await asMe(() =>
  q(`INSERT INTO public.test_seat_probe (household_id) VALUES ($1)`, [H11]),
).then(
  () => null,
  (e) => e.message,
);
const probe = await one(`SELECT seen FROM public.test_seat_probe WHERE household_id = $1`, [H11]);
check(
  "inside a trigger, a non-manager's write still reads the household's entitlements",
  probeError === null &&
    probe?.seen.source === "subscription" &&
    probe.seen.subscription_id === widerPending.subscription_id,
  probeError ?? probe,
);
await expectError(
  "outside a trigger the same caller still gets NOT_FOUND",
  () => entitlements(H11),
  /^NOT_FOUND/,
);

// --- Audit --------------------------------------------------------------------------------------
const log = await q(
  `SELECT action, actor_user_id, target_type, target_id, reason, metadata
   FROM public.staff_audit_log WHERE action LIKE 'billing.%' ORDER BY id`,
);
const grants = log.filter((a) => a.action === "billing.granted");
const marks = log.filter((a) => a.action === "billing.marked_paid");
const revokes = log.filter((a) => a.action === "billing.revoked");
check(
  "only the four grants, the one applied mark and the two revokes were audited (refusals and repeats weren't)",
  log.length === 7 && grants.length === 4 && marks.length === 1 && revokes.length === 2,
  log,
);
check(
  "a revoke's audit row names the subscription and plan, with the reason",
  revokes[0].actor_user_id === A1 &&
    revokes[0].target_type === "subscription" &&
    revokes[0].target_id === farmComp.subscription_id &&
    revokes[0].reason === "Pilot ended early" &&
    JSON.stringify(revokes[0].metadata) ===
      JSON.stringify({ plan_id: MONTHLY, subscription_id: farmComp.subscription_id }),
  revokes[0],
);
check(
  "a grant's audit row names the household, plan, subscription and invoice, with the reason",
  grants[0].actor_user_id === A1 &&
    grants[0].target_type === "household" &&
    grants[0].target_id === H2 &&
    grants[0].reason === "Pilot household" &&
    JSON.stringify(grants[0].metadata) ===
      JSON.stringify({
        plan_id: MONTHLY,
        invoice_id: granted.invoice_id,
        household_id: H2,
        subscription_id: granted.subscription_id,
      }),
  grants[0],
);
check(
  "a mark's audit row names the invoice and subscription, with the reason",
  marks[0].actor_user_id === A1 &&
    marks[0].target_type === "invoice" &&
    marks[0].target_id === s6.invoice_id &&
    marks[0].reason === "Paid by GCash to the owner" &&
    marks[0].metadata.invoice_id === s6.invoice_id &&
    marks[0].metadata.subscription_id === s6.subscription_id &&
    Object.keys(marks[0].metadata).length === 2,
  marks[0],
);
check(
  "no audit row carries an amount or a seat count",
  !log.some((a) => /centavos|price|amount|seats|base|₱/.test(JSON.stringify(a.metadata))),
  log.map((a) => a.metadata),
);

// --- A household's cancel closes its unpaid invoices ------------------------------------------
const WEN = "00000000-0000-0000-0000-0000000000bc"; // primary of H16
const H16 = "10000000-0000-0000-0000-000000000016";
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${WEN}', 'wendy@example.com');
  INSERT INTO public.households (id, name) VALUES ('${H16}', 'Wendy Household');
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES
    ('${H16}', '${WEN}', 'primary_manager');
`);
as(WEN);
const sWen = await start(MONTHLY, 1, 2, [H16]);
await attach(sWen.invoice_id, "xs_wen", XENDIT("xs_wen"));
await pay(sWen.external_id, "PAID", null, "xs_wen");
const rWen = await renew(sWen.subscription_id);
await attach(rWen.invoice_id, "xs_wen_2", XENDIT("xs_wen_2"));
await cancel(sWen.subscription_id);
const wenCanceled = await subRow(sWen.subscription_id);
const wenRenewal = await invoiceRow(rWen.invoice_id);
check(
  "cancel: its pending invoice expires, marked canceled by the household, with when",
  wenRenewal.status === "expired" &&
    wenRenewal.raw_callback.canceled_by === WEN &&
    (await nearNow(wenRenewal.raw_callback.canceled_at)),
  wenRenewal,
);
check(
  "cancel: the paid invoice is left alone",
  (await invoiceRow(sWen.invoice_id)).status === "paid" &&
    !("canceled_by" in ((await invoiceRow(sWen.invoice_id)).raw_callback ?? {})),
);
check(
  "cancel: the household's own page shows the invoice expired",
  (await myBilling(H16)).invoices.find((i) => i.id === rWen.invoice_id)?.status === "expired",
);
const wenCanceledOn = (
  await one(`SELECT to_char($1::timestamptz AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD') AS d`, [
    wenCanceled.canceled_at,
  ])
).d;
const wenLateNote = `Paid ${rWen.invoice_number} after the household canceled it on ${wenCanceledOn}; refund in Xendit`;
const wenLate = await pay(rWen.external_id, "PAID", null, "xs_wen_2");
const wenAfter = await subRow(sWen.subscription_id);
check(
  "cancel: a PAID for the canceled invoice is not applied; the plan stays canceled, a refund is noted",
  wenLate.applied === false &&
    wenAfter.status === "canceled" &&
    wenAfter.current_period_end.getTime() === wenCanceled.current_period_end.getTime() &&
    wenAfter.note === wenLateNote &&
    (await invoiceRow(rWen.invoice_id)).status === "expired" &&
    (await invoiceRow(rWen.invoice_id)).raw_callback.canceled_paid_xs_wen_2?.event ===
      "payment_session.completed",
  { wenLate, note: wenAfter.note },
);
await pay(rWen.external_id, "PAID", null, "xs_wen_2");
check(
  "cancel: the same PAID again adds no second note",
  (await subRow(sWen.subscription_id)).note === wenLateNote,
);
await pay(rWen.external_id, "PAID", null, "xs_wen_3");
check(
  "cancel: another session paying it is noted again, for its own refund",
  (await subRow(sWen.subscription_id)).note === `${wenLateNote}\n${wenLateNote}` &&
    "canceled_paid_xs_wen_3" in (await invoiceRow(rWen.invoice_id)).raw_callback,
);
const wenExpired = await pay(rWen.external_id, "EXPIRED", null, "xs_wen_2");
check("cancel: a late EXPIRED for it changes nothing", wenExpired.applied === false);
await expectError(
  "cancel: staff can't mark the canceled invoice paid",
  () => markPaid(rWen.invoice_id, "gcash", "late"),
  /^The household canceled this plan before paying this invoice, so it can't be marked paid\. Refund the payment instead\.$/,
);
check(
  "cancel: the refused mark changed nothing",
  (await subRow(sWen.subscription_id)).status === "canceled" &&
    (await invoiceRow(rWen.invoice_id)).status === "expired",
);
const wenResume = await renew(sWen.subscription_id);
check(
  "cancel: renewing afterwards makes a new invoice, not the canceled one",
  wenResume.reused === false &&
    wenResume.invoice_id !== rWen.invoice_id &&
    (await invoiceRow(wenResume.invoice_id)).status === "pending",
  wenResume,
);

// --- A plan with subscribers keeps its interval ------------------------------------------------
const savePlan = (doc) =>
  svcRpc(`public.billing_save_plan($1, $2::jsonb)`, [A1, JSON.stringify(doc)]);
const planRow = (planId) => one(`SELECT * FROM public.billing_plans WHERE id = $1`, [planId]);
const monthlyDoc = (
  await one(`SELECT to_jsonb(p) AS j FROM public.billing_plans p WHERE id = $1`, [MONTHLY])
).j;
await expectError(
  "plans: a plan with subscribers can't change how often it bills",
  () => savePlan({ ...monthlyDoc, interval: "yearly" }),
  /^This plan has subscribers; make a new plan to change how often it bills\.$/,
);
check("plans: the refused save changed nothing", (await planRow(MONTHLY)).interval === "monthly");
check(
  "plans: a plan with subscribers still takes other edits at the same interval",
  (await savePlan({ ...monthlyDoc, tagline: "For one home" })) === MONTHLY &&
    (await planRow(MONTHLY)).tagline === "For one home",
);
const unsold = await savePlan({ name: "Unsold", interval: "monthly" });
check(
  "plans: a plan nobody has subscribed to can change its interval",
  (await savePlan({ id: unsold, name: "Unsold", interval: "yearly" })) === unsold &&
    (await planRow(unsold)).interval === "yearly",
);
await db.exec(readFileSync(resolve(REPO, "016-billing-plans.sql"), "utf8"));
await expectError(
  "plans: 016 applied again after 017 still refuses the interval change",
  () => savePlan({ ...monthlyDoc, interval: "one_time" }),
  /^This plan has subscribers; make a new plan to change how often it bills\.$/,
);

// --- Applying the file again -------------------------------------------------------------------
const state = async () =>
  JSON.stringify(
    await one(
      `SELECT (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.billing_subscriptions s) AS subs,
              (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.subscription_id, h.household_id)
                 FROM public.billing_subscription_homes h) AS homes,
              (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.billing_invoices i) AS invoices,
              (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.year) FROM public.billing_invoice_counters c) AS counters,
              (SELECT count(*) FROM public.staff_audit_log) AS audit`,
    ),
  );
const first = await state();
await db.exec(readFileSync(resolve(REPO, "017-billing-subscriptions.sql"), "utf8"));
check(
  "a third apply leaves subscriptions, invoices and the audit log untouched",
  (await state()) === first,
);
as(P);
check(
  "a third apply keeps the household functions open to managers",
  (await myBilling(H1)).subscriptions.length === 1,
);
await expectError(
  "a third apply keeps staff functions closed to authenticated",
  () => asMe(() => q(`SELECT public.billing_invoice_detail($1, $2)`, [P, s1.invoice_id])),
  /permission denied/,
);
await expectError(
  "a third apply keeps the tables closed",
  () => asMe(() => q(`SELECT * FROM public.billing_invoices`)),
  /permission denied/,
);

// --- Upgrading a database that ran the version before revoked_at -------------------------------
// billing_subscriptions as fix round 1 (8cb4b45) created it, with a row, then this file over it.
const old = new PGlite();
for (const file of SQL_FILES.slice(0, -1)) {
  await old.exec(readFileSync(resolve(REPO, file), "utf8"));
}
await old.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${P}', 'ben@example.com');
  INSERT INTO public.households (id, name) VALUES ('${H1}', 'Reyes Household');
  INSERT INTO public.household_managers (household_id, user_id, role)
    VALUES ('${H1}', '${P}', 'primary_manager');
  INSERT INTO public.billing_plans (id, name, interval, base_centavos, status)
    VALUES ('${MONTHLY}', 'Household', 'monthly', 49900, 'active');
  CREATE TABLE public.billing_subscriptions (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      plan_id              UUID NOT NULL REFERENCES public.billing_plans(id),
      owner_user_id        UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
      status               TEXT NOT NULL
                           CHECK (status IN ('pending', 'trialing', 'active', 'past_due',
                                             'expired', 'canceled')),
      helper_seats         INT NULL CHECK (helper_seats >= 0),
      manager_seats        INT NULL CHECK (manager_seats >= 0),
      home_seats           INT NOT NULL DEFAULT 1 CHECK (home_seats >= 1),
      amount_centavos      BIGINT NOT NULL CHECK (amount_centavos >= 0),
      current_period_start TIMESTAMPTZ NULL,
      current_period_end   TIMESTAMPTZ NULL,
      canceled_at          TIMESTAMPTZ NULL,
      note                 TEXT NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  INSERT INTO public.billing_subscriptions
      (id, plan_id, owner_user_id, status, amount_centavos, current_period_start, current_period_end)
    VALUES ('${s1.subscription_id}', '${MONTHLY}', '${P}', 'active', 49900, now(),
            now() + interval '1 month');
`);
await old.exec(readFileSync(resolve(REPO, "017-billing-subscriptions.sql"), "utf8"));
await old.exec(readFileSync(resolve(REPO, "017-billing-subscriptions.sql"), "utf8"));
const upgraded = (
  await old.query(
    `SELECT (SELECT count(*)::int FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'billing_subscriptions'
               AND column_name IN ('revoked_at', 'revoked_by')) AS columns,
            s.status, s.revoked_at, s.revoked_by
     FROM public.billing_subscriptions s WHERE s.id = $1`,
    [s1.subscription_id],
  )
).rows[0];
check(
  "upgrade: the file applies (twice) over the earlier table, adding revoked_at and revoked_by",
  upgraded.columns === 2 &&
    upgraded.status === "active" &&
    upgraded.revoked_at === null &&
    upgraded.revoked_by === null,
  upgraded,
);
await old.exec(
  `INSERT INTO public.billing_subscription_homes VALUES ('${s1.subscription_id}', '${H1}')`,
);
await old.exec("SET ROLE service_role");
await old.query(`SELECT public.billing_revoke($1, $2, 'Upgrade check')`, [A1, s1.subscription_id]);
await old.exec("RESET ROLE");
await old.query("SELECT set_config('test.uid', $1, false)", [P]);
await old.exec("SET ROLE authenticated");
const upgradedRenew = await old.query(`SELECT public.billing_renew($1)`, [s1.subscription_id]).then(
  () => "no error",
  (e) => e.message,
);
await old.exec("RESET ROLE");
check(
  "upgrade: a subscription that existed before the upgrade can be revoked, and then stays revoked",
  upgradedRenew === "NOT_FOUND:revoked",
  upgradedRenew,
);

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
