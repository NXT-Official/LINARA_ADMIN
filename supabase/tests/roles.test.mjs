// Runs 013-roles.sql and 014-roles-fixes.sql against a real Postgres (PGlite): four locked presets,
// custom roles that can't manage the team, one role per member, the mod limits,
// the last-admin rule, the two-step code flag, and an audit row for every change
// with ids, role names and permission names only (§4.2, D39, FR-TM-2, FR-TM-3,
// FR-RL-1 to FR-RL-6, S-22).
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

const BEFORE = [
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
];
for (const file of BEFORE) await db.exec(readFileSync(resolve(REPO, file), "utf8"));

const [A1, A2, MOD, MOD2, SALES, SUP, CUS, NEW] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => id(900 + n));
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES
    ('${A1}', 'a1@example.com'), ('${A2}', 'a2@example.com'), ('${MOD}', 'mod@example.com'),
    ('${MOD2}', 'mod2@example.com'), ('${SALES}', 'sales@example.com'), ('${SUP}', 'sup@example.com'),
    ('${CUS}', 'cus@example.com'), ('${NEW}', 'new@example.com');
  INSERT INTO public.staff_roles (user_id, role) VALUES ('${A1}', 'admin');
`);
await db.exec(readFileSync(resolve(REPO, "013-roles.sql"), "utf8"));
await db.exec(readFileSync(resolve(REPO, "014-roles-fixes.sql"), "utf8"));

// --- presets (§4.2) ----------------------------------------------------------------------
const TS = readFileSync(resolve(REPO, "../src/features/auth/permissions.ts"), "utf8");
const tsList = [
  ...TS.slice(TS.indexOf("PERMISSIONS = ["), TS.indexOf("] as const")).matchAll(/"([a-z.]+)"/g),
].map((m) => m[1]);
const known = (await q(`SELECT public.staff_known_permissions() AS p`))[0].p;
// 018-billing.sql adds these three; billing.test.mjs checks the full list.
const BILLING = ["billing.view", "billing.manage", "switches.manage"];
const before018 = tsList.filter((p) => !BILLING.includes(p));
check(
  "the permission list matches permissions.ts (before 018)",
  before018.length === 16 && [...before018].sort().join() === [...known].sort().join(),
  { before018, known },
);

const ALL = before018;
const without = (...xs) => ALL.filter((p) => !xs.includes(p)).sort();
const EXPECTED = {
  admin: [...ALL].sort(),
  mods: without("team.manage").concat("team.manage").sort(),
  sales: ["crm.export", "crm.view", "crm.write", "dashboard.view", "households.view", "users.view"],
  support: [
    "crm.view",
    "dashboard.view",
    "deletions.view",
    "households.view",
    "payouts.view",
    "support.view",
    "support.write",
    "users.view",
  ],
};
const presets = await q(
  `SELECT preset, name, permissions FROM public.staff_role_defs WHERE preset IS NOT NULL`,
);
const byPreset = Object.fromEntries(presets.map((r) => [r.preset, r]));
check(
  "presets exist with §4.2's permissions",
  presets.length === 4 &&
    Object.entries(EXPECTED).every(
      ([k, v]) => [...byPreset[k].permissions].sort().join() === v.join(),
    ) &&
    byPreset.admin.name === "Admin" &&
    byPreset.mods.name === "Mods" &&
    byPreset.sales.name === "Sales" &&
    byPreset.support.name === "Support",
  presets,
);
const R = Object.fromEntries(
  (await q(`SELECT preset, id FROM public.staff_role_defs WHERE preset IS NOT NULL`)).map((r) => [
    r.preset,
    r.id,
  ]),
);
check(
  "existing admins become admin",
  (await q(`SELECT role_id FROM public.staff_roles WHERE user_id = $1`, [A1]))[0].role_id ===
    R.admin,
);

for (const role of ["anon", "authenticated"]) {
  await expectError(
    `${role} can't read staff_role_defs`,
    () => as(role, () => q(`SELECT * FROM public.staff_role_defs`)),
    /permission denied/,
  );
}

// Members for the rest, set directly (the write functions are tested below).
await db.exec(`
  INSERT INTO public.staff_roles (user_id, role_id) VALUES
    ('${A2}', '${R.admin}'), ('${MOD}', '${R.mods}'), ('${MOD2}', '${R.mods}'),
    ('${SALES}', '${R.sales}'), ('${SUP}', '${R.support}');
`);

const audits = () =>
  q(`SELECT action, target_type, target_id, metadata FROM public.staff_audit_log ORDER BY id`);
