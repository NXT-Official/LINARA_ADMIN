// Runs 004-crm.sql against a real Postgres (PGlite): the CRM tables are closed
// to the app roles, stages match src/features/crm/crm-stage.ts case for case,
// and every write leaves exactly one audit row with no personal text (§5.2,
// §8.2, D34, S-22).
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
const DAY = 86_400_000;
const ago = (days) => new Date(Date.parse(NOW) - days * DAY).toISOString();
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = id(900);

for (const file of [
  resolve(HERE, "stub-supabase.sql"),
  resolve(HERE, "stub-main-app.sql"),
  resolve(REPO, "001-staff-foundation.sql"),
  resolve(REPO, "002-visibility.sql"),
  resolve(REPO, "003-visibility-fixes.sql"),
  resolve(REPO, "004-crm.sql"),
  resolve(REPO, "005-crm-fixes.sql"),
]) {
  await db.exec(readFileSync(file, "utf8"));
}

// --- tables are closed to the app roles (§8.1, S-27) ----------------------------
for (const role of ["anon", "authenticated"]) {
  for (const table of ["crm_contacts", "crm_activities", "crm_follow_ups"]) {
    await expectError(
      `${role} can't read ${table}`,
      () => as(role, () => q(`SELECT * FROM public.${table}`)),
      /permission denied/,
    );
  }
  await expectError(
    `${role} can't insert a contact`,
    () =>
      as(role, () =>
        q(`INSERT INTO public.crm_contacts (full_name, created_by) VALUES ('x', $1)`, [ADMIN]),
      ),
    /permission denied/,
  );
}
const rls = await q(
  `SELECT relname FROM pg_class WHERE relname LIKE 'crm_%' AND relkind = 'r' AND NOT relrowsecurity`,
);
check("row-level security is on for every crm table", rls.length === 0, rls);

// --- stages match crm-stage.ts (§5.2.2, D16) ---------------------------------------
const cases = JSON.parse(readFileSync(resolve(HERE, "fixtures/stage-cases.json"), "utf8"));
const wrong = [];
for (const c of cases) {
  const [row] = await svc(`SELECT public.crm_household_stage($1, $2, $3, $4, 7, 30) AS s`, [
    c.helpers.includes("ACTIVE"),
    c.helpers.some((h) => h === "ACTIVE" || h === "INACTIVE"),
    c.idleDays === null ? null : ago(c.idleDays),
    NOW,
  ]);
  if (row.s !== c.expected) wrong.push({ case: c.name, got: row.s });
}
check("crm_household_stage matches every shared case", wrong.length === 0, wrong);
const ranks = await svc(
  `SELECT s, public.crm_stage_rank(s) AS r
   FROM unnest(ARRAY['active','set_up','at_risk','signed_up','inactive']) s`,
);
check("rank orders active first", ranks.map((r) => r.r).join() === "5,4,3,2,1", ranks);

// --- table checks -------------------------------------------------------------------
const insert = (cols, vals) =>
  q(`INSERT INTO public.crm_contacts (full_name, created_by, ${cols}) VALUES ('x', $1, ${vals})`, [
    ADMIN,
  ]);
await expectError("a bad source is refused", () => insert("source", "'tiktok'"), /check/);
await expectError("a bad lead stage is refused", () => insert("lead_stage", "'won'"), /check/);
await expectError(
  "eleven tags are refused",
  () => insert("tags", `ARRAY['1','2','3','4','5','6','7','8','9','10','11']`),
  /check/,
);
await expectError(
  "a bad activity kind is refused",
  async () => {
    const [c] = await q(
      `INSERT INTO public.crm_contacts (full_name, created_by) VALUES ('y', $1) RETURNING id`,
      [ADMIN],
    );
    await q(
      `INSERT INTO public.crm_activities (contact_id, kind, body, occurred_at, author_id)
       VALUES ($1, 'fax', 'x', now(), $2)`,
      [c.id, ADMIN],
    );
  },
  /check/,
);
await q(`DELETE FROM public.crm_contacts`);

