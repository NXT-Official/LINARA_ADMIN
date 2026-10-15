-- LINARA_ADMIN, Phase 4 review fix. Apply after 008-account-actions.sql.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md FR-DL-2, D36.
--
-- Any signed-in account can file a deletion request (LINARA's
-- request_account_deletion), a console admin's too. Processing it would delete
-- that login and, through staff_roles' cascade, their console role: possibly
-- the last admin, or the admin clicking. A console admin's account is now a
-- blocker in the list and refused here, as suspension already is.
-- Replaces two functions with the same signatures; grants are kept.

BEGIN;

CREATE OR REPLACE FUNCTION public.staff_deletion_blockers(p_user_id UUID) RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT array_remove(ARRAY[
        CASE WHEN EXISTS (
            SELECT 1 FROM public.staff_roles s WHERE s.user_id = p_user_id
        ) THEN 'console_admin' END,
        CASE WHEN EXISTS (
            SELECT 1 FROM public.helper_profiles h
            WHERE h.user_id = p_user_id AND h.status = 'ACTIVE'
        ) THEN 'active_employment' END,
        CASE WHEN EXISTS (
            SELECT 1 FROM public.household_managers m
            WHERE m.user_id = p_user_id
              AND NOT EXISTS (SELECT 1 FROM public.household_managers o
                              WHERE o.household_id = m.household_id
                                AND o.user_id <> p_user_id)
              AND EXISTS (SELECT 1 FROM public.helper_profiles h
                          WHERE h.household_id = m.household_id AND h.status = 'ACTIVE')
        ) THEN 'last_manager_with_helpers' END
    ], NULL)
$$;

CREATE OR REPLACE FUNCTION public.staff_process_deletion(p_actor UUID, p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    r public.account_deletion_requests;
    v_kind TEXT;
    v_result JSONB;
    v_contacts UUID[];
BEGIN
    SELECT * INTO r FROM public.account_deletion_requests WHERE id = p_request_id FOR UPDATE;
    IF r.id IS NULL THEN RAISE EXCEPTION 'That request doesn''t exist.'; END IF;
    IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request is no longer pending.'; END IF;
    IF EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = r.user_id) THEN
        RAISE EXCEPTION 'This is a console admin''s account. Console admins are managed on the Admins screen.';
    END IF;

    SELECT coalesce(p.user_type, r.user_type) INTO v_kind
    FROM (SELECT 1) x LEFT JOIN public.user_profiles p ON p.id = r.user_id;

    IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.user_id) THEN
        v_result := public.process_account_deletion(r.user_id);
    ELSE
        -- The account is already gone (deleted by hand): just close the request.
        UPDATE public.account_deletion_requests
        SET status = 'done', processed_at = now(), note = NULL
        WHERE id = r.id;
        v_result := jsonb_build_object('user_id', r.user_id, 'account_missing', true);
    END IF;

    -- The CRM keeps the record for counts but forgets the person (D35's clearing).
    SELECT coalesce(array_agg(c.id), '{}') INTO v_contacts
    FROM public.crm_contacts c
    WHERE c.user_id = r.user_id AND c.anonymized_at IS NULL;
    UPDATE public.crm_contacts
    SET full_name = NULL, email = NULL, phone = NULL, tags = '{}', lost_reason = NULL,
        consent_basis = NULL, anonymized_at = now()
    WHERE id = ANY (v_contacts);
    UPDATE public.crm_activities SET body = NULL WHERE contact_id = ANY (v_contacts);
    UPDATE public.crm_follow_ups SET note = NULL WHERE contact_id = ANY (v_contacts);

    -- Ids only (FR-DL-5, S-22).
    INSERT INTO public.staff_audit_log (actor_user_id, action, target_type, target_id, metadata)
    VALUES (p_actor, 'deletion.processed', 'user', r.user_id::TEXT,
            jsonb_build_object('request_id', r.id, 'user_type', v_kind));
    RETURN v_result;
END $$;

COMMIT;