const create = (actor, name, perms, description = null, code = true) =>
  svc(`SELECT public.staff_create_role($1, $2, $3, $4, $5) AS id`, [
    actor,
    name,
    description,
    perms,
    code,
  ]).then((r) => r[0].id);
const roleRow = async (rid) =>
  (await q(`SELECT * FROM public.staff_role_defs WHERE id = $1`, [rid]))[0];
const update = (actor, rid, o = {}) =>
  roleRow(rid).then((r) =>
    svc(`SELECT public.staff_update_role($1, $2, $3, $4, $5, $6, $7)`, [
      actor,
      rid,
      o.name ?? r.name,
      o.description ?? r.description,
      o.permissions ?? r.permissions,
      o.seen ?? r.updated_at,
      o.code ?? false,
    ]),
  );
const setRole = (actor, user, rid, code = false) =>
  svc(`SELECT public.staff_set_member_role($1, $2, $3, $4)`, [actor, user, rid, code]);

// --- presets can't change ----------------------------------------------------------------
await expectError(
  "presets can't be edited",
  () => update(A1, R.sales, { name: "Sellers", code: true }),
  /Preset roles can't be changed/,
);
await expectError(
  "presets can't be deleted",
  () => svc(`SELECT public.staff_delete_role($1, $2)`, [A1, R.support]),
  /Preset roles can't be changed/,
);

// --- custom roles (FR-RL-3) --------------------------------------------------------------
await expectError(
  "custom roles can't manage the team",
  () => create(A1, "Leads", ["dashboard.view", "team.manage"]),
  /Custom roles can't manage the team/,
);
await expectError(
  "every role needs the dashboard",
  () => create(A1, "Leads", ["crm.view"]),
  /Every role needs the dashboard/,
);
await expectError(
  "unknown permissions are refused",
  () => create(A1, "Leads", ["dashboard.view", "crm.delete"]),
  /Pick permissions from the list/,
);
for (const name of ["admin", " Sales ", "SUPPORT"]) {
  await expectError(
    `names are unique ignoring case and spaces (${JSON.stringify(name)})`,
    () => create(A1, name, ["dashboard.view"]),
    /A role with that name already exists/,
  );
}

await expectError(
  "creating a custom role needs the code (spec 0.19)",
  () => create(A1, "No code", ["dashboard.view"], null, false),
  /Enter your two-step code/,
);
let before = (await audits()).length;
const LEADS = await create(A1, "  Lead desk ", ["crm.view", "dashboard.view", "crm.view"], "  ");
const leads = await roleRow(LEADS);
const createdAudit = (await audits()).slice(before);
check(
  "create trims, dedupes, sorts and records the role",
  leads.name === "Lead desk" &&
    leads.description === null &&
    leads.preset === null &&
    leads.permissions.join() === "crm.view,dashboard.view" &&
    createdAudit.length === 1 &&
    createdAudit[0].action === "role.created" &&
    createdAudit[0].target_type === "role" &&
    createdAudit[0].target_id === LEADS &&
    createdAudit[0].metadata.permissions.join() === "crm.view,dashboard.view",
  { leads, createdAudit },
);

before = (await audits()).length;
await update(A1, LEADS, { name: "Lead team" });
check(
  "editing permissions needs the code, renaming doesn't",
  (await roleRow(LEADS)).name === "Lead team",
);
await expectError(
  "editing permissions without the code is refused",
  () => update(A1, LEADS, { permissions: ["crm.view", "crm.write", "dashboard.view"] }),
  /Enter your two-step code to make this change/,
);
await update(A1, LEADS, { permissions: ["crm.write", "dashboard.view"], code: true });
const updates = (await audits()).slice(before);
check(
  "create, rename and edit record added and removed",
  updates.length === 2 &&
    updates[0].action === "role.updated" &&
    updates[0].metadata.renamed === true &&
    updates[0].metadata.added.length === 0 &&
    updates[1].metadata.renamed === false &&
    updates[1].metadata.added.join() === "crm.write" &&
    updates[1].metadata.removed.join() === "crm.view",
  updates,
);
const stale = (await roleRow(LEADS)).updated_at;
await update(A1, LEADS, { description: "Handles new leads" });
await expectError(
  "a stale edit is refused",
  () => update(A1, LEADS, { name: "Lead desk", seen: stale }),
  /Someone else changed this role/,
);