// --- Task 3: reads ------------------------------------------------------------------
const A2 = id(901);
const [M1, M2, M3, HU] = [id(1), id(2), id(3), id(4)];
const [HA, HB, HC, HD] = [id(11), id(12), id(13), id(14)];
const [L1, L2, L3, L4, C2] = [id(41), id(42), id(43), id(44), id(45)];
await db.exec(`
  INSERT INTO auth.users (id, email, created_at) VALUES
    ('${M1}', 'm1@example.com', '2026-09-01T00:00:00Z'),
    ('${M2}', 'm2@example.com', '2026-09-02T00:00:00Z'),
    ('${M3}', 'mia@example.com', '2026-09-03T00:00:00Z'),
    ('${HU}', 'lead2@example.com', '2026-09-04T00:00:00Z');
  INSERT INTO public.user_profiles (id, household_id, full_name, user_type) VALUES
    ('${M1}', '${HA}', 'Ana Reyes', 'primary_manager'),
    ('${M2}', '${HC}', 'Mara Cruz', 'primary_manager'),
    ('${M3}', '${HD}', 'Mia Lopez', 'primary_manager'),
    ('${HU}', '${HA}', 'Hana Helper', 'helper');
  INSERT INTO public.households (id, name, created_at) VALUES
    ('${HA}', 'Reyes home', '2026-09-01T00:00:00Z'),
    ('${HB}', 'Reyes beach house', '2026-09-01T00:00:00Z'),
    ('${HC}', 'Cruz home', '2026-09-02T00:00:00Z'),
    ('${HD}', 'Lopez home', '2026-09-03T00:00:00Z');
  INSERT INTO public.household_managers (household_id, user_id, role) VALUES
    ('${HA}', '${M1}', 'primary_manager'),
    ('${HB}', '${M1}', 'co_manager'),
    ('${HC}', '${M2}', 'primary_manager'),
    ('${HD}', '${M3}', 'primary_manager');
  INSERT INTO public.helper_profiles (id, user_id, household_id, name, status) VALUES
    ('${id(21)}', '${HU}', '${HA}', 'Hana Helper', 'ACTIVE'),
    ('${id(22)}', NULL, '${HB}', 'Bea', 'ACTIVE'),
    ('${id(23)}', NULL, '${HC}', 'Cora', 'ACTIVE');
  INSERT INTO public.tickets (household_id, status, scheduled_start, actual_end) VALUES
    ('${HA}', 'done', '${ago(1)}', '${ago(1)}'),
    ('${HB}', 'done', '${ago(40)}', '${ago(40)}'),
    ('${HC}', 'done', '${ago(10)}', '${ago(10)}');
  INSERT INTO public.crm_contacts
    (id, full_name, email, phone, source, lead_stage, lost_reason, user_id, linked_at,
     owner_id, tags, created_by, created_at) VALUES
    ('${L1}', 'Lia 50% Santos', 'lead1@example.com', '09171234567', 'facebook', 'interested',
     NULL, NULL, NULL, '${A2}', '{Cebu}', '${ADMIN}', '2026-10-10T00:00:00Z'),
    ('${L2}', 'Leo Diaz', 'lead2@example.com', NULL, 'event', 'new',
     NULL, NULL, NULL, NULL, '{}', '${ADMIN}', '2026-10-11T00:00:00Z'),
    ('${L3}', 'Mia L', 'Mia@Example.com', NULL, NULL, 'new',
     NULL, NULL, NULL, NULL, '{}', '${ADMIN}', '2026-10-12T00:00:00Z'),
    ('${L4}', 'Lou Tan', NULL, '09170000000', 'referral', 'lost',
     'Hired an agency', NULL, NULL, NULL, '{}', '${ADMIN}', '2026-10-01T00:00:00Z'),
    ('${C2}', 'Old Name', NULL, NULL, NULL, 'contacted',
     NULL, '${M2}', '${ago(5)}', '${ADMIN}', '{OFW}', '${ADMIN}', '2026-10-05T00:00:00Z');
  INSERT INTO public.crm_follow_ups (contact_id, due_at, note, assignee_id, created_by) VALUES
    ('${L1}', '2026-10-15T15:00:00Z', 'Call back', '${A2}', '${ADMIN}'),
    ('${L2}', '2026-10-14T03:00:00Z', 'Send brochure', '${ADMIN}', '${ADMIN}');
`);
const list = async (params = {}) => {
  const p = {
    search: null,
    kind: null,
    stage: null,
    owner: null,
    tag: null,
    role: null,
    due: null,
    limit: 50,
    offset: 0,
    ...params,
  };
  return svc(
    `SELECT * FROM public.crm_list_contacts($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 7, 30)`,
    [p.search, p.kind, p.stage, p.owner, p.tag, p.role, p.due, p.limit, p.offset, NOW],
  );
};
const keys = (rows) =>
  rows
    .map((r) => r.contact_id ?? r.user_id)
    .sort()
    .join();
