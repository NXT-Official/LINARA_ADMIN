-- LINARA_ADMIN, Phase 3a: the CRM's own tables and functions.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md §5.2, §8.2, D14 to D18, D31, D32, D34.
--
-- Apply by hand in the Supabase SQL editor after 003-visibility-fixes.sql:
-- linara dev first, then (later) staging and production. One transaction.
--
-- Rules (§8.1, S-27): RLS on with no policies, no privileges for anon or
-- authenticated, no foreign keys to main-app rows. Every write function
-- records itself in staff_audit_log in the same transaction (D34), with ids,
-- kinds and stage names only (S-22). Nothing here writes to a main-app table.

BEGIN;

-- ---------------------------------------------------------------- Tables

-- One row per person, lead or customer (D14). A manager nobody has added
-- anything to yet has no row (FR-CRM-3).
CREATE TABLE public.crm_contacts (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name      TEXT CHECK (full_name IS NULL OR char_length(full_name) BETWEEN 1 AND 120),
    email          TEXT CHECK (email IS NULL OR char_length(email) <= 254),
    phone          TEXT CHECK (phone IS NULL OR phone ~ '^09[0-9]{9}$'),
    source         TEXT CHECK (source IN ('facebook', 'referral', 'event', 'walk_in', 'website', 'other')),
    consent_basis  TEXT CHECK (consent_basis IS NULL OR char_length(consent_basis) <= 300),
    lead_stage     TEXT NOT NULL DEFAULT 'new'
                   CHECK (lead_stage IN ('new', 'contacted', 'interested', 'lost')),
    lost_reason    TEXT CHECK (lost_reason IS NULL OR char_length(lost_reason) BETWEEN 1 AND 300),
    user_id        UUID UNIQUE,
    linked_at      TIMESTAMPTZ,
    owner_id       UUID,
    tags           TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
    anonymized_at  TIMESTAMPTZ,
    created_by     UUID NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crm_contacts_email_idx ON public.crm_contacts (lower(email));
CREATE INDEX crm_contacts_phone_idx ON public.crm_contacts (phone);
CREATE INDEX crm_contacts_owner_idx ON public.crm_contacts (owner_id);
CREATE INDEX crm_contacts_stage_idx ON public.crm_contacts (lead_stage);

CREATE TABLE public.crm_activities (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id   UUID NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('call', 'message', 'email', 'meeting', 'note')),
    body         TEXT CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 2000),
    occurred_at  TIMESTAMPTZ NOT NULL,
    author_id    UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crm_activities_contact_idx ON public.crm_activities (contact_id, occurred_at DESC);