// --- members (FR-TM-2, FR-TM-3, FR-RL-6) -------------------------------------------------
before = (await audits()).length;
await expectError(
  "giving admin or mods needs the code",
  () => svc(`SELECT public.staff_add_member($1, $2, $3, false)`, [A1, NEW, R.mods]),
  /Enter your two-step code/,
);
await expectError(
  "giving a custom role needs the code (spec 0.19)",
  () => svc(`SELECT public.staff_add_member($1, $2, $3, false)`, [A1, CUS, LEADS]),
  /Enter your two-step code/,
);
await svc(`SELECT public.staff_add_member($1, $2, $3, true)`, [A1, CUS, LEADS]);
await expectError(
  "adding someone already on the team is refused",
  () => svc(`SELECT public.staff_add_member($1, $2, $3, false)`, [A1, CUS, R.sales]),
  /That email is already on the team/,
);
const added = (await audits()).slice(before);
check(
  "adding a member records the role",
  added.length === 1 &&
    added[0].action === "staff.added" &&
    added[0].target_id === CUS &&
    added[0].metadata.role_id === LEADS,
  added,
);

await expectError(
  "deleting a role in use is refused",
  () => svc(`SELECT public.staff_delete_role($1, $2)`, [A1, LEADS]),
  /^1 member has this role\. Give them another role first\./,
);

// Mod limits.
await expectError(
  "mod limits: mods can't give admin",
  () => setRole(MOD, SALES, R.admin, true),
  /Mods can't give the admin or mods role/,
);
await expectError(
  "mod limits: mods can't give mods",
  () => svc(`SELECT public.staff_add_member($1, $2, $3, true)`, [MOD, NEW, R.mods]),
  /Mods can't give the admin or mods role/,
);
await expectError(
  "mod limits: mods can't change an admin",
  () => setRole(MOD, A2, R.sales),
  /Mods can only change sales, support and custom-role members/,
);
await expectError(
  "mod limits: mods can't change another mod",
  () => setRole(MOD, MOD2, R.sales),
  /Mods can only change sales, support and custom-role members/,
);
await expectError(
  "mod limits: mods can't remove an admin",
  () => svc(`SELECT public.staff_remove_member($1, $2)`, [MOD, A2]),
  /Mods can only change sales, support and custom-role members/,
);
before = (await audits()).length;
await setRole(MOD, SALES, R.support);
await setRole(MOD, SALES, R.support);
const changed = (await audits()).slice(before);
check(
  "mod limits: mods change sales, support and custom members; a same-value change records nothing",
  (await q(`SELECT role_id FROM public.staff_roles WHERE user_id = $1`, [SALES]))[0].role_id ===
    R.support &&
    changed.length === 1 &&
    changed[0].action === "staff.role_changed" &&
    changed[0].metadata.from_role_id === R.sales &&
    changed[0].metadata.to_role_id === R.support,
  changed,
);
await expectError(
  "nobody changes their own role",
  () => setRole(A1, A1, R.mods, true),
  /You can't change your own role/,
);
await expectError(
  "nobody removes themselves",
  () => svc(`SELECT public.staff_remove_member($1, $2)`, [MOD, MOD]),
  /You can't remove yourself/,
);
await expectError(
  "a member without team.manage can't change anyone",
  () => setRole(SUP, SALES, R.sales),
  /Your role doesn't allow this/,
);

// Last admin.
await setRole(A1, A2, R.mods, true);
await expectError(
  "last admin can't be changed",
  () => setRole(MOD, A1, R.sales),
  /Mods can only change/,
);
await setRole(A1, A2, R.admin, true);
await svc(`SELECT public.staff_remove_member($1, $2)`, [A1, A2]);
check(
  "removing a member records it",
  (await audits()).at(-1).action === "staff.removed" &&
    (await q(`SELECT 1 FROM public.staff_roles WHERE user_id = $1`, [A2])).length === 0,
);
const defs = await q(
  `SELECT p.proname, pg_get_functiondef(p.oid) AS def FROM pg_proc p
   WHERE p.proname IN ('staff_set_member_role', 'staff_remove_member')`,
);
check(
  "last admin holds under concurrent changes (admins' rows locked before counting)",
  defs.length === 2 && defs.every((d) => /FOR UPDATE/i.test(d.def)),
);

// --- session (D31, FR-RL-7) --------------------------------------------------------------
const SESSION = id(5001);
await db.exec(
  `INSERT INTO public.staff_sessions (session_id, user_id) VALUES ('${SESSION}', '${CUS}')`,
);
const touch = async () =>
  (await svc(`SELECT * FROM public.staff_touch_session($1, $2)`, [SESSION, CUS]))[0];
const t1 = await touch();
await update(A1, LEADS, { permissions: ["dashboard.view", "support.view"], code: true });
const t2 = await touch();
check(
  "touch session returns the new permissions after a change",
  t1.role_id === LEADS &&
    t1.role_name === "Lead team" &&
    t1.preset === null &&
    t1.permissions.join() === "crm.write,dashboard.view" &&
    t2.permissions.join() === "dashboard.view,support.view",
  { t1, t2 },
);