const everyone = await list();
check(
  "unsaved managers appear once",
  everyone.filter((r) => r.user_id === M1).length === 1 &&
    everyone.find((r) => r.user_id === M1).contact_id === null &&
    everyone.filter((r) => r.user_id === M2).length === 1 &&
    everyone.length === 7,
  everyone.map((r) => [r.contact_id, r.user_id, r.full_name]),
);
const mara = everyone.find((r) => r.user_id === M2);
check(
  "customer name and email come from the account",
  mara.full_name === "Mara Cruz" && mara.email === "m2@example.com" && mara.kind === "customer",
  mara,
);
const ana = everyone.find((r) => r.user_id === M1);
check(
  "best stage, roles and household count for a two-home manager",
  ana.stage === "active" &&
    ana.household_count === 2 &&
    [...ana.roles].sort().join() === "co_manager,primary_manager",
  ana,
);
check("stage filter uses the best stage", keys(await list({ stage: "at_risk" })) === C2);
check("no one is inactive when active elsewhere", (await list({ stage: "inactive" })).length === 0);
check("signed up", keys(await list({ stage: "signed_up" })) === M3);
check("owner filter", keys(await list({ owner: ADMIN })) === C2);
check("tag filter ignores case", keys(await list({ tag: "cebu" })) === L1);
check("role filter", keys(await list({ role: "co_manager" })) === M1);
check("kind filter", keys(await list({ kind: "lead" })) === [L1, L2, L3, L4].sort().join());
check("search escapes wildcards", keys(await list({ search: "%" })) === L1);
check("search finds phone digits", keys(await list({ search: "0917 123" })) === L1);
check("search finds tags", keys(await list({ search: "ofw" })) === C2);
check("due today is a Manila day", keys(await list({ due: "today" })) === L1);
check("overdue", keys(await list({ due: "overdue" })) === L2);
check("overdue follow-ups come first", everyone[0].contact_id === L2, everyone[0]);
check(
  "a lead's next follow-up",
  everyone.find((r) => r.contact_id === L1).next_follow_up_at?.toISOString?.() ===
    "2026-10-15T15:00:00.000Z",
);
check("limit and offset", (await list({ limit: 2, offset: 6 })).length === 1);

const suggest = async (c) =>
  (await svc(`SELECT user_id FROM public.crm_link_suggestions($1)`, [c])).map((r) => r.user_id);
check("suggestions skip helpers and linked accounts", (await suggest(L2)).length === 0);
check("suggestion matches email ignoring case", (await suggest(L3)).join() === M3);

const detail = async (contactId, userId) =>
  (await svc(`SELECT public.crm_get_contact($1, $2, $3, 7, 30) AS d`, [contactId, userId, NOW]))[0]
    .d;
