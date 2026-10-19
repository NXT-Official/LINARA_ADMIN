-- LINARA_ADMIN, Phase 8 — business permissions. Apply after 014.
-- Spec: 2026-10-19-sell-linara-design.md (plans, billing, finance, FAQs).
--
-- Apply by hand in the Supabase SQL editor: linara dev first. One transaction.
-- 1. staff_known_permissions() gains billing.view, billing.manage, finance.view
--    and faq.manage (16 -> 20). The role table's CHECK calls this function, so
--    replacing the body is all it takes; same signature, so grants stay.
-- 2. Presets: admin and mods hold all 20. Sales and support gain billing.view.
--    Safe to run twice: nothing is added when it is already there.
-- Nothing here touches a main-app table.

BEGIN;

CREATE OR REPLACE FUNCTION public.staff_known_permissions() RETURNS TEXT[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT ARRAY['dashboard.view', 'crm.view', 'crm.write', 'crm.export', 'users.view',
                 'households.view', 'users.suspend', 'deletions.view', 'deletions.process',
                 'support.view', 'support.write', 'pay.view', 'payouts.view', 'ai.view',
                 'audit.view', 'team.manage',
                 'billing.view', 'billing.manage', 'finance.view', 'faq.manage']
$$;

UPDATE public.staff_role_defs
   SET permissions = public.staff_sort_permissions(public.staff_known_permissions())
 WHERE preset IN ('admin', 'mods');

UPDATE public.staff_role_defs
   SET permissions = public.staff_sort_permissions(permissions || ARRAY['billing.view'])
 WHERE preset IN ('sales', 'support')
   AND NOT 'billing.view' = ANY (permissions);

COMMIT;
