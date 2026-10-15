-- LINARA_ADMIN, Phase 4: account actions. Apply after 007-crm-export.sql.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md §5.3, §5.5, FR-DB-4, S-23, D12, D36.
--
-- Apply by hand in the Supabase SQL editor: linara dev first. One transaction.
-- Adds read functions for deletion requests, the console's deletion step
-- (which calls LINARA's process_account_deletion and makes the CRM forget the
-- person in the same transaction), and the Users list's suspended filter.
-- Creates functions only. The only main-app change is the one LINARA's own
-- process_account_deletion makes when an admin processes a request.

BEGIN;

-- ---------------------------------------------------------------- Deletion requests

-- What process_account_deletion would refuse on, so the admin sees it before
-- entering a code (FR-DL-2). Mirrors add-household-managers.sql's two checks.
CREATE FUNCTION public.staff_deletion_blockers(p_user_id UUID) RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT array_remove(ARRAY[
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

-- Pending requests by due date, or finished and withdrawn ones newest first
-- (FR-DL-1, FR-DL-7). Due is the request plus 30 days; days left are Manila days.
CREATE FUNCTION public.staff_list_deletion_requests(
    p_view TEXT, p_limit INT, p_offset INT, p_now TIMESTAMPTZ
) RETURNS TABLE (request_id UUID, user_id UUID, full_name TEXT, user_type TEXT, status TEXT,
                 requested_at TIMESTAMPTZ, due_at TIMESTAMPTZ, days_left INT,
                 processed_at TIMESTAMPTZ, blockers TEXT[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT r.id, r.user_id, p.full_name, coalesce(p.user_type, r.user_type), r.status,
           r.requested_at, r.requested_at + INTERVAL '30 days',
           ((r.requested_at + INTERVAL '30 days') AT TIME ZONE 'Asia/Manila')::DATE
               - (p_now AT TIME ZONE 'Asia/Manila')::DATE,
           r.processed_at,
           CASE WHEN r.status = 'pending' THEN public.staff_deletion_blockers(r.user_id)
                ELSE '{}'::TEXT[] END
    FROM public.account_deletion_requests r
    LEFT JOIN public.user_profiles p ON p.id = r.user_id
    WHERE (p_view = 'pending' AND r.status = 'pending')
       OR (p_view = 'history' AND r.status IN ('done', 'cancelled'))
    ORDER BY
        CASE WHEN p_view = 'pending' THEN r.requested_at END ASC,
        CASE WHEN p_view = 'history' THEN coalesce(r.processed_at, r.requested_at) END DESC,
        r.id
    LIMIT p_limit OFFSET p_offset
$$;

-- The dashboard's deletion figures (FR-DB-4): due soon is 0 to 7 days left.
CREATE FUNCTION public.staff_deletion_counts(p_now TIMESTAMPTZ) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH pending AS (
        SELECT ((r.requested_at + INTERVAL '30 days') AT TIME ZONE 'Asia/Manila')::DATE
                   - (p_now AT TIME ZONE 'Asia/Manila')::DATE AS days_left
        FROM public.account_deletion_requests r
        WHERE r.status = 'pending'
    )
    SELECT jsonb_build_object(
        'pending', (SELECT count(*)::INT FROM pending),
        'due_soon', (SELECT count(*)::INT FROM pending WHERE days_left BETWEEN 0 AND 7),
        'overdue', (SELECT count(*)::INT FROM pending WHERE days_left < 0)
    )
$$;

-- Processes one request (FR-DL-3 to FR-DL-6, S-23, D36): LINARA's own
-- process_account_deletion, then the CRM forgets the person, then the audit
-- entry, all in this one transaction. If LINARA refuses, its message reaches
-- the admin as it is and nothing here has changed. Runs as its owner, like
-- process_account_deletion, so no grant on that function is needed (D12).
CREATE FUNCTION public.staff_process_deletion(p_actor UUID, p_request_id UUID) RETURNS JSONB
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

-- ---------------------------------------------------------------- Suspension

-- A console admin is managed on the Admins screen, never suspended from Users.
CREATE FUNCTION public.staff_is_console_admin(p_user_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (SELECT 1 FROM public.staff_roles s WHERE s.user_id = p_user_id)
$$;

-- staff_list_users (002) with a suspended filter: null lists everyone.
CREATE FUNCTION public.staff_find_users(
    p_search TEXT, p_kind TEXT, p_suspended BOOLEAN, p_limit INT, p_offset INT
) RETURNS TABLE (user_id UUID, full_name TEXT, email TEXT, user_type TEXT,
                 household_id UUID, household_name TEXT, household_count INT,
                 joined_at TIMESTAMPTZ, last_sign_in_at TIMESTAMPTZ, suspended BOOLEAN,
                 devices INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH
    term AS (
        SELECT public.staff_like_pattern(p_search) AS pattern,
               regexp_replace(coalesce(p_search, ''), '\D', '', 'g') AS digits
    ),
    page AS (
        SELECT p.id, p.full_name, u.email::TEXT AS email, p.user_type, p.household_id,
               u.created_at AS joined_at, u.last_sign_in_at,
               coalesce(u.banned_until > now(), false) AS suspended
        FROM public.user_profiles p
        JOIN auth.users u ON u.id = p.id
        CROSS JOIN term
        WHERE (p_kind IS NULL OR p.user_type = p_kind)
          AND (p_suspended IS NULL OR coalesce(u.banned_until > now(), false) = p_suspended)
          AND (p_search IS NULL
               OR p.full_name ILIKE term.pattern
               OR u.email ILIKE term.pattern
               OR (length(term.digits) >= 3 AND EXISTS (
                       SELECT 1 FROM public.helper_profiles hp
                       WHERE hp.user_id = p.id
                         AND regexp_replace(coalesce(hp.phone, ''), '\D', '', 'g')
                             LIKE '%' || term.digits || '%')))
        ORDER BY u.created_at DESC, p.id
        LIMIT p_limit OFFSET p_offset
    )
    SELECT pg.id, pg.full_name, pg.email, pg.user_type, pg.household_id, h.name,
           (SELECT count(*)::INT FROM (
                SELECT m.household_id FROM public.household_managers m WHERE m.user_id = pg.id
                UNION
                SELECT hp.household_id FROM public.helper_profiles hp WHERE hp.user_id = pg.id
                UNION
                SELECT hh.household_id FROM public.helper_households hh
                JOIN public.helper_profiles hp ON hp.id = hh.helper_id
                WHERE hp.user_id = pg.id
            ) homes),
           pg.joined_at, pg.last_sign_in_at, pg.suspended,
           (SELECT count(*)::INT FROM public.push_tokens pt WHERE pt.user_id = pg.id)
    FROM page pg
    LEFT JOIN public.households h ON h.id = pg.household_id
    ORDER BY pg.joined_at DESC, pg.id
$$;

-- ---------------------------------------------------------------- Privileges

REVOKE EXECUTE ON FUNCTION
    public.staff_deletion_blockers(UUID),
    public.staff_list_deletion_requests(TEXT, INT, INT, TIMESTAMPTZ),
    public.staff_deletion_counts(TIMESTAMPTZ),
    public.staff_process_deletion(UUID, UUID),
    public.staff_is_console_admin(UUID),
    public.staff_find_users(TEXT, TEXT, BOOLEAN, INT, INT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.staff_deletion_blockers(UUID),
    public.staff_list_deletion_requests(TEXT, INT, INT, TIMESTAMPTZ),
    public.staff_deletion_counts(TIMESTAMPTZ),
    public.staff_process_deletion(UUID, UUID),
    public.staff_is_console_admin(UUID),
    public.staff_find_users(TEXT, TEXT, BOOLEAN, INT, INT)
TO service_role;

COMMIT;
