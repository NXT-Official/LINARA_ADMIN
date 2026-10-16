-- LINARA_ADMIN, Phase 5: support tickets. Apply after 009-account-actions-fixes.sql.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md §5.6, §8.2, FR-DB-5, FR-DL-6, S-23, D37.
--
-- Apply by hand in the Supabase SQL editor: linara dev first. One transaction.
-- Adds the console's support tables and their functions; every write records
-- itself in the audit log in the same transaction (D37), with ids and labels
-- only. Also replaces staff_process_deletion so a processed deletion clears
-- that person's tickets too. Nothing here touches a main-app table.

BEGIN;

-- ---------------------------------------------------------------- Tables

CREATE TABLE public.support_tickets (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref           BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 1000) UNIQUE,
    subject       TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 160),
    body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
    channel       TEXT NOT NULL CHECK (channel IN ('messenger', 'viber', 'email', 'phone', 'other')),
    category      TEXT NOT NULL CHECK (category IN ('account', 'tasks', 'pay', 'payout', 'app_bug',
                                                    'deletion', 'other')),
    priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
    user_id       UUID,
    household_id  UUID,
    contact_id    UUID REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
    contact       TEXT CHECK (contact IS NULL OR char_length(contact) <= 120),
    assignee_id   UUID,
    created_by    UUID NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at   TIMESTAMPTZ
);
CREATE INDEX support_tickets_status_idx ON public.support_tickets (status);
CREATE INDEX support_tickets_assignee_idx ON public.support_tickets (assignee_id);
CREATE INDEX support_tickets_user_idx ON public.support_tickets (user_id);
CREATE INDEX support_tickets_household_idx ON public.support_tickets (household_id);
CREATE INDEX support_tickets_contact_idx ON public.support_tickets (contact_id);
CREATE INDEX support_tickets_created_idx ON public.support_tickets (created_at DESC);

CREATE TABLE public.support_ticket_notes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id   UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL,
    body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX support_ticket_notes_ticket_idx ON public.support_ticket_notes (ticket_id, created_at);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_tickets, public.support_ticket_notes FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- Reads

