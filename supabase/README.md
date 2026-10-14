# supabase/

SQL for the console's **own** tables only (spec D7, §8). Nothing here changes a
main-app table, policy or function, except the grant D12 allows if it turns out
to be needed.

- Files are applied by hand in the SQL editor: development, then staging, then
  production.
- Tables are prefixed `staff_`, `crm_` or `support_`, with RLS on, no policies,
  and no privileges for `anon` or `authenticated` (S-27).
- `tests/` holds PGlite tests, set up the same way as `../LINARA/supabase/tests`.

The first tables (`staff_roles`, `staff_audit_log`, `staff_sign_in_attempts`)
arrive with Phase 1.
