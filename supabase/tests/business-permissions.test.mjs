// Runs 013, 014 and 015-business-permissions.sql against a real Postgres (PGlite):
// 20 known permissions, admin and mods hold all of them, sales and support gain
// billing.view only, a custom role can hold finance.view, and a second run of
// 015 changes nothing.
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

const FILES = [
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
const A1 = id(901);
for (const file of FILES) await db.exec(readFileSync(resolve(REPO, file), "utf8"));
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${A1}', 'a1@example.com');
  INSERT INTO public.staff_roles (user_id, role) VALUES ('${A1}', 'admin');
`);
await db.exec(readFileSync(resolve(REPO, "013-roles.sql"), "utf8"));
await db.exec(readFileSync(resolve(REPO, "014-roles-fixes.sql"), "utf8"));

const SQL_015 = readFileSync(resolve(REPO, "015-business-permissions.sql"), "utf8");
const presets = async () =>
  Object.fromEntries(
    (
      await q(
        `SELECT preset, permissions FROM public.staff_role_defs WHERE preset IS NOT NULL ORDER BY preset`,
      )
    ).map((r) => [r.preset, r.permissions]),
  );

const before = await presets();
await db.exec(SQL_015);
const once = await presets();
await db.exec(SQL_015);
const twice = await presets();

const known = (await q(`SELECT public.staff_known_permissions() AS p`))[0].p;
const NEW = ["billing.view", "billing.manage", "finance.view", "faq.manage"];
check("20 known permissions", known.length === 20 && new Set(known).size === 20, known);
check(
  "the four business keys are known",
  NEW.every((p) => known.includes(p)),
  known,
);
for (const p of ["admin", "mods"]) {
  check(
    `${p} holds all 20`,
    once[p].length === 20 && [...once[p]].sort().join() === [...known].sort().join(),
    once[p],
  );
}
for (const p of ["sales", "support"]) {
  check(`${p} gains billing.view`, once[p].includes("billing.view"), once[p]);
  check(`${p} lacks billing.manage`, !once[p].includes("billing.manage"), once[p]);
  check(
    `${p} keeps everything it had`,
    before[p].every((k) => once[p].includes(k)) && once[p].length === before[p].length + 1,
    { before: before[p], after: once[p] },
  );
}
check(
  "applying 015 twice leaves the presets unchanged",
  JSON.stringify(once) === JSON.stringify(twice),
  {
    once,
    twice,
  },
);

const rows = await q(`SELECT preset, permissions FROM public.staff_role_defs`);
check("every preset still satisfies the table rule", rows.length === 4, rows);

const created = await svc(`SELECT public.staff_create_role($1, $2, $3, $4, $5) AS id`, [
  A1,
  "Finance",
  null,
  ["dashboard.view", "finance.view"],
  true,
]);
const custom = (
  await q(`SELECT permissions FROM public.staff_role_defs WHERE id = $1`, [created[0].id])
)[0];
check("a custom role can hold finance.view", custom.permissions.includes("finance.view"), custom);

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