const anaDetail = await detail(null, M1);
check(
  "detail by user id for an unsaved manager",
  anaDetail?.contact_id === null &&
    anaDetail.stage === "active" &&
    anaDetail.households.length === 2 &&
    anaDetail.households.find((h) => h.household_id === HB)?.stage === "inactive" &&
    anaDetail.activities.length === 0,
  anaDetail,
);
const maraByUser = await detail(null, M2);
check("detail by user id finds the saved contact", maraByUser?.contact_id === C2, maraByUser);
const lia = await detail(L1, null);
check(
  "lead detail",
  lia?.kind === "lead" && lia.lead_stage === "interested" && lia.follow_ups.length === 1,
  lia,
);
check("a helper has no CRM page", (await detail(null, HU)) === null);
const detailDef = (await q(`SELECT pg_get_functiondef('public.crm_get_contact'::regproc) AS d`))[0]
  .d;
check(
  "opening one contact reads only that person's homes, not the whole CRM list",
  !detailDef.includes("crm_people") && detailDef.includes("crm_household_facts(v_homes"),
);
check("unknown contact is null", (await detail(id(999), null)) === null);

const dash = (await svc(`SELECT public.crm_dashboard($1, 7, 30) AS d`, [NOW]))[0].d;
check(
  "dashboard counts",
  dash.leads_by_stage.new === 2 &&
    dash.leads_by_stage.interested === 1 &&
    dash.leads_by_stage.lost === 1 &&
    dash.leads_by_stage.contacted === 0 &&
    dash.customers_by_stage.active === 1 &&
    dash.customers_by_stage.at_risk === 1 &&
    dash.customers_by_stage.signed_up === 1 &&
    dash.customers_by_stage.inactive === 0 &&
    dash.follow_ups_due_today === 1 &&
    dash.follow_ups_overdue === 1 &&
    dash.converted_30d === 1 &&
    dash.sources.facebook === 1 &&
    dash.sources.event === 1 &&
    dash.sources.referral === 1 &&
    dash.sources.website === 0,
  dash,
);
for (const role of ["anon", "authenticated"]) {
  for (const call of [
    `crm_list_contacts(NULL, NULL, NULL, NULL, NULL, NULL, NULL, 50, 0, now(), 7, 30)`,
    `crm_get_contact(NULL, '${M1}', now(), 7, 30)`,
    `crm_link_suggestions('${L3}')`,
    `crm_dashboard(now(), 7, 30)`,
  ]) {
    await expectError(
      `${role} can't run ${call.split("(")[0]}`,
      () => as(role, () => q(`SELECT * FROM public.${call}`)),
      /permission denied/,
    );
  }
}

// --- Task 4: writes, each with its audit entry (D34) ----------------------------------
const audits = async () =>
  q(`SELECT action, target_type, target_id, metadata FROM public.staff_audit_log ORDER BY id`);
const auditCount = async () => (await audits()).length;
const one = async (sql, params) => (await svc(sql, params))[0];
// Direct table reads run as the owner, as in staff-foundation.test.mjs.
const row = async (sql, params) => (await q(sql, params))[0];
const SECRET = "secret note <script>alert(1)</script>";

let before = await auditCount();
const created = await one(
  `SELECT public.crm_create_lead($1, 'Nina Ramos', 'nina@example.com', '09181112222',
     'website', NULL, ARRAY['OFW'], $2) AS id`,
  [ADMIN, SECRET],
);
const L5 = created.id;
const afterCreate = await audits();
check(
  "creating a lead leaves one audit row",
  afterCreate.length === before + 1 &&
    afterCreate.at(-1).action === "crm.contact_created" &&
    afterCreate.at(-1).target_type === "contact" &&
    afterCreate.at(-1).target_id === L5,
  afterCreate.at(-1),
);
check(
  "a note on a new lead becomes its first activity",
  (await q(`SELECT kind FROM public.crm_activities WHERE contact_id = $1`, [L5]))
    .map((r) => r.kind)
    .join() === "note",
);

