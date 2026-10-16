-- LINARA Business Console: fixes to 010-support.sql from the Phase 5 review.
-- Run after 010. Safe to run more than once.
--
-- 1. A ticket can only be assigned to a current admin (FR-SP-4). Before this
--    any id was stored, so a ticket could sit with a removed admin or a user.
-- 2. Asking for a user and a saved contact together lists the tickets linked to
--    either, so one person's tickets show on both their user and contact pages
--    (FR-US-3, FR-CRM-12). Each on its own still matches exactly.

CREATE OR REPLACE FUNCTION public.support_list_tickets(
    p_search TEXT, p_status TEXT, p_assignee TEXT, p_category TEXT, p_priority TEXT,
    p_user_id UUID, p_household_id UUID, p_contact_id UUID, p_limit INT, p_offset INT
) RETURNS TABLE (ticket_id UUID, ref BIGINT, subject TEXT, channel TEXT, category TEXT,
                 priority TEXT, status TEXT, user_id UUID, household_id UUID, contact_id UUID,
                 contact TEXT, assignee_id UUID, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
                 resolved_at TIMESTAMPTZ, note_count INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH term AS (
        SELECT public.staff_like_pattern(p_search) AS pattern,
               substring(p_search FROM '^\s*(?:[Ll][Ii][Nn]-?)?(\d+)\s*$')::BIGINT AS number
    )
    SELECT t.id, t.ref, t.subject, t.channel, t.category, t.priority, t.status, t.user_id,
           t.household_id, t.contact_id, t.contact, t.assignee_id, t.created_at, t.updated_at,
           t.resolved_at,
           (SELECT count(*)::INT FROM public.support_ticket_notes n WHERE n.ticket_id = t.id)
    FROM public.support_tickets t CROSS JOIN term
    WHERE (p_status IS NULL
           OR (p_status = 'active' AND t.status IN ('open', 'pending'))
           OR t.status = p_status)
      AND (p_assignee IS NULL
           OR (p_assignee = 'unassigned' AND t.assignee_id IS NULL)
           OR t.assignee_id::TEXT = p_assignee)
      AND (p_category IS NULL OR t.category = p_category)
      AND (p_priority IS NULL OR t.priority = p_priority)
      AND ((p_user_id IS NULL AND p_contact_id IS NULL)
           OR t.user_id = p_user_id
           OR t.contact_id = p_contact_id)
      AND (p_household_id IS NULL OR t.household_id = p_household_id)
      AND (p_search IS NULL
           OR (term.number IS NOT NULL AND t.ref = term.number)
           OR (term.number IS NULL
               AND (t.subject ILIKE term.pattern OR t.contact ILIKE term.pattern)))
    ORDER BY (t.status IN ('open', 'pending') AND t.priority = 'high') DESC,
             t.updated_at DESC, t.id
    LIMIT p_limit OFFSET p_offset
$$;

-- Raises a plain message unless the id is null or a current admin's.
CREATE OR REPLACE FUNCTION public.support_check_assignee(p_assignee_id UUID) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_assignee_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.staff_roles WHERE user_id = p_assignee_id) THEN
        RAISE EXCEPTION 'Pick a current admin.';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.support_create_ticket(
    p_actor UUID, p_subject TEXT, p_body TEXT, p_channel TEXT, p_category TEXT,
    p_priority TEXT, p_contact TEXT, p_user_id UUID, p_household_id UUID, p_contact_id UUID,
    p_assignee_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_id UUID;
BEGIN
    PERFORM public.support_check_assignee(p_assignee_id);
    INSERT INTO public.support_tickets
        (subject, body, channel, category, priority, contact, user_id, household_id,
         contact_id, assignee_id, created_by)
    VALUES (p_subject, p_body, p_channel, p_category, coalesce(p_priority, 'normal'), p_contact,
            p_user_id, p_household_id, p_contact_id, p_assignee_id, p_actor)
    RETURNING id INTO v_id;
    PERFORM public.support_audit(p_actor, 'support.ticket_created', v_id,
        jsonb_build_object('category', p_category, 'priority', coalesce(p_priority, 'normal'),
                           'channel', p_channel, 'assignee_id', p_assignee_id));
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.support_assign(p_actor UUID, p_ticket_id UUID, p_assignee_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    t public.support_tickets := public.support_lock(p_ticket_id);
BEGIN
    IF t.assignee_id IS NOT DISTINCT FROM p_assignee_id THEN RETURN; END IF;
    PERFORM public.support_check_assignee(p_assignee_id);
    UPDATE public.support_tickets SET assignee_id = p_assignee_id, updated_at = now()
    WHERE id = t.id;
    PERFORM public.support_audit(p_actor, 'support.assigned', t.id,
        jsonb_build_object('assignee_id', p_assignee_id));
END $$;

-- Server key only, as in 010.
DO $$
DECLARE
    f TEXT;
BEGIN
    FOR f IN
        SELECT p.oid::REGPROCEDURE::TEXT
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('support_list_tickets', 'support_check_assignee',
                            'support_create_ticket', 'support_assign')
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END $$;