CREATE TABLE public.crm_follow_ups (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id   UUID NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
    due_at       TIMESTAMPTZ NOT NULL,
    note         TEXT NOT NULL CHECK (char_length(note) BETWEEN 1 AND 2000),
    assignee_id  UUID NOT NULL,
    done_at      TIMESTAMPTZ,
    created_by   UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX crm_follow_ups_contact_idx ON public.crm_follow_ups (contact_id);
CREATE INDEX crm_follow_ups_open_idx ON public.crm_follow_ups (due_at) WHERE done_at IS NULL;

ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_follow_ups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_contacts, public.crm_activities, public.crm_follow_ups
    FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- Stages

-- One household's customer stage (§5.2.2), the same rules as householdStage
-- in src/features/crm/crm-stage.ts. Days are Manila calendar days, as in
-- daysBetween. The limits are passed in from STAGE_DAYS, never fixed here.
CREATE FUNCTION public.crm_household_stage(
    p_has_active_helper BOOLEAN, p_set_up BOOLEAN, p_last_activity TIMESTAMPTZ,
    p_now TIMESTAMPTZ, p_active_days INT, p_at_risk_days INT
) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE
        WHEN p_last_activity IS NULL THEN
            CASE WHEN p_has_active_helper THEN 'set_up' ELSE 'signed_up' END
        WHEN (p_now AT TIME ZONE 'Asia/Manila')::DATE
             - (p_last_activity AT TIME ZONE 'Asia/Manila')::DATE <= p_active_days THEN 'active'
        WHEN NOT p_set_up THEN 'signed_up'
        WHEN (p_now AT TIME ZONE 'Asia/Manila')::DATE
             - (p_last_activity AT TIME ZONE 'Asia/Manila')::DATE <= p_at_risk_days THEN 'at_risk'
        ELSE 'inactive'
    END
$$;

-- "Best" across a customer's households (§5.2.1), as RANK in crm-stage.ts.
CREATE FUNCTION public.crm_stage_rank(p_stage TEXT) RETURNS INT
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE p_stage
        WHEN 'active' THEN 5 WHEN 'set_up' THEN 4 WHEN 'at_risk' THEN 3
        WHEN 'signed_up' THEN 2 WHEN 'inactive' THEN 1 ELSE 0 END
$$;

-- ---------------------------------------------------------------- Reads

-- Each household's stage and last activity, in one pass over helpers and
-- tasks (D31). p_households narrows it; null means every household. Helpers
-- count in each household they work in, shared ones included. Activity is
-- D32: a task a person scheduled, or one marked done.
CREATE FUNCTION public.crm_household_facts(
    p_households UUID[], p_now TIMESTAMPTZ, p_active_days INT, p_at_risk_days INT
) RETURNS TABLE (household_id UUID, stage TEXT, last_activity_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH
    scope AS (
        SELECT h.id FROM public.households h
        WHERE p_households IS NULL OR h.id = ANY (p_households)
    ),
    staff AS (
        SELECT hp.household_id, hp.status FROM public.helper_profiles hp
        WHERE hp.household_id IN (SELECT id FROM scope)
        UNION ALL
        SELECT hh.household_id, hp.status
        FROM public.helper_households hh
        JOIN public.helper_profiles hp ON hp.id = hh.helper_id
        WHERE hh.household_id IN (SELECT id FROM scope)
    ),
    helpers AS (
        SELECT s.household_id,
               bool_or(s.status = 'ACTIVE') AS has_active,
               bool_or(s.status IN ('ACTIVE', 'INACTIVE')) AS set_up
        FROM staff s GROUP BY s.household_id
    ),
    act AS (
        SELECT t.household_id,
               greatest(
                   max(t.actual_end) FILTER (WHERE t.status = 'done' AND t.actual_end <= p_now),
                   max(t.scheduled_start) FILTER (WHERE t.status <> 'cancelled'
                                                    AND (t.routine_id IS NULL
                                                         OR t.routine_id = t.id::TEXT)
                                                    AND t.scheduled_start <= p_now)
               ) AS last_at
        FROM public.tickets t
        WHERE t.household_id IN (SELECT id FROM scope)
        GROUP BY t.household_id
    )
    SELECT s.id,
           public.crm_household_stage(coalesce(hl.has_active, false), coalesce(hl.set_up, false),
                                      a.last_at, p_now, p_active_days, p_at_risk_days),
           a.last_at
    FROM scope s
    LEFT JOIN helpers hl ON hl.household_id = s.id
    LEFT JOIN act a ON a.household_id = s.id
$$;

-- Everyone the CRM lists, before filters (§5.2.1, FR-CRM-3): every contact not
-- anonymised, and every manager with no contact row yet. A customer's name and
-- email come from their account; their stage is the best across their homes.
CREATE FUNCTION public.crm_people(p_now TIMESTAMPTZ, p_active_days INT, p_at_risk_days INT)
RETURNS TABLE (contact_id UUID, user_id UUID, full_name TEXT, email TEXT, phone TEXT,
               kind TEXT, stage TEXT, source TEXT, owner_id UUID, tags TEXT[], roles TEXT[],
               household_count INT, next_follow_up_at TIMESTAMPTZ, created_at TIMESTAMPTZ,
               linked_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH
    facts AS (SELECT * FROM public.crm_household_facts(NULL, p_now, p_active_days, p_at_risk_days)),
    customers AS (
        SELECT m.user_id,
               array_agg(DISTINCT m.role) AS roles,
               count(DISTINCT m.household_id)::INT AS homes,
               (array_agg(f.stage ORDER BY public.crm_stage_rank(f.stage) DESC))[1] AS best
        FROM public.household_managers m
        JOIN facts f ON f.household_id = m.household_id
        GROUP BY m.user_id
    ),
    next_due AS (
        SELECT fu.contact_id, min(fu.due_at) AS due_at
        FROM public.crm_follow_ups fu
        WHERE fu.done_at IS NULL
        GROUP BY fu.contact_id
    ),
    saved AS (
        SELECT c.id AS contact_id, c.user_id,
               coalesce(p.full_name, c.full_name) AS full_name,
               coalesce(u.email::TEXT, c.email) AS email,
               c.phone,
               CASE WHEN c.user_id IS NULL THEN 'lead' ELSE 'customer' END AS kind,
               CASE WHEN c.user_id IS NULL THEN c.lead_stage
                    ELSE coalesce(cu.best, 'signed_up') END AS stage,
               c.source, c.owner_id, c.tags,
               coalesce(cu.roles, '{}'::TEXT[]) AS roles,
               coalesce(cu.homes, 0) AS household_count,
               nd.due_at AS next_follow_up_at,
               c.created_at, c.linked_at
        FROM public.crm_contacts c
        LEFT JOIN public.user_profiles p ON p.id = c.user_id
        LEFT JOIN auth.users u ON u.id = c.user_id
        LEFT JOIN customers cu ON cu.user_id = c.user_id
        LEFT JOIN next_due nd ON nd.contact_id = c.id
        WHERE c.anonymized_at IS NULL
    ),
    unsaved AS (
        SELECT NULL::UUID, cu.user_id, p.full_name, u.email::TEXT, NULL::TEXT, 'customer',
               cu.best, NULL::TEXT, NULL::UUID, '{}'::TEXT[], cu.roles, cu.homes,
               NULL::TIMESTAMPTZ, u.created_at, NULL::TIMESTAMPTZ
        FROM customers cu
        JOIN auth.users u ON u.id = cu.user_id
        LEFT JOIN public.user_profiles p ON p.id = cu.user_id
        WHERE NOT EXISTS (SELECT 1 FROM public.crm_contacts c WHERE c.user_id = cu.user_id)
    )
    SELECT * FROM saved
    UNION ALL
    SELECT * FROM unsaved
$$;

-- One page of the CRM list (FR-CRM-3, FR-CRM-4, FR-CRM-8, FR-CRM-9). Overdue
-- follow-ups first, then newest. "Today" is a Manila day.
CREATE FUNCTION public.crm_list_contacts(
    p_search TEXT, p_kind TEXT, p_stage TEXT, p_owner UUID, p_tag TEXT, p_role TEXT,
    p_due TEXT, p_limit INT, p_offset INT, p_now TIMESTAMPTZ, p_active_days INT,
    p_at_risk_days INT
) RETURNS TABLE (contact_id UUID, user_id UUID, full_name TEXT, email TEXT, phone TEXT,
                 kind TEXT, stage TEXT, source TEXT, owner_id UUID, tags TEXT[],
                 roles TEXT[], household_count INT, next_follow_up_at TIMESTAMPTZ,
                 created_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH
    term AS (
        SELECT public.staff_like_pattern(p_search) AS pattern,
               regexp_replace(coalesce(p_search, ''), '\D', '', 'g') AS digits,
               (p_now AT TIME ZONE 'Asia/Manila')::DATE AS today
    ),
    rows AS (
        SELECT pp.*, (pp.next_follow_up_at AT TIME ZONE 'Asia/Manila')::DATE AS due_day
        FROM public.crm_people(p_now, p_active_days, p_at_risk_days) pp
    )
    SELECT r.contact_id, r.user_id, r.full_name, r.email, r.phone, r.kind, r.stage, r.source,
           r.owner_id, r.tags, r.roles, r.household_count, r.next_follow_up_at, r.created_at
    FROM rows r CROSS JOIN term
    WHERE (p_kind IS NULL OR r.kind = p_kind)
      AND (p_stage IS NULL OR r.stage = p_stage)
      AND (p_owner IS NULL OR r.owner_id = p_owner)
      AND (p_tag IS NULL OR EXISTS (SELECT 1 FROM unnest(r.tags) t WHERE lower(t) = lower(p_tag)))
      AND (p_role IS NULL OR p_role = ANY (r.roles))
      AND (p_due IS NULL
           OR (p_due = 'today' AND r.due_day = term.today)
           OR (p_due = 'overdue' AND r.due_day < term.today))
      AND (p_search IS NULL
           OR r.full_name ILIKE term.pattern
           OR r.email ILIKE term.pattern
           OR array_to_string(r.tags, ' ') ILIKE term.pattern
           OR (length(term.digits) >= 3
               AND regexp_replace(coalesce(r.phone, ''), '\D', '', 'g')
                   LIKE '%' || term.digits || '%'))
    ORDER BY (r.due_day < term.today) DESC NULLS LAST, r.created_at DESC,
             coalesce(r.contact_id, r.user_id)
    LIMIT p_limit OFFSET p_offset
$$;

-- One contact's page (FR-CRM-12), by contact id or, for a manager with no
-- contact row yet, by user id. Null when absent or the user isn't a manager.
CREATE FUNCTION public.crm_get_contact(
    p_contact_id UUID, p_user_id UUID, p_now TIMESTAMPTZ, p_active_days INT,
    p_at_risk_days INT
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    c public.crm_contacts;
    v_user UUID;
    v_homes UUID[];
    v_row RECORD;
BEGIN
    IF p_contact_id IS NOT NULL THEN
        SELECT * INTO c FROM public.crm_contacts WHERE id = p_contact_id;
        IF c.id IS NULL THEN RETURN NULL; END IF;
        v_user := c.user_id;
    ELSIF p_user_id IS NOT NULL THEN
        SELECT * INTO c FROM public.crm_contacts WHERE user_id = p_user_id;
        v_user := p_user_id;
        IF c.id IS NULL AND NOT EXISTS (
            SELECT 1 FROM public.household_managers m WHERE m.user_id = p_user_id
        ) THEN
            RETURN NULL;
        END IF;
    ELSE
        RETURN NULL;
    END IF;

    SELECT array_agg(m.household_id) INTO v_homes
    FROM public.household_managers m WHERE m.user_id = v_user;

    SELECT pp.* INTO v_row
    FROM public.crm_people(p_now, p_active_days, p_at_risk_days) pp
    WHERE (c.id IS NOT NULL AND pp.contact_id = c.id)
       OR (c.id IS NULL AND pp.contact_id IS NULL AND pp.user_id = v_user);

    RETURN jsonb_build_object(
        'contact_id', c.id,
        'user_id', v_user,
        'full_name', coalesce(v_row.full_name, c.full_name),
        'email', coalesce(v_row.email, c.email),
        'phone', c.phone,
        'kind', CASE WHEN v_user IS NULL THEN 'lead' ELSE 'customer' END,
        'stage', coalesce(v_row.stage, c.lead_stage),
        'source', c.source,
        'owner_id', c.owner_id,
        'tags', coalesce(to_jsonb(c.tags), '[]'::JSONB),
        'roles', coalesce(to_jsonb(v_row.roles), '[]'::JSONB),
        'household_count', coalesce(v_row.household_count, 0),
        'next_follow_up_at', v_row.next_follow_up_at,
        'created_at', coalesce(c.created_at, v_row.created_at),
        'lead_stage', CASE WHEN v_user IS NULL THEN c.lead_stage END,
        'lost_reason', c.lost_reason,
        'consent_basis', c.consent_basis,
        'linked_at', c.linked_at,
        'households', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'household_id', h.id, 'name', h.name, 'role', m.role,
                       'stage', f.stage, 'last_activity_at', f.last_activity_at)
                   ORDER BY public.crm_stage_rank(f.stage) DESC, h.name)
            FROM public.household_managers m
            JOIN public.households h ON h.id = m.household_id
            JOIN public.crm_household_facts(v_homes, p_now, p_active_days, p_at_risk_days) f
              ON f.household_id = h.id
            WHERE m.user_id = v_user
        ), '[]'::JSONB),
        'activities', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', a.id, 'kind', a.kind, 'body', a.body,
                       'occurred_at', a.occurred_at, 'author_id', a.author_id)
                   ORDER BY a.occurred_at DESC, a.created_at DESC)
            FROM public.crm_activities a WHERE a.contact_id = c.id
        ), '[]'::JSONB),
        'follow_ups', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', fu.id, 'due_at', fu.due_at, 'note', fu.note,
                       'assignee_id', fu.assignee_id, 'done_at', fu.done_at)
                   ORDER BY (fu.done_at IS NOT NULL), fu.due_at)
            FROM public.crm_follow_ups fu WHERE fu.contact_id = c.id
        ), '[]'::JSONB)
    );