before = await auditCount();
await expectError(
  "a lead needs an email or a phone",
  () =>
    svc(`SELECT public.crm_create_lead($1, 'No Way', NULL, NULL, NULL, NULL, '{}', NULL)`, [ADMIN]),
  /email or a phone/,
);
check("a failed rule leaves no audit row", (await auditCount()) === before);

before = await auditCount();
await svc(
  `SELECT public.crm_update_contact($1, $2, 'Nina R', 'nina@example.com', NULL, 'website', $3, ARRAY['OFW','Cebu'])`,
  [ADMIN, L5, A2],
);
const nina = await row(
  `SELECT full_name, phone, owner_id, tags FROM public.crm_contacts WHERE id = $1`,
  [L5],
);
check(
  "updating a lead",
  nina.full_name === "Nina R" &&
    nina.phone === null &&
    nina.owner_id === A2 &&
    nina.tags.join() === "OFW,Cebu" &&
    (await auditCount()) === before + 1,
  nina,
);

await svc(
  `SELECT public.crm_update_contact($1, $2, 'Hacker', 'x@example.com', '09990000000', 'event', $3, ARRAY['VIP'])`,
  [ADMIN, C2, A2],
);
const c2 = await row(
  `SELECT full_name, email, phone, source, owner_id, tags FROM public.crm_contacts WHERE id = $1`,
  [C2],
);
check(
  "customers keep their account's name",
  c2.full_name === "Old Name" &&
    c2.email === null &&
    c2.phone === null &&
    c2.source === null &&
    c2.owner_id === A2 &&
    c2.tags.join() === "VIP",
  c2,
);

await expectError(
  "lost needs a reason",
  () => svc(`SELECT public.crm_set_lead_stage($1, $2, 'lost', NULL)`, [ADMIN, L5]),
  /why the lead was lost/,
);
await svc(`SELECT public.crm_set_lead_stage($1, $2, 'lost', 'Went with an agency')`, [ADMIN, L5]);
const stageAudit = (await audits()).at(-1);
check(
  "a stage change records from and to",
  stageAudit.action === "crm.stage_changed" &&
    stageAudit.metadata.from === "new" &&
    stageAudit.metadata.to === "lost",
  stageAudit,
);
await svc(`SELECT public.crm_set_lead_stage($1, $2, 'contacted', NULL)`, [ADMIN, L5]);
check(
  "leaving lost clears the reason",
  (await row(`SELECT lost_reason FROM public.crm_contacts WHERE id = $1`, [L5])).lost_reason ===
    null,
);
await expectError(
  "customers have no lead stage",
  () => svc(`SELECT public.crm_set_lead_stage($1, $2, 'interested', NULL)`, [ADMIN, C2]),
  /Only leads/,
);

await expectError(
  "link refuses a linked account",
  () => svc(`SELECT public.crm_link_contact($1, $2, $3)`, [ADMIN, L5, M2]),
  /already has/,
);
await expectError(
  "link refuses a helper",
  () => svc(`SELECT public.crm_link_contact($1, $2, $3)`, [ADMIN, L5, HU]),
  /household managers/,
);
await svc(`SELECT public.crm_link_contact($1, $2, $3)`, [ADMIN, L3, M3]);
const miaRows = (await list()).filter((r) => r.user_id === M3);
check(
  "a linked lead becomes the manager's one customer row",
  miaRows.length === 1 &&
    miaRows[0].contact_id === L3 &&
    miaRows[0].kind === "customer" &&
    (await audits()).at(-1).action === "crm.contact_linked",
  miaRows,
);
await svc(`SELECT public.crm_unlink_contact($1, $2)`, [ADMIN, L3]);
const unlinked = await row(
  `SELECT user_id, linked_at, lead_stage, full_name, email FROM public.crm_contacts WHERE id = $1`,
  [L3],
);
check(
  "unlink makes a lead again, keeping a name and email",
  unlinked.user_id === null &&
    unlinked.linked_at === null &&
    unlinked.lead_stage === "contacted" &&
    unlinked.full_name &&
    unlinked.email,
  unlinked,
);

