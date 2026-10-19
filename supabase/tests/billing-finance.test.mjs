// Runs 018-billing-finance.sql against a real Postgres (PGlite): the three
// tables are closed to the app roles, the AI edge functions (service_role)
// record a priced call, the staff functions are the server key's only, finance
// adds paid invoices, costs and AI spend into revenue, cost of goods and profit
// per user (Manila day boundaries, a ₱0 comp isn't paying), staff writes are
// validated and audited with ids only, and applying the file again leaves the
// data alone. Ported from LINARA 594daf6 supabase/tests/costs-and-ai-usage.test.mjs.
//
//   node supabase/tests/billing-finance.test.mjs
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
/** The server key: the console's server and LINARA's edge functions. */
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
  "018-billing-finance.sql",
];
for (const file of SQL_FILES) {
  await db.exec(readFileSync(resolve(REPO, file), "utf8"));
}
await db.exec(readFileSync(resolve(REPO, "018-billing-finance.sql"), "utf8"));
check("018 applies twice", true);

const A1 = "00000000-0000-0000-0000-000000000900"; // console staff member
const P = "00000000-0000-0000-0000-00000000000a"; // primary of H1
const C = "00000000-0000-0000-0000-00000000000c"; // co-manager of H1
const M2 = "00000000-0000-0000-0000-0000000000b2"; // primary of H2, comped
const H1 = "10000000-0000-0000-0000-000000000001";
const H2 = "10000000-0000-0000-0000-000000000002";

await db.exec(`
  INSERT INTO auth.users (id, email) VALUES
    ('${A1}', 'staff@example.com'), ('${P}', 'ben@example.com'),
    ('${C}', 'carla@example.com'), ('${M2}', 'ana@example.com');
  INSERT INTO public.households (id, name) VALUES
    ('${H1}', 'Reyes Household'), ('${H2}', 'Cruz Household');
  INSERT INTO public.user_profiles (id, household_id, full_name, user_type) VALUES
    ('${P}', '${H1}', 'Ben Reyes', 'primary_manager'),
    ('${C}', '${H1}', 'Carla Reyes', 'co_manager'),
    ('${M2}', '${H2}', 'Ana Cruz', 'primary_manager');
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES
    ('${H1}', '${P}', 'primary_manager'), ('${H1}', '${C}', 'co_manager'),
    ('${H2}', '${M2}', 'primary_manager');
`);

const TABLES = ["billing_cost_entries", "billing_model_prices", "billing_ai_usage"];
const finance = (from, to) =>
  svcRpc(`public.billing_finance($1, $2::date, $3::date, now())`, [A1, from, to]);
const saveCost = (cost) =>
  svcRpc(`public.billing_save_cost($1, $2::jsonb)`, [A1, JSON.stringify(cost)]);
const auditRows = () =>
  q(`SELECT action, target_type, target_id, metadata FROM public.staff_audit_log
     WHERE action LIKE 'finance.%' ORDER BY id`);

