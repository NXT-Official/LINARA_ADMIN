// Runs 012-operations.sql against a real Postgres (PGlite): payout problems
// come from each payslip's latest attempt and never carry an amount, AI usage
// covers the 48 hours before now, and limit hits follow D38. The functions
// read only (FR-PO-1, FR-PO-2, FR-AI-1, FR-AI-2, FR-DB-6, S-17, D38).
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
]) {
  await db.exec(readFileSync(resolve(REPO, file), "utf8"));
}

const NOW = "2026-10-16T12:00:00Z";
const H = id(11);
const HP = id(41);
const AMOUNT = "4321.50";

// --- payouts fixtures: one payslip per case, attempts relative to NOW --------------------
const PS = {
  failed: id(101),
  cancelled: id(102),
  unclear: id(103),
  stuck: id(104),
  sendingNew: id(105),
  noAnswer: id(106),
  acceptedNew: id(107),
  fixed: id(108),
  ok: id(109),
};
await db.exec(`
  INSERT INTO public.households (id, name) VALUES ('${H}', 'Reyes home');
  INSERT INTO public.helper_profiles (id, household_id, name, status)
    VALUES ('${HP}', '${H}', 'Nena Helper', 'ACTIVE');
  INSERT INTO public.payslips (id, helper_id, cutoff_start, cutoff_end, net_pay)
    SELECT v, '${HP}', DATE '2026-10-01' + i::int, DATE '2026-10-01' + i::int, ${AMOUNT}
    FROM unnest(ARRAY['${Object.values(PS).join("','")}']::uuid[]) WITH ORDINALITY AS t(v, i);
`);
const attempt = (payslip, n, status, ago, reason = null) =>
  q(
    `INSERT INTO public.payout_attempts
       (payslip_id, attempt_number, reference_id, status, failure_reason, amount_sent, channel_code, created_at)
     VALUES ($1, $2, gen_random_uuid()::text, $3, $4, ${AMOUNT}, 'PH_GCASH', $5::timestamptz - $6::interval)
     RETURNING id`,
    [payslip, n, status, reason, NOW, ago],
  ).then((r) => r[0].id);
const AT = {
  failed: await attempt(PS.failed, 1, "failed", "3 hours", "<script>alert(1)</script> Nena"),
  cancelled: await attempt(PS.cancelled, 1, "cancelled", "4 hours"),
  unclear: await attempt(PS.unclear, 1, "ambiguous", "5 hours"),
  stuck: await attempt(PS.stuck, 1, "sending", "2 hours"),
  noAnswer: await attempt(PS.noAnswer, 1, "accepted", "25 hours"),
};
await attempt(PS.sendingNew, 1, "sending", "10 minutes");
await attempt(PS.acceptedNew, 1, "accepted", "2 hours");
await attempt(PS.fixed, 1, "failed", "6 hours", "Account closed");
await attempt(PS.fixed, 2, "succeeded", "1 hour");
await attempt(PS.ok, 1, "succeeded", "7 hours");

// --- AI fixtures ------------------------------------------------------------------------
const [OLD, U59, U61, U60, UDAY, UB] = [id(201), id(202), id(203), id(204), id(205), id(206)];
const SMALL = Array.from({ length: 8 }, (_, i) => id(211 + i));
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${U60}', 'sixty@example.com'), ('${UDAY}', 'day@example.com');
  INSERT INTO public.user_profiles (id, full_name, user_type) VALUES
    ('${U60}', 'Sixty User', 'primary_manager'), ('${UDAY}', 'Day User', 'co_manager');
