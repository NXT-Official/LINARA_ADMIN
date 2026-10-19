// Runs 020-faq.sql against a real Postgres (PGlite): the public list shows only
// published entries, the table and every staff function are closed to the app
// roles, each write leaves an audit row with ids only, and the file applies twice.
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
  "015-business-permissions.sql",
  "020-faq.sql",
]) {
  await db.exec(readFileSync(resolve(REPO, file), "utf8"));
}

const A1 = id(900);
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${A1}', 'a1@example.com');
`);

const audits = () =>
  q(`SELECT action, target_type, target_id, metadata FROM public.staff_audit_log ORDER BY id`);
const publicList = async (role = "anon") =>
  (await as(role, () => q(`SELECT public.faq_public_list() AS l`)))[0].l;
const save = (entry) =>
  one(`SELECT public.faq_save($1, $2::jsonb) AS id`, [A1, JSON.stringify(entry)]).then((r) => r.id);

// --- closed to the app roles ----------------------------------------------------------
for (const role of ["anon", "authenticated"]) {
  await expectError(
    `${role} can't read faq_entries`,
    () => as(role, () => q(`SELECT * FROM public.faq_entries`)),
    /permission denied/,
  );
  await expectError(
    `${role} can't run faq_list`,
    () => as(role, () => q(`SELECT public.faq_list('${A1}')`)),
    /permission denied/,
  );
  await expectError(
    `${role} can't run faq_save`,
    () => as(role, () => q(`SELECT public.faq_save('${A1}', '{"question":"q","answer":"a"}')`)),
    /permission denied/,
  );
}

// --- draft, publish, delete -----------------------------------------------------------
check("public list starts empty", (await publicList()).length === 0);

const before = (await audits()).length;
const F1 = await save({ question: "How do I add a helper?", answer: "Open Helpers, tap Add." });
const draft = (await q(`SELECT * FROM public.faq_entries WHERE id = $1`, [F1]))[0];
check(
  "a new entry is a draft in General, stamped with the actor",
  draft.published === false && draft.category === "General" && draft.updated_by === A1,
  draft,
);
check("the public list still shows nothing", (await publicList()).length === 0);

await save({
  id: F1,
  question: "How do I add a helper?",
  answer: "Open Helpers, tap Add.",
  category: "Helpers",
  sort_order: 2,
  published: true,
});
const F2 = await save({ question: "Another", answer: "Yes", category: "Helpers", published: true });
await save({ question: "Hidden", answer: "Draft text", published: false });
for (const role of ["anon", "authenticated"]) {
  const list = await publicList(role);
  check(
    `${role} sees only published entries, in order, with the public keys`,
    list.length === 2 &&
      list[0].id === F2 &&
      list[1].id === F1 &&
      Object.keys(list[0]).sort().join() === "answer,category,id,question,sort_order",
    list,
  );
}
const staff = (await one(`SELECT public.faq_list($1) AS l`, [A1])).l;
check(
  "staff list includes drafts and the extra keys",
  staff.length === 3 && staff.every((e) => "published" in e && "updated_at" in e),
  staff,
);

await svc(`SELECT public.faq_delete($1, $2)`, [A1, F1]);
await svc(`SELECT public.faq_delete($1, $2)`, [A1, F2]);
check("deleted entries leave the public list", (await publicList()).length === 0);

const written = (await audits()).slice(before);
check(
  "every write left one audit row, ids and flags only",
  written.length === 6 &&
    written.filter((a) => a.action === "faq.saved").length === 4 &&
    written.filter((a) => a.action === "faq.deleted").length === 2 &&
    written.every((a) => a.target_type === "faq") &&
    !JSON.stringify(written).includes("helper"),
  written,
);

// --- refusals ---------------------------------------------------------------------------
await expectError(
  "a 201-character question is refused",
  () => save({ question: "q".repeat(201), answer: "a" }),
  /1 to 200 characters/,
);
await expectError(
  "an empty answer is refused",
  () => save({ question: "q", answer: "  " }),
  /1 to 4000 characters/,
);
await expectError(
  "a 41-character category is refused",
  () => save({ question: "q", answer: "a", category: "c".repeat(41) }),
  /1 to 40 characters/,
);
await expectError(
  "updating a missing entry is refused",
  () => save({ id: id(77), question: "q", answer: "a" }),
  /doesn't exist/,
);
await expectError(
  "deleting a missing entry is refused",
  () => svc(`SELECT public.faq_delete($1, $2)`, [A1, id(77)]),
  /doesn't exist/,
);

// --- applying the file again is clean ---------------------------------------------------
await save({ question: "Survives", answer: "Reapply", published: true });
await db.exec(readFileSync(resolve(REPO, "020-faq.sql"), "utf8"));
check("a second apply keeps the data", (await publicList()).length === 1);

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
