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
| `007-crm-export.sql`        | Phase 3b review fix: the export with contact details comes back as one value with its true total, so the API's row cap can't cut it short unnoticed. Adds one function. |
| `008-account-actions.sql`   | Phase 4: deletion request lists, blockers and counts; processing a request through LINARA's `process_account_deletion` with the CRM forgetting the person in the same transaction (D36); the Users list's suspended filter. Functions only. |
| `009-account-actions-fixes.sql` | Phase 4 review fix: a console admin's own deletion request is a blocker and is refused, so it can't delete an admin or their console role. Replaces two functions. |
| `010-support.sql`           | Phase 5: `support_tickets` and `support_ticket_notes` (RLS on, no app-role access), list, detail and counts, writes that record themselves in the audit log (D37); a processed deletion also clears that person's tickets. |
| `011-support-fixes.sql`     | Phase 5 review fixes: a ticket can only be assigned to a current admin; a user and a contact asked for together list the tickets linked to either. Run after 010. |
| `012-operations.sql`       | Phase 6: payout problems (latest attempt per payslip, no amounts), their counts, and AI usage for the last 48 hours with limit hits (D38). Reads only. Run after 011. |
| `013-roles.sql`            | Phase 7: `staff_role_defs` with four locked presets and custom roles, one role per member (existing admins become Admin), and team and role changes that enforce D39 and record themselves. Replaces `staff_touch_session` and `staff_list_admins`. Run after 012. |
| `014-roles-fixes.sql`      | Phase 7 review fixes: the table refuses `team.manage` on a custom role, only the admin and mods presets manage the team, a missing code flag counts as no code, and the code covers creating a custom role and giving admin, mods or a custom role (spec 0.19), and the Team screen wording in the deletion and assignee messages (spec 0.20). Replaces six functions with the same signatures, and `staff_create_role` (gains `p_code_checked`). Run after 013. |
| `017-app-mismatch-fixes.sql` | Moves the console to the app's rule for six figures: disputed direct payments become a payout problem, the Users role filter and "and N more", household task counts, the dashboard's daily done chart, and deletion blockers. Replaces eight functions with the same signatures. Run after 016. |

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
   insert into public.staff_roles (user_id, role_id)
   select u.id, d.id from auth.users u, public.staff_role_defs d
   where u.email = 'admin-email@example.com' and d.preset = 'admin';
   ```

   Expected: "Success. 1 row affected". Before `013-roles.sql`, use
   `(user_id, role)` with `'admin'` instead. Every later member is added from
   the console's Team screen.

## Invite email (once per Supabase project)

Supabase sends the invite when someone is added on the Team screen (FR-TM-2).

1. **Authentication > Email Templates > Invite user.** Subject: `You're invited to
   the Linara Business Console`. Body: paste `email-templates/invite.html` as is.
   Only the console sends Supabase invites (LINARA itself only sends password
   resets), so this changes nothing in the main app.
   The template reads `invite_role`, `invite_permissions`, `invited_by` and
   `invite_environment`, which the console passes with each invite. They're kept
   on the new login's metadata but never used for access (the role is in
   `staff_roles`).
2. **Authentication > Email > link expiry:** set to `86400` (24 hours, FR-TM-2).
   This setting covers every email link on the project, including LINARA's
   password resets.
3. **Delivery:** Supabase's built-in sender only reaches the project's team
   members' addresses, a few emails an hour. Real invites need custom SMTP
   (Authentication > Email > SMTP settings), which waits on OQ-13.

## Tests

`tests/` runs each file against PGlite (`stub-main-app.sql` stands in for the main-app tables Phase 2 reads) with `bun run test:sql`. Rules: every
table has RLS on with no policies and no privileges for `anon` or
`authenticated` (S-27).
