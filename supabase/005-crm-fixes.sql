-- LINARA_ADMIN, Phase 3a review fixes. Apply after 004-crm.sql.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md FR-CRM-12, NFR-7, D31.
--
-- Opening one contact read every household and task (it built the whole CRM
-- list to find one row). It now reads only that person's own homes. Replaces
-- one function with the same signature; grants are kept. No table changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.crm_get_contact(
    p_contact_id UUID, p_user_id UUID, p_now TIMESTAMPTZ, p_active_days INT,
    p_at_risk_days INT
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    c public.crm_contacts;
    v_user UUID;
    v_homes UUID[];
    v_households JSONB;
    v_best TEXT;
    v_roles JSONB;
    v_name TEXT;
    v_email TEXT;
    v_joined TIMESTAMPTZ;
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

    IF v_user IS NOT NULL THEN
        SELECT array_agg(DISTINCT m.household_id), to_jsonb(array_agg(DISTINCT m.role))
        INTO v_homes, v_roles
        FROM public.household_managers m WHERE m.user_id = v_user;

        SELECT p.full_name, u.email::TEXT, u.created_at INTO v_name, v_email, v_joined
        FROM auth.users u LEFT JOIN public.user_profiles p ON p.id = u.id
        WHERE u.id = v_user;

        -- One pass over this person's homes gives both the list and the best stage.
        WITH facts AS (
            SELECT f.*, h.name, m.role
            FROM public.crm_household_facts(v_homes, p_now, p_active_days, p_at_risk_days) f
            JOIN public.households h ON h.id = f.household_id
            JOIN public.household_managers m ON m.household_id = h.id AND m.user_id = v_user
        )
        SELECT
            coalesce(jsonb_agg(jsonb_build_object(
                         'household_id', household_id, 'name', name, 'role', role,
                         'stage', stage, 'last_activity_at', last_activity_at)
                     ORDER BY public.crm_stage_rank(stage) DESC, name), '[]'::JSONB),
            (array_agg(stage ORDER BY public.crm_stage_rank(stage) DESC))[1]
        INTO v_households, v_best
        FROM facts;
    END IF;

    RETURN jsonb_build_object(
        'contact_id', c.id,
        'user_id', v_user,
        'full_name', coalesce(v_name, c.full_name),
        'email', coalesce(v_email, c.email),
        'phone', c.phone,
        'kind', CASE WHEN v_user IS NULL THEN 'lead' ELSE 'customer' END,
        'stage', CASE WHEN v_user IS NULL THEN c.lead_stage
                      ELSE coalesce(v_best, 'signed_up') END,
        'source', c.source,
        'owner_id', c.owner_id,
        'tags', coalesce(to_jsonb(c.tags), '[]'::JSONB),
        'roles', coalesce(v_roles, '[]'::JSONB),
        'household_count', coalesce(cardinality(v_homes), 0),
        'next_follow_up_at', (SELECT min(fu.due_at) FROM public.crm_follow_ups fu
                              WHERE fu.contact_id = c.id AND fu.done_at IS NULL),
        'created_at', coalesce(c.created_at, v_joined),
        'lead_stage', CASE WHEN v_user IS NULL THEN c.lead_stage END,
        'lost_reason', c.lost_reason,
        'consent_basis', c.consent_basis,
        'linked_at', c.linked_at,
        'households', coalesce(v_households, '[]'::JSONB),
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

COMMIT;
