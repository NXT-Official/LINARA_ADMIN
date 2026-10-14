// Runs 001-staff-foundation.sql against a real Postgres (PGlite): the console's
// tables are closed to the app roles, the audit log is append-only, and the
// server-key-only functions do what Phase 1 relies on (spec §8, D27, D28, D30, D31).
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
const one = async (sql, params) => (await q(sql, params))[0];
const check = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`,
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

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const H = "00000000-0000-0000-0000-00000000000c"; // has a household profile
const S1 = "10000000-0000-0000-0000-000000000001";
const S2 = "10000000-0000-0000-0000-000000000002";

await db.exec(readFileSync(resolve(HERE, "stub-supabase.sql"), "utf8"));
await db.exec(readFileSync(resolve(REPO, "001-staff-foundation.sql"), "utf8"));
await db.exec(`
  INSERT INTO auth.users (id, email, last_sign_in_at) VALUES
    ('${A}', 'admin@example.com', now()),
    ('${B}', 'second@example.com', NULL),
    ('${H}', 'parent@example.com', NULL);
  INSERT INTO public.user_profiles (id) VALUES ('${H}');
`);

const TABLES = ["staff_roles", "staff_audit_log", "staff_sign_in_attempts", "staff_sessions"];
const FUNCTIONS = [
  `staff_end_sessions('${A}')`,
  `staff_lookup_user('x@example.com')`,
  `staff_record_attempt(ARRAY['k'], '15 minutes')`,
  `staff_touch_session('${S1}', '${A}')`,
  `staff_start_session('${S1}', '${A}')`,
  `staff_list_admins()`,
];

// --- The app roles can't reach the console's tables (S-27) ---------------------
for (const role of ["authenticated", "anon"]) {
  for (const t of TABLES) {
    await expectError(
      `${role} can't read ${t}`,
      () => as(role, () => q(`SELECT * FROM public.${t}`)),
      /permission denied/,
    );
    await expectError(
      `${role} can't write ${t}`,
      () => as(role, () => q(`INSERT INTO public.${t} DEFAULT VALUES`)),
      /permission denied/,
    );
  }
  for (const f of FUNCTIONS) {
    await expectError(
      `${role} can't run ${f.split("(")[0]}`,
      () => as(role, () => q(`SELECT * FROM public.${f}`)),
      /permission denied for function/,
    );
  }
}

// --- Audit log is append-only (S-28) -------------------------------------------
await q(
  `INSERT INTO public.staff_audit_log (actor_user_id, action, target_type, target_id)
   VALUES ($1, 'staff.added', 'staff', $2)`,
  [A, B],
);
await expectError(
  "audit log rejects UPDATE",
  () => q("UPDATE public.staff_audit_log SET action = 'x'"),
  /append-only/,
);
await expectError(
  "audit log rejects DELETE",
  () => q("DELETE FROM public.staff_audit_log"),
  /append-only/,
);
await expectError(
  "audit log rejects TRUNCATE",
  () => q("TRUNCATE public.staff_audit_log"),
  /append-only/,
);

// --- v1 has only the admin role (D15) -------------------------------------------
await expectError(
  "role check allows only admin",
  () => q(`INSERT INTO public.staff_roles (user_id, role) VALUES ($1, 'sales')`, [B]),
  /check constraint/,
);
await q(`INSERT INTO public.staff_roles (user_id, role) VALUES ($1, 'admin')`, [A]);

// --- staff_end_sessions (D28, FR-TM-3) -------------------------------------------
await db.exec(`
  INSERT INTO auth.sessions (user_id) VALUES ('${A}'), ('${A}'), ('${B}');
  INSERT INTO public.staff_sessions (session_id, user_id) VALUES
    (gen_random_uuid(), '${A}'), (gen_random_uuid(), '${A}'), (gen_random_uuid(), '${B}');
`);
const ended = await as("service_role", () => one(`SELECT public.staff_end_sessions($1) AS n`, [A]));
const left = await one(
  `SELECT (SELECT count(*) FROM auth.sessions WHERE user_id = $1)::int AS a_auth,
          (SELECT count(*) FROM public.staff_sessions WHERE user_id = $1)::int AS a_staff,
          (SELECT count(*) FROM auth.sessions WHERE user_id = $2)::int AS b_auth,
          (SELECT count(*) FROM public.staff_sessions WHERE user_id = $2)::int AS b_staff`,
  [A, B],
);
check(
  "staff_end_sessions clears auth and console sessions",
  ended.n === 2 &&
    left.a_auth === 0 &&
    left.a_staff === 0 &&
    left.b_auth === 1 &&
    left.b_staff === 1,
  { ended: ended.n, ...left },
);

// --- staff_lookup_user (D28, §4.1) -----------------------------------------------
const found = await as("service_role", () =>
  q(`SELECT * FROM public.staff_lookup_user('Admin@Example.com')`),
);
const household = await as("service_role", () =>
  q(`SELECT * FROM public.staff_lookup_user('parent@example.com')`),
);
const nobody = await as("service_role", () =>
  q(`SELECT * FROM public.staff_lookup_user('nobody@example.com')`),
);
check(
  "staff_lookup_user ignores case and flags household accounts",
  found.length === 1 &&
    found[0].user_id === A &&
    found[0].has_household_profile === false &&
    household[0]?.has_household_profile === true &&
    nobody.length === 0,
  { found, household, nobody },
);

