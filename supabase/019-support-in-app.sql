-- LINARA_ADMIN, Phase 8 — in-app support. Apply after 015-business-permissions.sql
-- (nothing here needs 016 to 018).
-- Spec: 2026-10-19-sell-linara-design.md (in-app support).
--
-- Apply by hand in the Supabase SQL editor: linara dev first. One transaction.
-- Safe to run more than once.
-- 1. support_tickets takes the in_app channel and a billing category, and keeps
--    an unread count for each side and the time of the last message.
-- 2. support_ticket_messages holds the conversation between a household and
--    the team (RLS on, no app-role access).
-- 3. Household functions, household_support_*: the documented exception to
--    this folder's server-key-only rule. LINARA's app calls them with the
--    signed-in manager's session, so they check auth.uid() against
--    household_managers themselves, are granted to authenticated, and refuse
--    in the household app's CODE:detail style (NOT_FOUND, BAD_INPUT:<field>).
--    They only ever see in_app tickets: a ticket the team logged from
--    Messenger or a call stays internal. Their names sit outside support_% on
--    purpose. Household messages are the household's own words, not staff
--    actions, so they aren't in the audit log.
-- 4. Staff (server key): support_reply and support_staff_mark_read;
--    support_get_ticket gains the messages and unread counts;
--    support_list_tickets gains staff_unread and last_message_at and lists
--    tickets with unread household messages first. Its result columns change,
--    so it is dropped and created again and its grant restated.
-- 5. A processed deletion also clears in-app messages (FR-DL-6, S-23): every
--    message on the person's tickets, and anything they wrote on another
--    manager's ticket. 014's staff_process_deletion plus that one step; same
--    signature, so its grant stays.
-- Privileges are granted by explicit function lists. The only main-app table
-- read is household_managers; nothing here changes one.

BEGIN;

-- ---------------------------------------------------------------- Tables

-- 010 named its column CHECKs the Postgres default way (<table>_<column>_check).
ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_channel_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_channel_check
    CHECK (channel IN ('messenger', 'viber', 'email', 'phone', 'in_app', 'other'));
ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_category_check;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_category_check
    CHECK (category IN ('account', 'tasks', 'pay', 'payout', 'app_bug', 'billing', 'deletion',
                        'other'));

ALTER TABLE public.support_tickets
    ADD COLUMN IF NOT EXISTS household_unread INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS staff_unread     INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_message_at  TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id   UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL,
    from_staff  BOOLEAN NOT NULL,
    body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx
    ON public.support_ticket_messages (ticket_id, created_at);

ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_ticket_messages FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- Household helpers

-- Refuses unless the signed-in user manages the household. A missing household
-- and someone else's look the same (NOT_FOUND).
CREATE OR REPLACE FUNCTION public.household_support_require(p_household_id UUID) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_household_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.household_managers m
        WHERE m.household_id = p_household_id AND m.user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
END $$;

-- The in_app ticket when the signed-in user manages its household, locked when
-- p_lock; NOT_FOUND when it's missing, another household's or one the team logged.
CREATE OR REPLACE FUNCTION public.household_support_ticket(p_ticket_id UUID, p_lock BOOLEAN)
RETURNS public.support_tickets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    t public.support_tickets;
BEGIN
    IF p_lock THEN
        SELECT * INTO t FROM public.support_tickets WHERE id = p_ticket_id FOR UPDATE;
    ELSE
        SELECT * INTO t FROM public.support_tickets WHERE id = p_ticket_id;
    END IF;
    IF t.id IS NULL OR t.channel <> 'in_app' THEN
        RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.household_support_require(t.household_id);
    RETURN t;
END $$;

-- The text without surrounding spaces or blank lines; BAD_INPUT:<field> when
-- it's empty or longer than p_max.
CREATE OR REPLACE FUNCTION public.household_support_clean(p_text TEXT, p_max INT, p_field TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v TEXT := btrim(p_text, E' \t\r\n');
BEGIN
    IF v IS NULL OR char_length(v) NOT BETWEEN 1 AND p_max THEN
        RAISE EXCEPTION 'BAD_INPUT:%', p_field USING ERRCODE = 'P0001';
    END IF;
    RETURN v;
END $$;

-- ---------------------------------------------------------------- Household functions

-- The household's in-app tickets, latest activity first.
CREATE OR REPLACE FUNCTION public.household_support_list(p_household_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM public.household_support_require(p_household_id);
    RETURN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                   'id', t.id, 'ref', t.ref, 'subject', t.subject, 'status', t.status,
                   'created_at', t.created_at, 'last_message_at', t.last_message_at,
                   'household_unread', t.household_unread)
               ORDER BY coalesce(t.last_message_at, t.created_at) DESC, t.id)
        FROM public.support_tickets t
        WHERE t.household_id = p_household_id AND t.channel = 'in_app'
    ), '[]'::JSONB);
END $$;

