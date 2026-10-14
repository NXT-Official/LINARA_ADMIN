# supabase/

SQL for the console's **own** tables only (spec D7, §8). Nothing here changes a
main-app table, policy or function. The functions that read or clear `auth`
rows are listed in spec D28.

## Files, in apply order

| File                        | What it adds                                                    |
| --------------------------- | --------------------------------------------------------------- |
| `001-staff-foundation.sql`  | `staff_roles`, `staff_audit_log`, `staff_sign_in_attempts`, `staff_sessions`, and the six server-key-only functions (Phase 1) |

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

`tests/` runs each file against PGlite with `bun run test:sql`. Rules: every
table has RLS on with no policies and no privileges for `anon` or
`authenticated` (S-27).