END $$;

-- Managers whose account email matches a lead's, ignoring case, and who have
-- no contact yet (FR-CRM-6). The console only suggests; an admin confirms.
CREATE FUNCTION public.crm_link_suggestions(p_contact_id UUID)
RETURNS TABLE (user_id UUID, full_name TEXT, email TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT u.id, p.full_name, u.email::TEXT
    FROM public.crm_contacts c
    JOIN auth.users u ON lower(u.email) = lower(c.email)
    LEFT JOIN public.user_profiles p ON p.id = u.id
    WHERE c.id = p_contact_id
      AND c.user_id IS NULL
      AND c.email IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.household_managers m WHERE m.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM public.crm_contacts o WHERE o.user_id = u.id)
$$;

-- The CRM figures on the dashboard (FR-DB-7) and the CRM page's charts.
CREATE FUNCTION public.crm_dashboard(p_now TIMESTAMPTZ, p_active_days INT, p_at_risk_days INT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH
    people AS (SELECT * FROM public.crm_people(p_now, p_active_days, p_at_risk_days)),
    today AS (SELECT (p_now AT TIME ZONE 'Asia/Manila')::DATE AS d),
    open_follow_ups AS (
        SELECT (fu.due_at AT TIME ZONE 'Asia/Manila')::DATE AS due_day
        FROM public.crm_follow_ups fu
        JOIN public.crm_contacts c ON c.id = fu.contact_id
        WHERE fu.done_at IS NULL AND c.anonymized_at IS NULL
    ),
    count_by AS (
        SELECT kind, stage, count(*)::INT AS n FROM people GROUP BY kind, stage
    ),
    sources AS (
        SELECT c.source, count(*)::INT AS n FROM public.crm_contacts c
        WHERE c.anonymized_at IS NULL AND c.source IS NOT NULL GROUP BY c.source
    )
    SELECT jsonb_build_object(
        'leads_by_stage', (
            SELECT jsonb_object_agg(s, coalesce((SELECT n FROM count_by
                                                 WHERE kind = 'lead' AND stage = s), 0))
            FROM unnest(ARRAY['new', 'contacted', 'interested', 'lost']) s
        ),
        'customers_by_stage', (
            SELECT jsonb_object_agg(s, coalesce((SELECT n FROM count_by
                                                 WHERE kind = 'customer' AND stage = s), 0))
            FROM unnest(ARRAY['signed_up', 'set_up', 'active', 'at_risk', 'inactive']) s
        ),
        'follow_ups_due_today', (SELECT count(*)::INT FROM open_follow_ups, today
                                 WHERE due_day = today.d),
        'follow_ups_overdue', (SELECT count(*)::INT FROM open_follow_ups, today
                               WHERE due_day < today.d),
        'converted_30d', (SELECT count(*)::INT FROM public.crm_contacts c
                          WHERE c.anonymized_at IS NULL
                            AND c.linked_at > p_now - INTERVAL '30 days'
                            AND c.linked_at <= p_now),
        'sources', (
            SELECT jsonb_object_agg(s, coalesce((SELECT n FROM sources WHERE source = s), 0))
            FROM unnest(ARRAY['facebook', 'referral', 'event', 'walk_in', 'website', 'other']) s
        )
    )
$$;

-- ---------------------------------------------------------------- Writes (D34)
-- Each write records itself in staff_audit_log in the same transaction, with
-- ids, kinds and stage names only (S-22). A broken rule raises P0001 with a
-- plain message the console shows as it is; nothing is changed or recorded.

CREATE FUNCTION public.crm_audit(p_actor UUID, p_action TEXT, p_contact UUID, p_metadata JSONB)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.staff_audit_log (actor_user_id, action, target_type, target_id, metadata)
    VALUES (p_actor, p_action, 'contact', p_contact::TEXT, coalesce(p_metadata, '{}'::JSONB))
$$;

-- A saved contact for a manager, created the first time an admin adds
-- something to them (FR-CRM-3). Safe to call twice at once.
CREATE FUNCTION public.crm_ensure_contact(p_actor UUID, p_user_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.household_managers m WHERE m.user_id = p_user_id) THEN
        RAISE EXCEPTION 'That account isn''t a household manager.';
    END IF;
    INSERT INTO public.crm_contacts (user_id, created_by)
    VALUES (p_user_id, p_actor)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
        PERFORM public.crm_audit(p_actor, 'crm.contact_created', v_id,
                                 jsonb_build_object('kind', 'customer'));
        RETURN v_id;
    END IF;
    SELECT id INTO v_id FROM public.crm_contacts WHERE user_id = p_user_id;
    RETURN v_id;
END $$;

-- The contact an activity or follow-up belongs to: by id, or a manager's.
CREATE FUNCTION public.crm_resolve_contact(p_actor UUID, p_contact_id UUID, p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_contact_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.crm_contacts c
                       WHERE c.id = p_contact_id AND c.anonymized_at IS NULL) THEN
            RAISE EXCEPTION 'That contact doesn''t exist.';
        END IF;
        RETURN p_contact_id;
    END IF;
    RETURN public.crm_ensure_contact(p_actor, p_user_id);
END $$;

-- A lead entered by an admin (FR-CRM-1). A note becomes its first activity.
CREATE FUNCTION public.crm_create_lead(
    p_actor UUID, p_full_name TEXT, p_email TEXT, p_phone TEXT, p_source TEXT,
    p_owner_id UUID, p_tags TEXT[], p_note TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_id UUID;
BEGIN
    IF p_email IS NULL AND p_phone IS NULL THEN
        RAISE EXCEPTION 'A lead needs an email or a phone number.';
    END IF;
    INSERT INTO public.crm_contacts (full_name, email, phone, source, owner_id, tags, created_by)
    VALUES (p_full_name, p_email, p_phone, p_source, p_owner_id, coalesce(p_tags, '{}'), p_actor)
    RETURNING id INTO v_id;
    IF p_note IS NOT NULL THEN
        INSERT INTO public.crm_activities (contact_id, kind, body, occurred_at, author_id)
        VALUES (v_id, 'note', p_note, now(), p_actor);
    END IF;
    PERFORM public.crm_audit(p_actor, 'crm.contact_created', v_id,
                             jsonb_build_object('kind', 'lead', 'source', p_source));
    RETURN v_id;
END $$;

-- Edits a contact. A customer's name, email and phone come from their
-- account, so only the owner and tags change for them.
CREATE FUNCTION public.crm_update_contact(
    p_actor UUID, p_contact_id UUID, p_full_name TEXT, p_email TEXT, p_phone TEXT,
    p_source TEXT, p_owner_id UUID, p_tags TEXT[]
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    c public.crm_contacts;
BEGIN
    SELECT * INTO c FROM public.crm_contacts WHERE id = p_contact_id AND anonymized_at IS NULL
    FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'That contact doesn''t exist.'; END IF;
    IF c.user_id IS NULL THEN
        IF p_email IS NULL AND p_phone IS NULL THEN
            RAISE EXCEPTION 'A lead needs an email or a phone number.';
        END IF;
        UPDATE public.crm_contacts
        SET full_name = p_full_name, email = p_email, phone = p_phone, source = p_source,
            owner_id = p_owner_id, tags = coalesce(p_tags, '{}'), updated_at = now()
        WHERE id = c.id;
    ELSE
        UPDATE public.crm_contacts
        SET owner_id = p_owner_id, tags = coalesce(p_tags, '{}'), updated_at = now()
        WHERE id = c.id;
    END IF;
    PERFORM public.crm_audit(p_actor, 'crm.contact_updated', c.id,
                             jsonb_build_object('kind', CASE WHEN c.user_id IS NULL
                                                             THEN 'lead' ELSE 'customer' END));
    RETURN c.id;
END $$;

-- Moves a lead between lead stages (FR-CRM-5). Lost needs a reason.
CREATE FUNCTION public.crm_set_lead_stage(
    p_actor UUID, p_contact_id UUID, p_stage TEXT, p_lost_reason TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    c public.crm_contacts;
BEGIN
    SELECT * INTO c FROM public.crm_contacts WHERE id = p_contact_id AND anonymized_at IS NULL
    FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'That contact doesn''t exist.'; END IF;
    IF c.user_id IS NOT NULL THEN
        RAISE EXCEPTION 'Only leads have a lead stage. A customer''s stage comes from the app.';
    END IF;
    IF p_stage = 'lost' AND p_lost_reason IS NULL THEN
        RAISE EXCEPTION 'Say why the lead was lost.';
    END IF;
    UPDATE public.crm_contacts
    SET lead_stage = p_stage,
        lost_reason = CASE WHEN p_stage = 'lost' THEN p_lost_reason END,
        updated_at = now()
    WHERE id = c.id;
    PERFORM public.crm_audit(p_actor, 'crm.stage_changed', c.id,
                             jsonb_build_object('from', c.lead_stage, 'to', p_stage));
    RETURN c.id;
END $$;

-- Links a lead to a manager's account, confirmed by an admin (FR-CRM-6).
CREATE FUNCTION public.crm_link_contact(p_actor UUID, p_contact_id UUID, p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    c public.crm_contacts;
BEGIN
    SELECT * INTO c FROM public.crm_contacts WHERE id = p_contact_id AND anonymized_at IS NULL
    FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'That contact doesn''t exist.'; END IF;
    IF c.user_id IS NOT NULL THEN RAISE EXCEPTION 'This contact is already linked.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.household_managers m WHERE m.user_id = p_user_id) THEN
        RAISE EXCEPTION 'Only household managers can be linked.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.crm_contacts o WHERE o.user_id = p_user_id) THEN
        RAISE EXCEPTION 'That account already has a CRM contact.';
    END IF;
    UPDATE public.crm_contacts
    SET user_id = p_user_id, linked_at = now(), updated_at = now()
    WHERE id = c.id;
    PERFORM public.crm_audit(p_actor, 'crm.contact_linked', c.id,
                             jsonb_build_object('user_id', p_user_id));
    RETURN c.id;
END $$;

-- Unlinks a customer; it becomes a lead again at "contacted", keeping the
-- account's name and email so it still has a way to be reached.
CREATE FUNCTION public.crm_unlink_contact(p_actor UUID, p_contact_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    c public.crm_contacts;
BEGIN
    SELECT * INTO c FROM public.crm_contacts WHERE id = p_contact_id AND anonymized_at IS NULL
    FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'That contact doesn''t exist.'; END IF;
    IF c.user_id IS NULL THEN RAISE EXCEPTION 'This contact isn''t linked.'; END IF;
    UPDATE public.crm_contacts t
    SET full_name = coalesce(t.full_name, p.full_name),
        email = coalesce(t.email, u.email::TEXT),
        user_id = NULL, linked_at = NULL, lead_stage = 'contacted', lost_reason = NULL,
        updated_at = now()
    FROM auth.users u
    LEFT JOIN public.user_profiles p ON p.id = u.id
    WHERE t.id = c.id AND u.id = c.user_id;
    PERFORM public.crm_audit(p_actor, 'crm.contact_unlinked', c.id,
                             jsonb_build_object('user_id', c.user_id));
    RETURN c.id;
END $$;

-- Deletes a lead with its activities and follow-ups (FR-CRM-14).
CREATE FUNCTION public.crm_delete_lead(p_actor UUID, p_contact_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    c public.crm_contacts;
BEGIN
    SELECT * INTO c FROM public.crm_contacts WHERE id = p_contact_id FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'That contact doesn''t exist.'; END IF;
    IF c.user_id IS NOT NULL THEN
        RAISE EXCEPTION 'A customer can''t be deleted while their account exists. Unlink it instead.';
    END IF;
    PERFORM public.crm_audit(p_actor, 'crm.contact_deleted', c.id, '{}'::JSONB);
    DELETE FROM public.crm_contacts WHERE id = c.id;
END $$;

-- Records a call, message, email, meeting or note (FR-CRM-7).
CREATE FUNCTION public.crm_add_activity(
    p_actor UUID, p_contact_id UUID, p_user_id UUID, p_kind TEXT, p_body TEXT,
    p_occurred_at TIMESTAMPTZ
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_contact UUID;
    v_id UUID;
BEGIN
    IF p_occurred_at > now() + INTERVAL '5 minutes' THEN
        RAISE EXCEPTION 'An activity can''t be in the future.';
    END IF;
    v_contact := public.crm_resolve_contact(p_actor, p_contact_id, p_user_id);
    INSERT INTO public.crm_activities (contact_id, kind, body, occurred_at, author_id)
    VALUES (v_contact, p_kind, p_body, p_occurred_at, p_actor)
    RETURNING id INTO v_id;
    UPDATE public.crm_contacts SET updated_at = now() WHERE id = v_contact;
    PERFORM public.crm_audit(p_actor, 'crm.activity_added', v_contact,
                             jsonb_build_object('kind', p_kind, 'activity_id', v_id));
    RETURN v_id;
END $$;

-- Sets a follow-up with a due date, a note and the admin responsible (FR-CRM-8).
CREATE FUNCTION public.crm_add_follow_up(
    p_actor UUID, p_contact_id UUID, p_user_id UUID, p_due_at TIMESTAMPTZ, p_note TEXT,
    p_assignee_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_contact UUID;
    v_id UUID;
BEGIN
    IF p_due_at > now() + INTERVAL '365 days' THEN
        RAISE EXCEPTION 'Pick a due date within a year.';
    END IF;
    v_contact := public.crm_resolve_contact(p_actor, p_contact_id, p_user_id);
    INSERT INTO public.crm_follow_ups (contact_id, due_at, note, assignee_id, created_by)
    VALUES (v_contact, p_due_at, p_note, p_assignee_id, p_actor)
    RETURNING id INTO v_id;
    PERFORM public.crm_audit(p_actor, 'crm.follow_up_added', v_contact,
                             jsonb_build_object('follow_up_id', v_id));
    RETURN v_id;
END $$;

CREATE FUNCTION public.crm_complete_follow_up(p_actor UUID, p_follow_up_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    f public.crm_follow_ups;
BEGIN
    SELECT * INTO f FROM public.crm_follow_ups WHERE id = p_follow_up_id FOR UPDATE;
    IF f.id IS NULL THEN RAISE EXCEPTION 'That follow-up doesn''t exist.'; END IF;
    IF f.done_at IS NOT NULL THEN RAISE EXCEPTION 'That follow-up is already done.'; END IF;
    UPDATE public.crm_follow_ups SET done_at = now() WHERE id = f.id;
    PERFORM public.crm_audit(p_actor, 'crm.follow_up_done', f.contact_id,
                             jsonb_build_object('follow_up_id', f.id));
END $$;

-- ---------------------------------------------------------------- Privileges

-- Every crm_ function is for the server key only. Listing them from the
-- catalogue keeps a new function from being missed here.
DO $$
DECLARE
    f TEXT;
BEGIN
    FOR f IN
        SELECT p.oid::REGPROCEDURE::TEXT
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'crm\_%'
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END $$;

COMMIT;