await expectError(
  "customers can't be deleted",
  () => svc(`SELECT public.crm_delete_lead($1, $2)`, [ADMIN, C2]),
  /Unlink/,
);

before = await auditCount();
await svc(`SELECT public.crm_add_activity($1, NULL, $2, 'call', $3, $4)`, [
  ADMIN,
  M1,
  SECRET,
  ago(0),
]);
await svc(`SELECT public.crm_add_activity($1, NULL, $2, 'note', 'second', $3)`, [
  ADMIN,
  M1,
  ago(0),
]);
const m1Rows = await q(`SELECT id FROM public.crm_contacts WHERE user_id = $1`, [M1]);
const m1Audit = (await audits()).slice(before).map((a) => a.action);
check(
  "activity on an unsaved manager saves the contact once",
  m1Rows.length === 1 &&
    m1Audit.join() === "crm.contact_created,crm.activity_added,crm.activity_added",
  { m1Rows, m1Audit },
);
const again = await one(`SELECT public.crm_ensure_contact($1, $2) AS id`, [ADMIN, M1]);
check(
  "ensure contact is idempotent under a repeat",
  again.id === m1Rows[0].id && (await auditCount()) === before + 3,
);
await expectError(
  "ensure refuses a helper",
  () => svc(`SELECT public.crm_ensure_contact($1, $2)`, [ADMIN, HU]),
  /household manager/,
);
await expectError(
  "an activity can't happen in the future",
  () =>
    svc(`SELECT public.crm_add_activity($1, $2, NULL, 'call', 'x', now() + interval '1 hour')`, [
      ADMIN,
      L1,
    ]),
  /future/,
);

const fu = await one(
  `SELECT public.crm_add_follow_up($1, $2, NULL, now() + interval '2 days', 'Call back', $3) AS id`,
  [ADMIN, L1, A2],
);
await expectError(
  "a follow-up more than a year out is refused",
  () =>
    svc(`SELECT public.crm_add_follow_up($1, $2, NULL, now() + interval '400 days', 'x', $3)`, [
      ADMIN,
      L1,
      A2,
    ]),
  /year/,
);
await svc(`SELECT public.crm_complete_follow_up($1, $2)`, [ADMIN, fu.id]);
check(
  "complete follow-up sets done_at",
  (await row(`SELECT done_at FROM public.crm_follow_ups WHERE id = $1`, [fu.id])).done_at !==
    null &&
    (await audits()).at(-1).action === "crm.follow_up_done" &&
    (await audits()).at(-1).target_id === L1,
);
await expectError(
  "complete follow-up only once",
  () => svc(`SELECT public.crm_complete_follow_up($1, $2)`, [ADMIN, fu.id]),
  /already done/,
);

await svc(`SELECT public.crm_delete_lead($1, $2)`, [ADMIN, L5]);
check(
  "deleting a lead removes it and records it",
  (await q(`SELECT 1 FROM public.crm_contacts WHERE id = $1`, [L5])).length === 0 &&
    (await audits()).at(-1).action === "crm.contact_deleted",
);

const allAudit = JSON.stringify(await audits());
check(
  "audit holds no text",
  ![
    "Nina",
    "nina@",
    "0918",
    "Lia",
    "lead1@",
    "Call back",
    "secret note",
    "<script>",
    "agency",
  ].some((s) => allAudit.includes(s)),
  allAudit,
);
for (const role of ["anon", "authenticated"]) {
  await expectError(
    `${role} can't create a lead`,
    () =>
      as(role, () =>
        q(`SELECT public.crm_create_lead($1, 'x', 'x@example.com', NULL, NULL, NULL, '{}', NULL)`, [
          ADMIN,
        ]),
      ),
    /permission denied/,
  );
}

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