// --- staff_record_attempt (D30) --------------------------------------------------
let counts;
for (let i = 0; i < 3; i++) {
  counts = await as("service_role", () =>
    q(`SELECT * FROM public.staff_record_attempt(ARRAY['e:x','ip:y'], '15 minutes')`),
  );
}
await q(
  `INSERT INTO public.staff_sign_in_attempts (key, at) VALUES ('e:x', now() - interval '20 minutes')`,
);
const after = await as("service_role", () =>
  q(`SELECT * FROM public.staff_record_attempt(ARRAY['e:x'], '15 minutes')`),
);
const byKey = Object.fromEntries(counts.map((r) => [r.key, r.attempts]));
check(
  "staff_record_attempt counts inside the window",
  byKey["e:x"] === 3 && byKey["ip:y"] === 3 && after[0].attempts === 4,
  { byKey, after },
);

// Pruning runs on about one call in fifty: find a seed whose next random() is under 0.02.
let seed = null;
for (let s = 0; s < 1 && seed === null; s += 0.001) {
  const r = await one(`SELECT setseed($1), random() AS r`, [s]);
  if (r.r < 0.02) seed = s;
}
await q(
  `INSERT INTO public.staff_sign_in_attempts (key, at) VALUES ('old', now() - interval '2 days')`,
);
await q(`SELECT setseed($1)`, [seed]);
await as("service_role", () =>
  q(`SELECT * FROM public.staff_record_attempt(ARRAY['z'], '15 minutes')`),
);
const old = await one(
  `SELECT count(*)::int AS n FROM public.staff_sign_in_attempts WHERE key = 'old'`,
);
check("staff_record_attempt prunes day-old rows when it samples", seed !== null && old.n === 0, {
  seed,
  old: old.n,
});

// --- staff_touch_session (D31) ---------------------------------------------------
await q(
  `INSERT INTO public.staff_sessions (session_id, user_id, created_at, last_seen_at)
   VALUES ($1, $2, now() - interval '1 hour', now() - interval '10 minutes')`,
  [S1, A],
);
const before = await one(`SELECT last_seen_at FROM public.staff_sessions WHERE session_id = $1`, [
  S1,
]);
const touched = await as("service_role", () =>
  q(`SELECT * FROM public.staff_touch_session($1, $2)`, [S1, A]),
);
const now1 = await one(
  `SELECT extract(epoch FROM now() - last_seen_at) AS age FROM public.staff_sessions WHERE session_id = $1`,
  [S1],
);
check(
  "staff_touch_session returns the role and the previous activity",
  touched.length === 1 &&
    touched[0].role === "admin" &&
    new Date(touched[0].last_seen_at).getTime() === new Date(before.last_seen_at).getTime() &&
    Number(now1.age) < 5,
  { touched, age: now1.age },
);

await q(
  `UPDATE public.staff_sessions SET last_seen_at = now() - interval '20 seconds' WHERE session_id = $1`,
  [S1],
);
const v1 = await one(`SELECT xmin::text AS x FROM public.staff_sessions WHERE session_id = $1`, [
  S1,
]);
await as("service_role", () => q(`SELECT * FROM public.staff_touch_session($1, $2)`, [S1, A]));
const v2 = await one(`SELECT xmin::text AS x FROM public.staff_sessions WHERE session_id = $1`, [
  S1,
]);
check("staff_touch_session skips writes within a minute", v1.x === v2.x, { v1, v2 });

const wrongUser = await as("service_role", () =>
  q(`SELECT * FROM public.staff_touch_session($1, $2)`, [S1, B]),
);
check("staff_touch_session ignores another user's session", wrongUser.length === 0, wrongUser);

await q(`DELETE FROM public.staff_roles WHERE user_id = $1`, [A]);
const removed = await as("service_role", () =>
  q(`SELECT * FROM public.staff_touch_session($1, $2)`, [S1, A]),
);
check("staff_touch_session refuses a removed admin", removed.length === 0, removed);
await q(`INSERT INTO public.staff_roles (user_id, role) VALUES ($1, 'admin')`, [A]);

// --- staff_start_session (D27) ---------------------------------------------------
await q(`DELETE FROM public.staff_sessions`);
await q(
  `INSERT INTO public.staff_sessions (session_id, user_id, created_at) VALUES
     (gen_random_uuid(), $1, now() - interval '13 hours'),
     (gen_random_uuid(), $1, now() - interval '11 hours')`,
  [A],
);
await as("service_role", () => q(`SELECT public.staff_start_session($1, $2)`, [S2, A]));
await as("service_role", () => q(`SELECT public.staff_start_session($1, $2)`, [S2, A])); // repeat is harmless
const sessions = await q(`SELECT created_at FROM public.staff_sessions ORDER BY created_at`);
check(
  "staff_start_session prunes expired sessions",
  sessions.length === 2,
  sessions.map((s) => s.created_at),
);

// --- staff_list_admins (D31) -----------------------------------------------------
await q(`INSERT INTO public.staff_roles (user_id, role) VALUES ($1, 'admin')`, [B]);
await q(
  `INSERT INTO auth.mfa_factors (user_id, factor_type, status) VALUES
     ($1, 'totp', 'verified'), ($2, 'totp', 'unverified')`,
  [A, B],
);
const admins = await as("service_role", () => q(`SELECT * FROM public.staff_list_admins()`));
const two = Object.fromEntries(admins.map((a) => [a.email, a.two_step_set_up]));
check(
  "staff_list_admins is one row per admin",
  admins.length === 2 && two["admin@example.com"] === true && two["second@example.com"] === false,
  admins,
);

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