const list = await svc(`SELECT * FROM public.staff_list_roles()`);
check(
  "list shows presets first with member counts",
  list.map((r) => r.preset ?? r.name).join() === "admin,mods,sales,support,Lead team" &&
    list.find((r) => r.role_id === LEADS).member_count === 1,
  list.map((r) => [r.preset ?? r.name, r.member_count]),
);
const admins = await svc(`SELECT * FROM public.staff_list_admins()`);
check(
  "the team list carries each member's role",
  admins.find((a) => a.user_id === CUS)?.role_name === "Lead team" &&
    admins.find((a) => a.user_id === A1)?.preset === "admin",
  admins,
);

await setRole(A1, CUS, R.sales);
before = (await audits()).length;
await svc(`SELECT public.staff_delete_role($1, $2)`, [A1, LEADS]);
check(
  "an unused custom role can be deleted",
  (await roleRow(LEADS)) === undefined &&
    (await audits()).slice(before)[0].action === "role.deleted",
);

const text = JSON.stringify(await audits());
check("audit holds ids, role names and permission names only", !text.includes("@example.com"));

// --- the database refuses even without the functions (014, review fixes) ----------------
await expectError(
  "a direct insert of a custom role with team.manage is refused",
  () =>
    q(`INSERT INTO public.staff_role_defs (name, permissions) VALUES ('Sneaky', $1)`, [
      ["dashboard.view", "team.manage"],
    ]),
  /check constraint/,
);
// A role with team.manage but no preset can only exist if the table rule is bypassed.
const [{ conname }] = await q(
  `SELECT conname FROM pg_constraint WHERE conrelid = 'public.staff_role_defs'::regclass
     AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%team.manage%'`,
);
await db.exec(`ALTER TABLE public.staff_role_defs DROP CONSTRAINT ${conname}`);
const ROGUE_ROLE = (
  await q(
    `INSERT INTO public.staff_role_defs (name, permissions)
     VALUES ('Rogue', ARRAY['dashboard.view', 'team.manage']) RETURNING id`,
  )
)[0].id;
await db.exec(
  `INSERT INTO public.staff_roles (user_id, role_id) VALUES ('${NEW}', '${ROGUE_ROLE}')`,
);
await expectError(
  "only the admin and mods presets manage the team, whatever a role holds",
  () => setRole(NEW, SALES, R.admin, true),
  /Your role doesn't allow this/,
);
await expectError(
  "a manager role without a preset can't remove an admin",
  () => svc(`SELECT public.staff_remove_member($1, $2)`, [NEW, A1]),
  /Your role doesn't allow this/,
);
await db.exec(`DELETE FROM public.staff_roles WHERE user_id = '${NEW}'`);
await db.exec(`DELETE FROM public.staff_role_defs WHERE id = '${ROGUE_ROLE}'`);

// Wording now that members have roles: the Team screen, a team member.
const DEL_REQ = id(960);
await db.exec(`
  INSERT INTO public.account_deletion_requests (id, user_id, user_type, status)
  VALUES ('${DEL_REQ}', '${SUP}', 'co_manager', 'pending');
`);
await expectError(
  "processing a team member's deletion points to the Team screen",
  () => svc(`SELECT public.staff_process_deletion($1, $2)`, [A1, DEL_REQ]),
  /This account is on the console team\. Manage it on the Team screen\./,
);
await expectError(
  "a ticket can only go to a current team member",
  () => svc(`SELECT public.support_check_assignee($1)`, [NEW]),
  /Pick a current team member\./,
);

const NULLFLAG = id(950);
await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${NULLFLAG}', 'nf@example.com')`);
await expectError(
  "a missing code flag counts as no code",
  () => svc(`SELECT public.staff_add_member($1, $2, $3, NULL)`, [A1, NULLFLAG, R.admin]),
  /Enter your two-step code/,
);

for (const role of ["anon", "authenticated"]) {
  for (const call of [
    `staff_list_roles()`,
    `staff_create_role('${A1}', 'X', NULL, ARRAY['dashboard.view'], true)`,
    `staff_set_member_role('${A1}', '${SALES}', '${R.sales}', false)`,
    `staff_remove_member('${A1}', '${SALES}')`,
  ]) {
    await expectError(
      `only service_role can run ${call.split("(")[0]} (${role})`,
      () => as(role, () => q(`SELECT * FROM public.${call}`)),
      /permission denied/,
    );
  }
}

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