-- A new conversation with the team; its first message is the body.
CREATE OR REPLACE FUNCTION public.household_support_open(p_household_id UUID, p_subject TEXT,
                                                         p_body TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user    UUID := auth.uid();
    v_subject TEXT;
    v_body    TEXT;
    v_at      TIMESTAMPTZ := clock_timestamp();
    v_id      UUID;
BEGIN
    PERFORM public.household_support_require(p_household_id);
    v_subject := public.household_support_clean(p_subject, 120, 'subject');
    v_body := public.household_support_clean(p_body, 4000, 'body');
    INSERT INTO public.support_tickets
        (subject, body, channel, category, priority, status, user_id, household_id, contact,
         created_by, staff_unread, household_unread, last_message_at, created_at, updated_at)
    VALUES (v_subject, v_body, 'in_app', 'other', 'normal', 'open', v_user, p_household_id, NULL,
            v_user, 1, 0, v_at, v_at, v_at)
    RETURNING id INTO v_id;
    INSERT INTO public.support_ticket_messages (ticket_id, author_id, from_staff, body, created_at)
    VALUES (v_id, v_user, false, v_body, v_at);
    RETURN v_id;
END $$;

-- The conversation, oldest first.
CREATE OR REPLACE FUNCTION public.household_support_messages(p_ticket_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    t public.support_tickets := public.household_support_ticket(p_ticket_id, false);
BEGIN
    RETURN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                   'id', m.id, 'ticket_id', m.ticket_id, 'author_id', m.author_id,
                   'from_staff', m.from_staff, 'body', m.body, 'created_at', m.created_at)
               ORDER BY m.created_at, m.id)
        FROM public.support_ticket_messages m
        WHERE m.ticket_id = t.id
    ), '[]'::JSONB);
END $$;

