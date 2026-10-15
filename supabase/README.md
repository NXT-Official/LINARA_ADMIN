# supabase/

SQL for the console's **own** tables only (spec D7, §8). Nothing here changes a
main-app table, policy or function. The functions that read or clear `auth`
rows are listed in spec D28 and D33. The CRM's write rules are in D34.

## Files, in apply order

| File                        | What it adds                                                    |
| --------------------------- | --------------------------------------------------------------- |
| `001-staff-foundation.sql`  | `staff_roles`, `staff_audit_log`, `staff_sign_in_attempts`, `staff_sessions`, and the six server-key-only functions (Phase 1) |
| `002-visibility.sql`        | Seven server-key-only read functions for Dashboard, Users and Households (Phase 2). Creates functions only; no table changes. |
| `003-visibility-fixes.sql`  | Phase 2 review fixes: spawned repeating-task copies don't count as activity (D32), and the Households list and dashboard read tasks in one grouped pass. Replaces three functions; no table changes. |
| `004-crm.sql`               | Phase 3a CRM: `crm_contacts`, `crm_activities`, `crm_follow_ups` (RLS on, no app-role access), stage helpers, read functions, and write functions that record each change in the audit log in the same transaction (D34). |
| `005-crm-fixes.sql`         | Phase 3a review fix: opening one contact reads only that person's homes instead of every household and task. Replaces one function; no table changes. |
| `006-crm-data.sql`          | Phase 3b: CSV import (all or nothing, with consent basis), duplicate check, nightly lead retention (D35) scheduled with pg_cron as `crm-retention` at 02:15 Manila. Lets a follow-up note be cleared. |

Each file runs in one transaction: it applies completely or not at all.

## Applying a file

1. Supabase dashboard → **linara dev** (never linara prod until a release says so).
2. **SQL Editor** → **New query** → paste the whole file → **Run**.
3. Expected: "Success. No rows returned".

## The first admin (once per environment)

1. **Authentication → Users → Add user → Create new user.** Use an email only
   for the console, never one used for a Linara household (spec §4.1). Set a
   password and tick **Auto Confirm User**.
2. **SQL Editor**, with that email:

   ```sql
   insert into public.staff_roles (user_id, role)
   select id, 'admin' from auth.users where email = 'admin-email@example.com';
   ```

   Expected: "Success. 1 row affected". Every later admin is added from the
   console's Admins screen.

## Tests

`tests/` runs each file against PGlite (`stub-main-app.sql` stands in for the main-app tables Phase 2 reads) with `bun run test:sql`. Rules: every
table has RLS on with no policies and no privileges for `anon` or
`authenticated` (S-27).