`);
// p_fn, user, count, first call ago, step between calls
const calls = (user, fn, n, startAgo, step) =>
  q(
    `INSERT INTO public.ai_calls (user_id, fn, at)
     SELECT $1, $2, $3::timestamptz - $4::interval + (i * $5::interval) FROM generate_series(0, $6 - 1) i`,
    [user, fn, NOW, startAgo, step, n],
  );
await calls(OLD, "route-utos", 5, "3 days", "1 minute");
await calls(U59, "route-utos", 59, "10 hours", "50 seconds");
// 60 calls spread over exactly 61 minutes: no 60 of them fit in one hour.
await calls(U61, "route-utos", 60, "9 hours", `${(61 * 60) / 59} seconds`);
// 60 calls in 59 minutes: the 60th, 8h - 59m ago, is the hit.
await calls(U60, "generate-sop", 60, "8 hours", "1 minute");
// 300 calls across three features over 20 hours: 15 an hour, no hourly hit.
for (const [k, fn] of ["route-utos", "parse-scheduler", "simplify-sop"].entries()) {
  await q(
    `INSERT INTO public.ai_calls (user_id, fn, at)
     SELECT $1, $2, $3::timestamptz - interval '20 hours' + ((i * 3 + $4) * interval '4 minutes')
     FROM generate_series(0, 99) i`,
    [UDAY, fn, NOW, k],
  );
}
await calls(UB, "transcribe-notes", 2, "30 hours", "1 minute");
for (const [i, u] of SMALL.entries())
  await calls(u, "promote-voice-task", i + 1, "2 hours", "1 minute");

const tableCounts = async () =>
  q(`SELECT (SELECT count(*) FROM public.payslips) ps, (SELECT count(*) FROM public.payout_attempts) pa,
            (SELECT count(*) FROM public.ai_calls) ai, (SELECT count(*) FROM public.staff_audit_log) au`);
const countsBefore = await tableCounts();

// --- payout problems (FR-PO-1, D38) -----------------------------------------------------
const list = (kind = null, limit = 50, offset = 0) =>
  svc(`SELECT * FROM public.staff_list_payout_problems($1, $2, $3, $4)`, [
    NOW,
    kind,
    limit,
    offset,
  ]);
const all = await list();
const kindOf = (a) => all.find((r) => r.attempt_id === a)?.kind;
check(
  "each kind is found",
  kindOf(AT.failed) === "failed" &&
    kindOf(AT.cancelled) === "cancelled" &&
    kindOf(AT.unclear) === "unclear" &&
    kindOf(AT.stuck) === "stuck" &&
    kindOf(AT.noAnswer) === "no_answer",
  all.map((r) => r.kind),
);
const payslipsShown = new Set(all.map((r) => r.payslip_id));
check("sending under an hour is not stuck", !payslipsShown.has(PS.sendingNew));
check("accepted under 24 hours is not a problem", !payslipsShown.has(PS.acceptedNew));
check("a later attempt hides an earlier failure", !payslipsShown.has(PS.fixed));
check("succeeded is never a problem", !payslipsShown.has(PS.ok) && all.length === 5, all.length);
const row = all.find((r) => r.attempt_id === AT.failed);
check(
  "a row names the helper, household and reason",
  row.helper_id === HP &&
    row.helper_name === "Nena Helper" &&
    row.household_id === H &&
    row.household_name === "Reyes home" &&
    row.failure_reason.startsWith("<script>") &&
    row.channel_code === "PH_GCASH" &&
    row.attempt_number === 1,
  row,
);
check(
  "newest first",
  all.map((r) => r.attempt_id).join() ===
    [AT.stuck, AT.failed, AT.cancelled, AT.unclear, AT.noAnswer].join(),
  all.map((r) => r.kind),
);
const stuckOnly = await list("stuck");
const page2 = await list(null, 2, 2);
check(
  "kind filter and paging",
  stuckOnly.length === 1 &&
    stuckOnly[0].attempt_id === AT.stuck &&
    page2.length === 2 &&
    page2[0].attempt_id === AT.cancelled,
  { stuckOnly, page2 },
);
await expectError("an unknown kind is refused", () => list("succeeded"), /kind/i);

const counts = (await svc(`SELECT public.staff_payout_counts($1) AS c`, [NOW]))[0].c;
check(
  "counts match the list",
  counts.failed === 1 &&
    counts.cancelled === 1 &&
    counts.unclear === 1 &&
    counts.stuck === 1 &&
    counts.no_answer === 1,
  counts,
);

// --- AI usage (FR-AI-1, FR-AI-2) --------------------------------------------------------
const usage = (await svc(`SELECT public.staff_ai_usage($1) AS u`, [NOW]))[0].u;
const ids = (xs) => xs.map((x) => x.user_id);
check(
  "old rows outside the window are ignored",
  !ids(usage.top_users).includes(OLD) &&
    !ids(usage.limit_hits).includes(OLD) &&
    usage.hourly.reduce((s, h) => s + h.calls, 0) === 59 + 60 + 60 + 300 + 2 + 36,
  usage.hourly.reduce((s, h) => s + h.calls, 0),
);
const notes = usage.hourly.filter((h) => h.fn === "transcribe-notes");
check(
  "hourly buckets per feature",
  notes.length === 1 &&
    notes[0].calls === 2 &&
    new Date(notes[0].hour).toISOString() === "2026-10-15T06:00:00.000Z",
  notes,
);
check(
  "calls in 24 hours leave out older ones",
  usage.calls_24h === 59 + 60 + 60 + 300 + 36,
  usage.calls_24h,
);
check(
  "top users ordered and capped at 10",
  usage.top_users.length === 10 &&
    usage.top_users[0].user_id === UDAY &&
    usage.top_users[0].name === "Day User" &&
    usage.top_users[0].calls === 300 &&
    usage.top_users[9].calls === 3 &&
    !ids(usage.top_users).includes(UB),
  usage.top_users,
);
const hits = usage.limit_hits;
const hourly = hits.filter((h) => h.kind === "hourly");
const daily = hits.filter((h) => h.kind === "daily");
check(
  "limit hits at the boundary",
  hourly.length === 1 &&
    hourly[0].user_id === U60 &&
    hourly[0].fn === "generate-sop" &&
    hourly[0].name === "Sixty User" &&
    new Date(hourly[0].at).toISOString() === "2026-10-16T04:59:00.000Z" &&
    daily.length === 1 &&
    daily[0].user_id === UDAY &&
    daily[0].fn === null,
  hits,
);

// --- pay never leaves, nothing is written (S-17, FR-PO-2) -------------------------------
const text = JSON.stringify([all, counts, usage]);
check(
  "no amount in any result",
  !/amount/i.test(text) && !text.includes(AMOUNT) && !text.includes("4321"),
);
const countsAfter = await tableCounts();
check("they write nothing", JSON.stringify(countsBefore) === JSON.stringify(countsAfter), {
  countsBefore,
  countsAfter,
});

for (const role of ["anon", "authenticated"]) {
  for (const call of [
    `staff_list_payout_problems('${NOW}', NULL, 50, 0)`,
    `staff_payout_counts('${NOW}')`,
    `staff_ai_usage('${NOW}')`,
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