// --- The tables are closed ------------------------------------------------------
for (const role of ["anon", "authenticated"]) {
  for (const table of TABLES) {
    await expectError(
      `${role} can't read ${table}`,
      () => asRole(role, P, () => q(`SELECT * FROM public.${table}`)),
      /permission denied/,
    );
    await expectError(
      `${role} can't write ${table}`,
      () =>
        asRole(role, P, () =>
          q(
            table === "billing_cost_entries"
              ? `INSERT INTO public.${table} (month, category, label, amount_centavos) VALUES ('2026-10-01', 'infra', 'x', 1)`
              : table === "billing_model_prices"
                ? `INSERT INTO public.${table} (model) VALUES ('x')`
                : `INSERT INTO public.${table} (fn, model) VALUES ('x', 'y')`,
          ),
        ),
      /permission denied/,
    );
  }
}
const rls = await q(
  `SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY ($1::text[]) ORDER BY relname`,
  [TABLES],
);
check(
  "row level security is on for all three tables",
  rls.length === 3 && rls.every((r) => r.relrowsecurity),
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
await expectError(
  "nobody can touch the usage sequence",
  () => asRole("authenticated", P, () => q(`SELECT nextval('public.billing_ai_usage_id_seq')`)),
  /permission denied/,
);

// --- Function privileges --------------------------------------------------------
const FNS = [
  "public.billing_price_ai_call(text, int, int, numeric)",
  "public.billing_record_ai_usage(uuid, uuid, text, text, int, int, numeric)",
  "public.billing_finance(uuid, date, date, timestamptz)",
  "public.billing_list_costs(uuid, date, date)",
  "public.billing_save_cost(uuid, jsonb)",
  "public.billing_delete_cost(uuid, uuid)",
  "public.billing_list_model_prices(uuid)",
  "public.billing_save_model_price(uuid, jsonb)",
];
const privileges = await Promise.all(
  FNS.map((fn) =>
    one(
      `SELECT $1 AS fn, has_function_privilege('anon', $1, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated,
              has_function_privilege('service_role', $1, 'EXECUTE') AS service`,
      [fn],
    ),
  ),
);
check(
  "only service_role executes 018's functions",
  privileges.every((p) => !p.anon && !p.authenticated && p.service),
  privileges,
);
for (const role of ["anon", "authenticated"]) {
  for (const call of [
    `billing_price_ai_call('gpt-4o-mini', 1, 1, 0)`,
    `billing_record_ai_usage('${P}', '${H1}', 'scheduler', 'gpt-4o-mini', 1, 1, 0)`,
    `billing_finance('${A1}', '2026-10-01', '2026-10-31', now())`,
    `billing_list_costs('${A1}', '2026-10-01', '2026-10-31')`,
    `billing_save_cost('${A1}', '{}'::jsonb)`,
    `billing_delete_cost('${A1}', gen_random_uuid())`,
    `billing_list_model_prices('${A1}')`,
    `billing_save_model_price('${A1}', '{"model":"x"}'::jsonb)`,
  ]) {
    await expectError(
      `${role} can't run ${call.split("(")[0]}`,
      () => asRole(role, P, () => q(`SELECT public.${call}`)),
      /permission denied/,
    );
  }
}

// --- Seeded prices --------------------------------------------------------------
const prices = await svcRpc(`public.billing_list_model_prices($1)`, [A1]);
check(
  "prices: gpt-4o, gpt-4o-mini and whisper-1 are seeded",
  JSON.stringify(
    prices.map((p) => [
      p.model,
      p.input_centavos_per_1m,
      p.output_centavos_per_1m,
      p.audio_centavos_per_minute,
    ]),
  ) ===
    JSON.stringify([
      ["gpt-4o", 14000, 56000, 0],
      ["gpt-4o-mini", 840, 3360, 0],
      ["whisper-1", 0, 0, 34],
    ]),
  prices,
);

// --- Pricing and recording an AI call -------------------------------------------
const priced = await svcRpc(`public.billing_price_ai_call('gpt-4o-mini', 1000, 500, 0)`);
check("price: 1000 in / 500 out on gpt-4o-mini is 3 centavos", Number(priced) === 3, priced);
const whisper = await svcRpc(`public.billing_price_ai_call('whisper-1', 0, 0, 90)`);
check("price: 90s of whisper-1 is 51 centavos", Number(whisper) === 51, whisper);
const unknownModel = await svcRpc(`public.billing_price_ai_call('mystery', 5000, 5000, 60)`);
check("price: an unknown model costs 0", Number(unknownModel) === 0, unknownModel);

const recorded = await svcRpc(
  `public.billing_record_ai_usage($1, $2, 'scheduler', 'gpt-4o-mini', 1000, 500, 0)`,
  [P, H1],
);
check("usage: service_role records the call and gets the cost", Number(recorded) === 3, recorded);
const fromProfile = await svcRpc(
  `public.billing_record_ai_usage($1, NULL, 'sop', 'unknown-model', 10, 10, 0)`,
  [P],
);
const looked = await one(`SELECT household_id FROM public.billing_ai_usage WHERE fn = 'sop'`);
check(
  "usage: a NULL household is looked up from the user's profile, unknown model costs 0",
  Number(fromProfile) === 0 && looked.household_id === H1,
  { fromProfile, looked },
);
await db.exec(`DELETE FROM public.billing_ai_usage WHERE fn = 'sop'`);
await expectError(
  "usage: a negative token count is rejected",
  () => svc(`SELECT public.billing_record_ai_usage($1, $2, 'x', 'gpt-4o', -1, 0, 0)`, [P, H1]),
  /check constraint/,
);
// Put the call in October so the range below is stable whatever day this runs.
await db.exec(`UPDATE public.billing_ai_usage SET at = '2026-10-10 12:00+08'`);

// --- Costs: CHECKs and validation -----------------------------------------------
const cost = await saveCost({
  month: "2026-10-01",
  category: "infra",
  label: "Supabase + Vercel",
  amount_centavos: 150000,
  note: "  hosting ",
});
const costRow = await one(`SELECT * FROM public.billing_cost_entries WHERE id = $1`, [cost]);
check(
  "costs: staff add an entry, created_by is the actor, the note is trimmed",
  costRow.created_by === A1 && costRow.note === "hosting" && costRow.label === "Supabase + Vercel",
  costRow,
);
await expectError(
  "costs: the table CHECK rejects a mid-month month",
  () =>
    db.query(
      `INSERT INTO public.billing_cost_entries (month, category, label, amount_centavos)
       VALUES ('2026-10-15', 'infra', 'x', 1)`,
    ),
  /check constraint/,
);
const REFUSALS = [
  ["a mid-month month", { month: "2026-10-15", category: "infra", label: "x", amount_centavos: 1 }],
  ["a missing month", { category: "infra", label: "x", amount_centavos: 1 }],
  ["a nonsense month", { month: "2026-13-01", category: "infra", label: "x", amount_centavos: 1 }],
  [
    "an unknown category",
    { month: "2026-10-01", category: "snacks", label: "x", amount_centavos: 1 },
  ],
  ["a blank label", { month: "2026-10-01", category: "infra", label: "  ", amount_centavos: 1 }],
  [
    "a 121-character label",
    { month: "2026-10-01", category: "infra", label: "x".repeat(121), amount_centavos: 1 },
  ],
  [
    "a negative amount",
    { month: "2026-10-01", category: "infra", label: "x", amount_centavos: -1 },
  ],
  [
    "a fractional amount",
    { month: "2026-10-01", category: "infra", label: "x", amount_centavos: 1.5 },
  ],
  ["a missing amount", { month: "2026-10-01", category: "infra", label: "x" }],
  [
    "an amount that is text",
    { month: "2026-10-01", category: "infra", label: "x", amount_centavos: "9" },
  ],
  [
    "an id that doesn't exist",
    {
      id: "99999999-9999-9999-9999-999999999999",
      month: "2026-10-01",
      category: "infra",
      label: "x",
      amount_centavos: 1,
    },
  ],
];
for (const [label, body] of REFUSALS) {
  await expectError(
    `costs: ${label} is refused in a sentence`,
    () => saveCost(body),
    /^[A-Z].*\.$/,
  );
}
await expectError(
  "costs: a non-object is refused",
  () => saveCost([]),
  /Send the cost as an object/,
);
check(
  "costs: refusals saved nothing",
  (await one(`SELECT count(*)::int AS n FROM public.billing_cost_entries`)).n === 1,
);
const edited = await saveCost({
  id: cost,
  month: "2026-10-01",
  category: "payments",
  label: "Xendit fees",
  amount_centavos: 150000,
});
const editedRow = await one(`SELECT * FROM public.billing_cost_entries WHERE id = $1`, [cost]);
check(
  "costs: saving with an id edits that row in place",
  edited === cost && editedRow.category === "payments" && editedRow.note === null,
  editedRow,
);

// --- Finance --------------------------------------------------------------------
await expectError(
  "finance: an inverted range is refused",
  () => finance("2026-10-31", "2026-10-01"),
  /^Choose a start date on or before the end date\.$/,
);
await expectError(
  "finance: a missing end date is refused",
  () => svc(`SELECT public.billing_finance($1, '2026-10-01'::date, NULL, now())`, [A1]),
  /^Choose a start date on or before the end date\.$/,
);
await expectError(
  "costs list: an inverted range is refused",
  () => svc(`SELECT public.billing_list_costs($1, '2026-10-31', '2026-10-01')`, [A1]),
  /^Choose a start date on or before the end date\.$/,
);

const empty = await finance("2026-01-01", "2026-01-31");
check(
  "finance: an empty range is all zeros with null ratios",
  empty.revenue_centavos === 0 &&
    empty.ai_calls === 0 &&
    empty.cost_per_call_centavos === null &&
    empty.users === 0 &&
    empty.profit_per_user_centavos === null &&
    empty.series.length === 0 &&
    empty.ai_by_fn.length === 0,
  empty,
);

// A primary manager buys the plan, the webhook pays it on 2026-10-05.
const plan = (
  await one(
    `INSERT INTO public.billing_plans
       (name, interval, base_centavos, included_helpers, extra_helper_centavos,
        included_managers, extra_manager_centavos, status, is_public)
     VALUES ('Household', 'monthly', 49900, 1, 9900, 2, NULL, 'active', true) RETURNING id`,
  )
).id;
const sub = await asRole(
  "authenticated",
  P,
  async () =>
    (await one(`SELECT public.billing_start($1, 3, 2, ARRAY[$2]::uuid[]) AS r`, [plan, H1])).r,
);
await svc(
  `SELECT public.billing_record_invoice_result($1, 'ps_1', 'PAID', 69700, '2026-10-05 10:00+08'::timestamptz, 'GCASH', '{}'::jsonb)`,
  [sub.external_id],
);
// The period starts when it is paid (now); pin it to October for a stable range.
await db.query(
  `UPDATE public.billing_subscriptions SET current_period_start = '2026-10-05 10:00+08',
          current_period_end = '2026-11-05 10:00+08' WHERE id = $1`,
  [sub.subscription_id],
);

// H2 is comped (₱0) for October: covered, but not paying.
const comp = await svcRpc(
  `public.billing_grant($1, $2, $3, 2, 2, now() + interval '30 days', 'pilot', 'Pilot household')`,
  [A1, H2, plan],
);
await db.query(
  `UPDATE public.billing_subscriptions SET current_period_start = '2026-10-02 10:00+08',
          current_period_end = '2026-12-01 10:00+08' WHERE id = $1`,
  [comp.subscription_id],
);

const a = await finance("2026-10-01", "2026-10-31");
check(
  "finance: revenue, cost of goods and profit add up",
  a.revenue_centavos === 69700 &&
    a.cost_entries_centavos === 150000 &&
    a.ai_cost_centavos === 3 &&
    a.cogs_centavos === 150003 &&
    a.profit_centavos === -80303,
  a,
);
check("finance: AI calls and cost per call", a.ai_calls === 1 && a.cost_per_call_centavos === 3, a);
check(
  "finance: one paying household (the comp isn't) and its two managers",
  a.paying_households === 1 && a.users === 2 && a.profit_per_user_centavos === -40152,
  a,
);
check(
  "finance: exactly the contract's keys",
  JSON.stringify(Object.keys(a).sort()) ===
    JSON.stringify(
      [
        "revenue_centavos",
        "cogs_centavos",
        "cost_entries_centavos",
        "ai_cost_centavos",
        "ai_calls",
        "cost_per_call_centavos",
        "profit_centavos",
        "paying_households",
        "users",
        "profit_per_user_centavos",
        "series",
        "ai_by_fn",
      ].sort(),
    ),
  Object.keys(a),
);
check(
  "finance: one 2026-10 series entry",
  a.series.length === 1 &&
    a.series[0].month === "2026-10" &&
    a.series[0].revenue_centavos === 69700 &&
    a.series[0].cogs_centavos === 150003 &&
    a.series[0].profit_centavos === -80303 &&
    a.series[0].ai_calls === 1,
  a.series,
);
check(
  "finance: one ai_by_fn row",
  a.ai_by_fn.length === 1 &&
    a.ai_by_fn[0].fn === "scheduler" &&
    a.ai_by_fn[0].calls === 1 &&
    a.ai_by_fn[0].cost_centavos === 3 &&
    a.ai_by_fn[0].input_tokens === 1000 &&
    a.ai_by_fn[0].output_tokens === 500,
  a.ai_by_fn,
);
const november = await finance("2026-11-06", "2026-11-30");
check(
  "finance: a later range has no revenue and no paying household",
  november.revenue_centavos === 0 && november.paying_households === 0 && november.users === 0,
  november,
);
const lastDay = await finance("2026-10-01", "2026-10-10");
check(
  "finance: the end date is inclusive for AI calls",
  lastDay.ai_calls === 1 && lastDay.revenue_centavos === 69700,
  lastDay,
);
const startsAfterPeriodStart = await finance("2026-10-02", "2026-10-04");
check(
  "finance: a cost dated 2026-10-01 is excluded from a range starting 2026-10-02",
  startsAfterPeriodStart.cost_entries_centavos === 0,
  startsAfterPeriodStart,
);
const endsBeforePeriod = await finance("2026-09-20", "2026-10-05");
check(
  "finance: a subscription starting at 10:00 on the last day counts (period start < range end)",
  endsBeforePeriod.paying_households === 1,
  endsBeforePeriod,
);
const strictEnd = await finance("2026-09-01", "2026-10-04");
check(
  "finance: a subscription starting after the range ends doesn't count",
  strictEnd.paying_households === 0,
  strictEnd,
);

// --- Manila day boundaries ------------------------------------------------------
await db.query(
  `UPDATE public.billing_invoices SET paid_at = '2026-10-31 23:30+08' WHERE subscription_id = $1`,
  [sub.subscription_id],
);
const octoberEdge = await finance("2026-10-01", "2026-10-31");
const novemberEdge = await finance("2026-11-01", "2026-11-30");
check(
  "boundary: a payment at 2026-10-31 23:30+08 counts in October, not November",
  octoberEdge.revenue_centavos === 69700 && novemberEdge.revenue_centavos === 0,
  { octoberEdge: octoberEdge.revenue_centavos, novemberEdge: novemberEdge.revenue_centavos },
);
await db.query(
  `UPDATE public.billing_invoices SET paid_at = '2026-11-01 00:30+08' WHERE subscription_id = $1`,
  [sub.subscription_id],
);
const octoberAfter = await finance("2026-10-01", "2026-10-31");
const novemberAfter = await finance("2026-11-01", "2026-11-30");
check(
  "boundary: a payment at 2026-11-01 00:30+08 counts in November, not October",
  octoberAfter.revenue_centavos === 0 &&
    novemberAfter.revenue_centavos === 69700 &&
    novemberAfter.series[0].month === "2026-11",
  { octoberAfter: octoberAfter.revenue_centavos, novemberAfter: novemberAfter.revenue_centavos },
);

// --- Costs list, delete, model prices -------------------------------------------
await saveCost({ month: "2026-11-01", category: "support", label: "Helpdesk", amount_centavos: 5 });
const listed = await svcRpc(`public.billing_list_costs($1, '2026-10-01', '2026-11-30')`, [A1]);
check(
  "costs list: newest month first",
  listed.length === 2 && listed[0].month === "2026-11-01" && listed[1].id === cost,
  listed,
);
const octoberOnly = await svcRpc(`public.billing_list_costs($1, '2026-10-02', '2026-11-30')`, [A1]);
check(
  "costs list: an entry dated 2026-10-01 is excluded from a range starting 2026-10-02",
  octoberOnly.length === 1 && octoberOnly[0].month === "2026-11-01",
  octoberOnly,
);
await svc(`SELECT public.billing_delete_cost($1, $2)`, [A1, listed[0].id]);
await expectError(
  "costs: deleting a missing entry is refused in a sentence",
  () => svc(`SELECT public.billing_delete_cost($1, $2)`, [A1, listed[0].id]),
  /^That cost doesn't exist\.$/,
);
check(
  "costs: the deleted entry is gone",
  (await one(`SELECT count(*)::int AS n FROM public.billing_cost_entries`)).n === 1,
);

await svc(`SELECT public.billing_save_model_price($1, $2::jsonb)`, [
  A1,
  JSON.stringify({
    model: "gpt-4o-mini",
    input_centavos_per_1m: 1000,
    output_centavos_per_1m: 4000,
    note: "checked",
  }),
]);
await svc(`SELECT public.billing_save_model_price($1, $2::jsonb)`, [
  A1,
  JSON.stringify({ model: "new-model", audio_centavos_per_minute: 12 }),
]);
const after = await svcRpc(`public.billing_list_model_prices($1)`, [A1]);
const mini = after.find((p) => p.model === "gpt-4o-mini");
const fresh = after.find((p) => p.model === "new-model");
check(
  "prices: saving upserts by model and the new price drives the next call",
  after.length === 4 &&
    mini.input_centavos_per_1m === 1000 &&
    mini.note === "checked" &&
    fresh.audio_centavos_per_minute === 12 &&
    fresh.input_centavos_per_1m === 0 &&
    Number(await svcRpc(`public.billing_price_ai_call('gpt-4o-mini', 1000000, 0, 0)`)) === 1000,
  after,
);
for (const [label, body] of [
  ["a missing model", { input_centavos_per_1m: 1 }],
  ["a blank model", { model: "  " }],
  ["a negative price", { model: "x", input_centavos_per_1m: -1 }],
  ["a fractional price", { model: "x", output_centavos_per_1m: 0.5 }],
]) {
  await expectError(
    `prices: ${label} is refused in a sentence`,
    () => svc(`SELECT public.billing_save_model_price($1, $2::jsonb)`, [A1, JSON.stringify(body)]),
    /^[A-Z].*\.$/,
  );
}

// --- Audit ----------------------------------------------------------------------
const audit = await auditRows();
check(
  "audit: one row per write, by action and target",
  JSON.stringify(audit.map((r) => [r.action, r.target_type])) ===
    JSON.stringify([
      ["finance.cost_saved", "cost"],
      ["finance.cost_saved", "cost"],
      ["finance.cost_saved", "cost"],
      ["finance.cost_deleted", "cost"],
      ["finance.price_saved", "model_price"],
      ["finance.price_saved", "model_price"],
    ]),
  audit.map((r) => r.action),
);
check(
  "audit: the first row names the cost id",
  audit[0].target_id === cost && audit[0].metadata.cost_id === cost,
  audit[0],
);
check(
  "audit: the price row names the model",
  audit[4].target_id === "gpt-4o-mini" && audit[4].metadata.model === "gpt-4o-mini",
  audit[4],
);
check(
  "audit: no amount, price or note reaches any metadata",
  audit.every(
    (r) => !/amount|centavos|1000|4000|150000|checked|hosting/i.test(JSON.stringify(r.metadata)),
  ),
  audit.map((r) => r.metadata),
);
check("audit: refusals wrote no row", audit.length === 6, audit.length);

// --- A second apply leaves the data alone ---------------------------------------
const snapshot = async () =>
  JSON.stringify({
    costs: await q(`SELECT * FROM public.billing_cost_entries ORDER BY id`),
    prices: await q(
      `SELECT model, input_centavos_per_1m, note FROM public.billing_model_prices ORDER BY model`,
    ),
    usage: await q(`SELECT * FROM public.billing_ai_usage ORDER BY id`),
  });
const before = await snapshot();
await db.exec(readFileSync(resolve(REPO, "018-billing-finance.sql"), "utf8"));
check("a third apply keeps costs, edited prices and usage", before === (await snapshot()));
await expectError(
  "a third apply keeps the staff functions closed to authenticated",
  () => asRole("authenticated", P, () => q(`SELECT public.billing_list_model_prices('${A1}')`)),
  /permission denied/,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