-- A message from the household. Writing on a resolved, closed or waiting
-- ticket opens it again for the team.
CREATE OR REPLACE FUNCTION public.household_support_post(p_ticket_id UUID, p_body TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    t      public.support_tickets := public.household_support_ticket(p_ticket_id, true);
    v_body TEXT := public.household_support_clean(p_body, 4000, 'body');
    v_at   TIMESTAMPTZ := clock_timestamp();
    v_id   UUID;
BEGIN
    INSERT INTO public.support_ticket_messages (ticket_id, author_id, from_staff, body, created_at)
    VALUES (t.id, auth.uid(), false, v_body, v_at)
    RETURNING id INTO v_id;
    UPDATE public.support_tickets
    SET status = 'open',
        resolved_at = NULL,
        staff_unread = staff_unread + 1,
        last_message_at = v_at,
        updated_at = v_at
    WHERE id = t.id;
    RETURN v_id;
END $$;

-- The household has seen the team's replies.
CREATE OR REPLACE FUNCTION public.household_support_mark_read(p_ticket_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    t public.support_tickets := public.household_support_ticket(p_ticket_id, true);
BEGIN
    IF t.household_unread <> 0 THEN
        UPDATE public.support_tickets SET household_unread = 0 WHERE id = t.id;
    END IF;
END $$;

-- ---------------------------------------------------------------- Staff (D37)

-- A reply the household reads in the app (in_app tickets only). Replying
-- means the team has read the household's messages.
CREATE OR REPLACE FUNCTION public.support_reply(p_actor UUID, p_ticket_id UUID, p_body TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    t      public.support_tickets := public.support_lock(p_ticket_id);
    v_body TEXT := btrim(p_body, E' \t\r\n');
    v_at   TIMESTAMPTZ := clock_timestamp();
    v_id   UUID;
BEGIN
    IF t.channel <> 'in_app' THEN
        RAISE EXCEPTION 'This ticket didn''t come from the app. Reply on its own channel and add a note.'
            USING ERRCODE = 'P0001';
    END IF;
    IF v_body IS NULL OR char_length(v_body) NOT BETWEEN 1 AND 4000 THEN
        RAISE EXCEPTION 'Write a reply of up to 4,000 characters.' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.support_ticket_messages (ticket_id, author_id, from_staff, body, created_at)
    VALUES (t.id, p_actor, true, v_body, v_at)
    RETURNING id INTO v_id;
    UPDATE public.support_tickets
    SET household_unread = household_unread + 1,
        staff_unread = 0,
        last_message_at = v_at,
        updated_at = v_at
    WHERE id = t.id;
    PERFORM public.support_audit(p_actor, 'support.replied', t.id, '{}'::JSONB);
    RETURN v_id;
END $$;

-- The team has seen the household's messages.
CREATE OR REPLACE FUNCTION public.support_staff_mark_read(p_actor UUID, p_ticket_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    t public.support_tickets := public.support_lock(p_ticket_id);
BEGIN
    IF t.staff_unread <> 0 THEN
        UPDATE public.support_tickets SET staff_unread = 0 WHERE id = t.id;
    END IF;
END $$;

-- 010's detail plus the unread counts, the last message time and the
-- conversation. Same signature, so its grant stays.
CREATE OR REPLACE FUNCTION public.support_get_ticket(p_ticket_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object(
        'ticket_id', t.id, 'ref', t.ref, 'subject', t.subject, 'body', t.body,
        'channel', t.channel, 'category', t.category, 'priority', t.priority,
        'status', t.status, 'user_id', t.user_id, 'household_id', t.household_id,
        'contact_id', t.contact_id, 'contact', t.contact, 'assignee_id', t.assignee_id,
        'created_by', t.created_by, 'created_at', t.created_at, 'updated_at', t.updated_at,
        'resolved_at', t.resolved_at,
        'household_unread', t.household_unread, 'staff_unread', t.staff_unread,
        'last_message_at', t.last_message_at,
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
        ), '[]'::JSONB),
        'messages', coalesce((
            SELECT jsonb_agg(jsonb_build_object('id', m.id, 'ticket_id', m.ticket_id,
                                                'author_id', m.author_id,
                                                'from_staff', m.from_staff, 'body', m.body,
                                                'created_at', m.created_at)
                             ORDER BY m.created_at, m.id)
            FROM public.support_ticket_messages m WHERE m.ticket_id = t.id
        ), '[]'::JSONB)
    )
    FROM public.support_tickets t
    WHERE t.id = p_ticket_id
$$;

-- 011's list plus staff_unread and last_message_at; tickets with unread
-- household messages come first, then 011's order. Every filter is 011's.
DROP FUNCTION IF EXISTS public.support_list_tickets(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID,
                                                    INT, INT);
CREATE FUNCTION public.support_list_tickets(
    p_search TEXT, p_status TEXT, p_assignee TEXT, p_category TEXT, p_priority TEXT,
    p_user_id UUID, p_household_id UUID, p_contact_id UUID, p_limit INT, p_offset INT
) RETURNS TABLE (ticket_id UUID, ref BIGINT, subject TEXT, channel TEXT, category TEXT,
                 priority TEXT, status TEXT, user_id UUID, household_id UUID, contact_id UUID,
                 contact TEXT, assignee_id UUID, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
                 resolved_at TIMESTAMPTZ, note_count INT, staff_unread INT,
                 last_message_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH term AS (
        SELECT public.staff_like_pattern(p_search) AS pattern,
               substring(p_search FROM '^\s*(?:[Ll][Ii][Nn]-?)?(\d+)\s*$')::BIGINT AS number
    )
    SELECT t.id, t.ref, t.subject, t.channel, t.category, t.priority, t.status, t.user_id,
           t.household_id, t.contact_id, t.contact, t.assignee_id, t.created_at, t.updated_at,
           t.resolved_at,
           (SELECT count(*)::INT FROM public.support_ticket_notes n WHERE n.ticket_id = t.id),
           t.staff_unread, t.last_message_at
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
    ORDER BY (t.staff_unread > 0) DESC,
             (t.status IN ('open', 'pending') AND t.priority = 'high') DESC,
             t.updated_at DESC, t.id
    LIMIT p_limit OFFSET p_offset
$$;

-- ---------------------------------------------------------------- Deletion (D36, D37)

-- 014's staff_process_deletion, now also clearing in-app messages (FR-DL-6, S-23).
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
        RAISE EXCEPTION 'This account is on the console team. Manage it on the Team screen.';
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
    -- In-app conversations: all of their tickets', and their words on a co-manager's ticket.
    UPDATE public.support_ticket_messages SET body = v_removed
    WHERE ticket_id = ANY (v_tickets) OR (author_id = r.user_id AND NOT from_staff);

    -- Ids only (FR-DL-5, S-22).
    INSERT INTO public.staff_audit_log (actor_user_id, action, target_type, target_id, metadata)
    VALUES (p_actor, 'deletion.processed', 'user', r.user_id::TEXT,
            jsonb_build_object('request_id', r.id, 'user_type', v_kind));
    RETURN v_result;
END $$;

-- ---------------------------------------------------------------- Privileges

-- Household functions: signed-in household accounts only.
REVOKE EXECUTE ON FUNCTION
    public.household_support_list(UUID),
    public.household_support_open(UUID, TEXT, TEXT),
    public.household_support_messages(UUID),
    public.household_support_post(UUID, TEXT),
    public.household_support_mark_read(UUID)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
    public.household_support_list(UUID),
    public.household_support_open(UUID, TEXT, TEXT),
    public.household_support_messages(UUID),
    public.household_support_post(UUID, TEXT),
    public.household_support_mark_read(UUID)
    TO authenticated;

-- Their helpers: only the functions above call them.
REVOKE EXECUTE ON FUNCTION
    public.household_support_require(UUID),
    public.household_support_ticket(UUID, BOOLEAN),
    public.household_support_clean(TEXT, INT, TEXT)
    FROM PUBLIC, anon, authenticated;

-- Staff functions: the server key only, as in 010.
REVOKE EXECUTE ON FUNCTION
    public.support_reply(UUID, UUID, TEXT),
    public.support_staff_mark_read(UUID, UUID),
    public.support_get_ticket(UUID),
    public.support_list_tickets(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, INT, INT),
    public.staff_process_deletion(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.support_reply(UUID, UUID, TEXT),
    public.support_staff_mark_read(UUID, UUID),
    public.support_get_ticket(UUID),
    public.support_list_tickets(TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, INT, INT),
    public.staff_process_deletion(UUID, UUID)
    TO service_role;

COMMIT;