-- One page of tickets (FR-SP-1 to FR-SP-4). p_status: 'active' (open or
-- pending), one status, or null. p_assignee: an admin id, 'unassigned', or
-- null. Search: a ticket number (LIN-1042 or 1042), or subject and handle.
CREATE FUNCTION public.support_list_tickets(
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
      AND (p_user_id IS NULL OR t.user_id = p_user_id)
      AND (p_household_id IS NULL OR t.household_id = p_household_id)
      AND (p_contact_id IS NULL OR t.contact_id = p_contact_id)
      AND (p_search IS NULL
           OR (term.number IS NOT NULL AND t.ref = term.number)
           OR (term.number IS NULL
               AND (t.subject ILIKE term.pattern OR t.contact ILIKE term.pattern)))
    ORDER BY (t.status IN ('open', 'pending') AND t.priority = 'high') DESC,
             t.updated_at DESC, t.id
    LIMIT p_limit OFFSET p_offset
$$;

-- One ticket with its notes and the names of what it links to (FR-SP-5).
CREATE FUNCTION public.support_get_ticket(p_ticket_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object(
        'ticket_id', t.id, 'ref', t.ref, 'subject', t.subject, 'body', t.body,
        'channel', t.channel, 'category', t.category, 'priority', t.priority,
        'status', t.status, 'user_id', t.user_id, 'household_id', t.household_id,
        'contact_id', t.contact_id, 'contact', t.contact, 'assignee_id', t.assignee_id,
        'created_by', t.created_by, 'created_at', t.created_at, 'updated_at', t.updated_at,
        'resolved_at', t.resolved_at,
        'user_name', (SELECT p.full_name FROM public.user_profiles p WHERE p.id = t.user_id),
        'household_name', (SELECT h.name FROM public.households h WHERE h.id = t.household_id),
        'contact_name', (SELECT coalesce(p.full_name, c.full_name)
                         FROM public.crm_contacts c
                         LEFT JOIN public.user_profiles p ON p.id = c.user_id
                         WHERE c.id = t.contact_id AND c.anonymized_at IS NULL),
        'notes', coalesce((
            SELECT jsonb_agg(jsonb_build_object('id', n.id, 'author_id', n.author_id,
                                                'body', n.body, 'created_at', n.created_at)
                             ORDER BY n.created_at, n.id)
            FROM public.support_ticket_notes n WHERE n.ticket_id = t.id
        ), '[]'::JSONB)
    )
    FROM public.support_tickets t
    WHERE t.id = p_ticket_id
$$;

-- The dashboard's support figures (FR-DB-5).
CREATE FUNCTION public.support_counts() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object(
        'open', count(*) FILTER (WHERE status = 'open')::INT,
        'pending', count(*) FILTER (WHERE status = 'pending')::INT,
        'unassigned', count(*) FILTER (WHERE status IN ('open', 'pending')
                                         AND assignee_id IS NULL)::INT
    )
    FROM public.support_tickets
$$;

-- ---------------------------------------------------------------- Writes (D37)

CREATE FUNCTION public.support_audit(p_actor UUID, p_action TEXT, p_ticket UUID, p_metadata JSONB)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.staff_audit_log (actor_user_id, action, target_type, target_id, metadata)
    VALUES (p_actor, p_action, 'ticket', p_ticket::TEXT, coalesce(p_metadata, '{}'::JSONB))
$$;

CREATE FUNCTION public.support_create_ticket(
    p_actor UUID, p_subject TEXT, p_body TEXT, p_channel TEXT, p_category TEXT,
    p_priority TEXT, p_contact TEXT, p_user_id UUID, p_household_id UUID, p_contact_id UUID,
    p_assignee_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_id UUID;
BEGIN
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

-- Locks the ticket for a change; raises a plain message when it doesn't exist.
CREATE FUNCTION public.support_lock(p_ticket_id UUID) RETURNS public.support_tickets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    t public.support_tickets;
BEGIN
    SELECT * INTO t FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
    IF t.id IS NULL THEN RAISE EXCEPTION 'That ticket doesn''t exist.'; END IF;
    RETURN t;
END $$;

-- Open, waiting on user, resolved, closed; a closed ticket can be reopened (FR-SP-3).
CREATE FUNCTION public.support_set_status(p_actor UUID, p_ticket_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    t public.support_tickets := public.support_lock(p_ticket_id);
BEGIN
    IF t.status = p_status THEN RETURN; END IF;
    UPDATE public.support_tickets
    SET status = p_status,
        resolved_at = CASE WHEN p_status IN ('resolved', 'closed') THEN coalesce(resolved_at, now())
                           ELSE NULL END,
        updated_at = now()
    WHERE id = t.id;
    PERFORM public.support_audit(p_actor, 'support.status_changed', t.id,
        jsonb_build_object('from', t.status, 'to', p_status));
END $$;

CREATE FUNCTION public.support_assign(p_actor UUID, p_ticket_id UUID, p_assignee_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    t public.support_tickets := public.support_lock(p_ticket_id);
BEGIN
    IF t.assignee_id IS NOT DISTINCT FROM p_assignee_id THEN RETURN; END IF;
    UPDATE public.support_tickets SET assignee_id = p_assignee_id, updated_at = now()
    WHERE id = t.id;
    PERFORM public.support_audit(p_actor, 'support.assigned', t.id,
        jsonb_build_object('assignee_id', p_assignee_id));
END $$;

CREATE FUNCTION public.support_set_priority(p_actor UUID, p_ticket_id UUID, p_priority TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    t public.support_tickets := public.support_lock(p_ticket_id);
BEGIN
    IF t.priority = p_priority THEN RETURN; END IF;
    UPDATE public.support_tickets SET priority = p_priority, updated_at = now() WHERE id = t.id;
    PERFORM public.support_audit(p_actor, 'support.priority_changed', t.id,
        jsonb_build_object('from', t.priority, 'to', p_priority));
END $$;

CREATE FUNCTION public.support_set_links(
    p_actor UUID, p_ticket_id UUID, p_user_id UUID, p_household_id UUID, p_contact_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    t public.support_tickets := public.support_lock(p_ticket_id);
BEGIN
    IF t.user_id IS NOT DISTINCT FROM p_user_id
       AND t.household_id IS NOT DISTINCT FROM p_household_id
       AND t.contact_id IS NOT DISTINCT FROM p_contact_id THEN
        RETURN;
    END IF;
    UPDATE public.support_tickets
    SET user_id = p_user_id, household_id = p_household_id, contact_id = p_contact_id,
        updated_at = now()
    WHERE id = t.id;
    PERFORM public.support_audit(p_actor, 'support.links_changed', t.id,
        jsonb_build_object('user', p_user_id IS NOT NULL, 'household', p_household_id IS NOT NULL,
                           'contact', p_contact_id IS NOT NULL));
END $$;

-- An internal note; replies sent on the original channel are logged here too (FR-SP-5).
CREATE FUNCTION public.support_add_note(p_actor UUID, p_ticket_id UUID, p_body TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    t public.support_tickets := public.support_lock(p_ticket_id);
    v_id UUID;
BEGIN
    INSERT INTO public.support_ticket_notes (ticket_id, author_id, body)
    VALUES (t.id, p_actor, p_body)
    RETURNING id INTO v_id;
    UPDATE public.support_tickets SET updated_at = clock_timestamp() WHERE id = t.id;
    PERFORM public.support_audit(p_actor, 'support.note_added', t.id,
        jsonb_build_object('note_id', v_id));
    RETURN v_id;
END $$;

-- ---------------------------------------------------------------- Deletion (D36, D37)

-- 009's staff_process_deletion, now also clearing the person's tickets
-- (FR-DL-6, S-23): those linked to their account or to their CRM contact.
CREATE OR REPLACE FUNCTION public.staff_process_deletion(p_actor UUID, p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    r public.account_deletion_requests;
    v_kind TEXT;
    v_result JSONB;
    v_contacts UUID[];
    v_tickets UUID[];
    v_removed CONSTANT TEXT := 'Removed after the account was deleted';
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

    -- Their tickets keep dates, statuses and categories, not the words (D37).
    SELECT coalesce(array_agg(t.id), '{}') INTO v_tickets
    FROM public.support_tickets t
    WHERE t.user_id = r.user_id OR t.contact_id = ANY (v_contacts);
    UPDATE public.support_tickets
    SET subject = v_removed, body = v_removed, contact = NULL
    WHERE id = ANY (v_tickets);
    UPDATE public.support_ticket_notes SET body = v_removed WHERE ticket_id = ANY (v_tickets);

    -- Ids only (FR-DL-5, S-22).
    INSERT INTO public.staff_audit_log (actor_user_id, action, target_type, target_id, metadata)
    VALUES (p_actor, 'deletion.processed', 'user', r.user_id::TEXT,
            jsonb_build_object('request_id', r.id, 'user_type', v_kind));
    RETURN v_result;
END $$;

-- ---------------------------------------------------------------- Privileges

-- Every support_ function and the replaced deletion step are for the server key only.
DO $$
DECLARE
    f TEXT;
BEGIN
    FOR f IN
        SELECT p.oid::REGPROCEDURE::TEXT
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND (p.proname LIKE 'support\_%' OR p.proname = 'staff_process_deletion')
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END $$;

COMMIT;
