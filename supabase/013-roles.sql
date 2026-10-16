-- LINARA_ADMIN, Phase 7: roles. Apply after 012-operations.sql.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md §4.2, §4.3, §8.2, FR-TM-1 to FR-TM-3,
-- FR-RL-1 to FR-RL-8, D39.
--
-- Apply by hand in the Supabase SQL editor: linara dev first. One transaction.
-- Adds staff_role_defs with four locked presets, moves every member to one
-- role (existing admins become Admin), and makes every team and role change one
-- function that enforces D39 and writes its audit entry in the same
-- transaction. staff_touch_session now returns the member's permissions.
-- Nothing here touches a main-app table.

BEGIN;

-- ---------------------------------------------------------------- Permissions

-- The names in src/features/auth/permissions.ts; tests/roles.test.mjs compares the two.
CREATE FUNCTION public.staff_known_permissions() RETURNS TEXT[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT ARRAY['dashboard.view', 'crm.view', 'crm.write', 'crm.export', 'users.view',
                 'households.view', 'users.suspend', 'deletions.view', 'deletions.process',
                 'support.view', 'support.write', 'pay.view', 'payouts.view', 'ai.view',
                 'audit.view', 'team.manage']
$$;

-- Sorted and without repeats, so stored lists compare as equal.
CREATE FUNCTION public.staff_sort_permissions(p_permissions TEXT[]) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT coalesce(array_agg(DISTINCT p ORDER BY p), '{}'::TEXT[]) FROM unnest(p_permissions) p
$$;

-- ---------------------------------------------------------------- Tables

CREATE TABLE public.staff_role_defs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    preset      TEXT UNIQUE CHECK (preset IN ('admin', 'mods', 'sales', 'support')),
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40 AND name = btrim(name)),
    description TEXT CHECK (char_length(description) BETWEEN 1 AND 200),
    permissions TEXT[] NOT NULL CHECK (
        permissions <@ public.staff_known_permissions()
        AND 'dashboard.view' = ANY (permissions)
        AND (NOT 'team.manage' = ANY (permissions) OR preset IN ('admin', 'mods'))
    ),
    updated_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT date_trunc('milliseconds', now()),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_role_defs_name ON public.staff_role_defs (lower(name));

ALTER TABLE public.staff_role_defs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_role_defs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_role_defs TO service_role;

-- The presets (§4.2). No function ever updates or deletes them.
INSERT INTO public.staff_role_defs (preset, name, permissions) VALUES
    ('admin', 'Admin', public.staff_sort_permissions(public.staff_known_permissions())),
    ('mods', 'Mods', public.staff_sort_permissions(public.staff_known_permissions())),
    ('sales', 'Sales', public.staff_sort_permissions(ARRAY['dashboard.view', 'crm.view',
        'crm.write', 'crm.export', 'users.view', 'households.view'])),
    ('support', 'Support', public.staff_sort_permissions(ARRAY['dashboard.view', 'crm.view',
        'users.view', 'households.view', 'deletions.view', 'support.view', 'support.write',
        'payouts.view']));

-- One role per member; every existing member becomes Admin.
ALTER TABLE public.staff_roles
    ADD COLUMN role_id UUID REFERENCES public.staff_role_defs (id) ON DELETE RESTRICT;
UPDATE public.staff_roles
   SET role_id = (SELECT id FROM public.staff_role_defs WHERE preset = 'admin');
ALTER TABLE public.staff_roles ALTER COLUMN role_id SET NOT NULL;
ALTER TABLE public.staff_roles DROP COLUMN role;
CREATE INDEX staff_roles_role ON public.staff_roles (role_id);

-- ---------------------------------------------------------------- Session and lists

DROP FUNCTION public.staff_touch_session(UUID, UUID);
-- The one database call per console request (D31): the member's role and its
-- permissions, and the session's timing, or no row when either is gone.
CREATE FUNCTION public.staff_touch_session(p_session_id UUID, p_user_id UUID)
RETURNS TABLE (role_id UUID, role_name TEXT, preset TEXT, permissions TEXT[],
               started_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
    v_role    UUID;
    v_name    TEXT;
    v_preset  TEXT;
    v_perms   TEXT[];
    v_started TIMESTAMPTZ;
    v_seen    TIMESTAMPTZ;
BEGIN
    SELECT d.id, d.name, d.preset, d.permissions, s.created_at, s.last_seen_at
      INTO v_role, v_name, v_preset, v_perms, v_started, v_seen
      FROM public.staff_sessions s
      JOIN public.staff_roles r ON r.user_id = s.user_id
      JOIN public.staff_role_defs d ON d.id = r.role_id
     WHERE s.session_id = p_session_id AND s.user_id = p_user_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    IF v_seen < now() - INTERVAL '60 seconds' THEN
        UPDATE public.staff_sessions SET last_seen_at = now()
         WHERE session_id = p_session_id;
    END IF;
    RETURN QUERY SELECT v_role, v_name, v_preset, v_perms, v_started, v_seen;
END $$;

DROP FUNCTION public.staff_list_admins();
-- Every member with what the Team screen shows, in one query (D31).
CREATE FUNCTION public.staff_list_admins()
RETURNS TABLE (user_id UUID, email TEXT, granted_at TIMESTAMPTZ,
               last_sign_in_at TIMESTAMPTZ, two_step_set_up BOOLEAN,
               role_id UUID, role_name TEXT, preset TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT r.user_id,
           u.email::TEXT,
           r.granted_at,
           u.last_sign_in_at,
           EXISTS (
               SELECT 1 FROM auth.mfa_factors f
               WHERE f.user_id = r.user_id
                 AND f.factor_type::TEXT = 'totp'
                 AND f.status::TEXT = 'verified'
           ),
           d.id,
           d.name,
           d.preset
    FROM public.staff_roles r
    JOIN auth.users u ON u.id = r.user_id
    JOIN public.staff_role_defs d ON d.id = r.role_id
    ORDER BY r.granted_at
$$;

CREATE FUNCTION public.staff_list_roles()
RETURNS TABLE (role_id UUID, preset TEXT, name TEXT, description TEXT, permissions TEXT[],
               member_count INT, updated_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT d.id, d.preset, d.name, d.description, d.permissions,
           (SELECT count(*)::INT FROM public.staff_roles r WHERE r.role_id = d.id),
           d.updated_at
    FROM public.staff_role_defs d
    ORDER BY CASE d.preset WHEN 'admin' THEN 0 WHEN 'mods' THEN 1 WHEN 'sales' THEN 2
                           WHEN 'support' THEN 3 ELSE 4 END,
             lower(d.name)
$$;

-- ---------------------------------------------------------------- Helpers (D39)

CREATE FUNCTION public.staff_role_audit(p_actor UUID, p_action TEXT, p_target_type TEXT,
                                        p_target UUID, p_metadata JSONB) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.staff_audit_log (actor_user_id, action, target_type, target_id, metadata)
    VALUES (p_actor, p_action, p_target_type, p_target::TEXT, coalesce(p_metadata, '{}'::JSONB))
$$;

-- The actor's preset, when their role can manage the team; otherwise refuses.
CREATE FUNCTION public.staff_require_manager(p_actor UUID) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_preset TEXT;
    v_perms  TEXT[];
BEGIN
    SELECT d.preset, d.permissions INTO v_preset, v_perms
      FROM public.staff_roles r
      JOIN public.staff_role_defs d ON d.id = r.role_id
     WHERE r.user_id = p_actor;
    IF NOT FOUND OR NOT 'team.manage' = ANY (v_perms) THEN
        RAISE EXCEPTION 'Your role doesn''t allow this.' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_preset;
END $$;

-- Serialises every change that could leave no admin: two admins changing each
-- other at once queue here, and the second sees the first's result.
CREATE FUNCTION public.staff_lock_admins() RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    SELECT NULL FROM public.staff_roles r
      JOIN public.staff_role_defs d ON d.id = r.role_id
     WHERE d.preset = 'admin'
       FOR UPDATE OF r
$$;

CREATE FUNCTION public.staff_admin_count() RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT count(*)::INT FROM public.staff_roles r
      JOIN public.staff_role_defs d ON d.id = r.role_id
     WHERE d.preset = 'admin'
$$;

-- Refuses a custom role's name, description or permissions (FR-RL-3).
CREATE FUNCTION public.staff_check_role(p_name TEXT, p_description TEXT, p_permissions TEXT[],
                                        p_role_id UUID) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_name IS NULL OR char_length(p_name) NOT BETWEEN 1 AND 40 THEN
        RAISE EXCEPTION 'Give the role a name of 1 to 40 characters.' USING ERRCODE = 'P0001';
    END IF;
    IF char_length(p_description) > 200 THEN
        RAISE EXCEPTION 'Keep the description to 200 characters.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT p_permissions <@ public.staff_known_permissions() THEN
        RAISE EXCEPTION 'Pick permissions from the list.' USING ERRCODE = 'P0001';
    END IF;
    IF 'team.manage' = ANY (p_permissions) THEN
        RAISE EXCEPTION 'Custom roles can''t manage the team.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT 'dashboard.view' = ANY (p_permissions) THEN
        RAISE EXCEPTION 'Every role needs the dashboard.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.staff_role_defs d
                WHERE lower(d.name) = lower(p_name) AND d.id IS DISTINCT FROM p_role_id) THEN
        RAISE EXCEPTION 'A role with that name already exists.' USING ERRCODE = 'P0001';
    END IF;
END $$;

-- ---------------------------------------------------------------- Role writes (D39)

CREATE FUNCTION public.staff_create_role(p_actor UUID, p_name TEXT, p_description TEXT,
                                         p_permissions TEXT[]) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_name  TEXT := btrim(p_name);
    v_desc  TEXT := nullif(btrim(p_description), '');
    v_perms TEXT[] := public.staff_sort_permissions(p_permissions);
    v_id    UUID;
BEGIN
    PERFORM public.staff_require_manager(p_actor);
    PERFORM public.staff_check_role(v_name, v_desc, v_perms, NULL);
    INSERT INTO public.staff_role_defs (name, description, permissions, updated_by)
    VALUES (v_name, v_desc, v_perms, p_actor)
    RETURNING id INTO v_id;
    PERFORM public.staff_role_audit(p_actor, 'role.created', 'role', v_id,
                                    jsonb_build_object('permissions', to_jsonb(v_perms)));
    RETURN v_id;
END $$;

CREATE FUNCTION public.staff_update_role(p_actor UUID, p_role_id UUID, p_name TEXT,
                                         p_description TEXT, p_permissions TEXT[],
                                         p_seen_updated_at TIMESTAMPTZ, p_code_checked BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_row     public.staff_role_defs;
    v_name    TEXT := btrim(p_name);
    v_desc    TEXT := nullif(btrim(p_description), '');
    v_perms   TEXT[] := public.staff_sort_permissions(p_permissions);
    v_added   TEXT[];
    v_removed TEXT[];
BEGIN
    PERFORM public.staff_require_manager(p_actor);
    SELECT * INTO v_row FROM public.staff_role_defs WHERE id = p_role_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That role doesn''t exist.' USING ERRCODE = 'P0001';
    END IF;
    IF v_row.preset IS NOT NULL THEN
        RAISE EXCEPTION 'Preset roles can''t be changed.' USING ERRCODE = 'P0001';
    END IF;
    IF date_trunc('milliseconds', v_row.updated_at)
       IS DISTINCT FROM date_trunc('milliseconds', p_seen_updated_at) THEN
        RAISE EXCEPTION 'Someone else changed this role. Reload to see their changes.'
            USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.staff_check_role(v_name, v_desc, v_perms, p_role_id);

    v_added := ARRAY(SELECT unnest(v_perms) EXCEPT SELECT unnest(v_row.permissions) ORDER BY 1);
    v_removed := ARRAY(SELECT unnest(v_row.permissions) EXCEPT SELECT unnest(v_perms) ORDER BY 1);
    IF v_name = v_row.name AND v_desc IS NOT DISTINCT FROM v_row.description
       AND cardinality(v_added) = 0 AND cardinality(v_removed) = 0 THEN
        RETURN;
    END IF;
    IF (cardinality(v_added) > 0 OR cardinality(v_removed) > 0) AND NOT p_code_checked THEN
        RAISE EXCEPTION 'Enter your two-step code to make this change.' USING ERRCODE = 'P0001';
    END IF;

    -- Millisecond precision, so the browser can hand it back unchanged; always later.
    UPDATE public.staff_role_defs
       SET name = v_name, description = v_desc, permissions = v_perms, updated_by = p_actor,
           updated_at = greatest(date_trunc('milliseconds', clock_timestamp()),
                                 v_row.updated_at + INTERVAL '1 millisecond')
     WHERE id = p_role_id;
    PERFORM public.staff_role_audit(p_actor, 'role.updated', 'role', p_role_id,
        jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed),
                           'renamed', v_name <> v_row.name));
END $$;

CREATE FUNCTION public.staff_delete_role(p_actor UUID, p_role_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_preset  TEXT;
    v_members INT;
BEGIN
    PERFORM public.staff_require_manager(p_actor);
    SELECT preset INTO v_preset FROM public.staff_role_defs WHERE id = p_role_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That role doesn''t exist.' USING ERRCODE = 'P0001';
    END IF;
    IF v_preset IS NOT NULL THEN
        RAISE EXCEPTION 'Preset roles can''t be changed.' USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*)::INT INTO v_members FROM public.staff_roles WHERE role_id = p_role_id;
    IF v_members = 1 THEN
        RAISE EXCEPTION '1 member has this role. Give them another role first.'
            USING ERRCODE = 'P0001';
    ELSIF v_members > 1 THEN
        RAISE EXCEPTION '% members have this role. Give them another role first.', v_members
            USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.staff_role_defs WHERE id = p_role_id;
    PERFORM public.staff_role_audit(p_actor, 'role.deleted', 'role', p_role_id, '{}'::JSONB);
END $$;

-- ---------------------------------------------------------------- Member writes (D39)

CREATE FUNCTION public.staff_add_member(p_actor UUID, p_user_id UUID, p_role_id UUID,
                                        p_code_checked BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_actor TEXT;
    v_new   TEXT;
BEGIN
    PERFORM public.staff_lock_admins();
    v_actor := public.staff_require_manager(p_actor);
    SELECT preset INTO v_new FROM public.staff_role_defs WHERE id = p_role_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That role doesn''t exist.' USING ERRCODE = 'P0001';
    END IF;
    IF v_actor = 'mods' AND v_new IN ('admin', 'mods') THEN
        RAISE EXCEPTION 'Mods can''t give the admin or mods role.' USING ERRCODE = 'P0001';
    END IF;
    IF v_new IN ('admin', 'mods') AND NOT p_code_checked THEN
        RAISE EXCEPTION 'Enter your two-step code to make this change.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.staff_roles WHERE user_id = p_user_id) THEN
        RAISE EXCEPTION 'That email is already on the team.' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.staff_roles (user_id, role_id, granted_by)
    VALUES (p_user_id, p_role_id, p_actor);
    PERFORM public.staff_role_audit(p_actor, 'staff.added', 'staff', p_user_id,
                                    jsonb_build_object('role_id', p_role_id));
END $$;

CREATE FUNCTION public.staff_set_member_role(p_actor UUID, p_user_id UUID, p_role_id UUID,
                                             p_code_checked BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_actor       TEXT;
    v_from        UUID;
    v_from_preset TEXT;
    v_new         TEXT;
BEGIN
    PERFORM public.staff_lock_admins();
    v_actor := public.staff_require_manager(p_actor);
    IF p_user_id = p_actor THEN
        RAISE EXCEPTION 'You can''t change your own role.' USING ERRCODE = 'P0001';
    END IF;
    SELECT r.role_id, d.preset INTO v_from, v_from_preset
      FROM public.staff_roles r
      JOIN public.staff_role_defs d ON d.id = r.role_id
     WHERE r.user_id = p_user_id
       FOR UPDATE OF r;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That person isn''t on the team.' USING ERRCODE = 'P0001';
    END IF;
    IF v_actor = 'mods' AND v_from_preset IN ('admin', 'mods') THEN
        RAISE EXCEPTION 'Mods can only change sales, support and custom-role members.'
            USING ERRCODE = 'P0001';
    END IF;
    SELECT preset INTO v_new FROM public.staff_role_defs WHERE id = p_role_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That role doesn''t exist.' USING ERRCODE = 'P0001';
    END IF;
    IF v_actor = 'mods' AND v_new IN ('admin', 'mods') THEN
        RAISE EXCEPTION 'Mods can''t give the admin or mods role.' USING ERRCODE = 'P0001';
    END IF;
    IF v_from = p_role_id THEN
        RETURN;
    END IF;
    IF v_new IN ('admin', 'mods') AND NOT p_code_checked THEN
        RAISE EXCEPTION 'Enter your two-step code to make this change.' USING ERRCODE = 'P0001';
    END IF;
    IF v_from_preset = 'admin' AND public.staff_admin_count() <= 1 THEN
        RAISE EXCEPTION 'There has to be at least one admin.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.staff_roles SET role_id = p_role_id, granted_by = p_actor, granted_at = now()
     WHERE user_id = p_user_id;
    PERFORM public.staff_role_audit(p_actor, 'staff.role_changed', 'staff', p_user_id,
        jsonb_build_object('from_role_id', v_from, 'to_role_id', p_role_id));
END $$;

-- The server ends the member's sessions after this (FR-TM-3).
CREATE FUNCTION public.staff_remove_member(p_actor UUID, p_user_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_actor  TEXT;
    v_preset TEXT;
BEGIN
    PERFORM public.staff_lock_admins();
    v_actor := public.staff_require_manager(p_actor);
    IF p_user_id = p_actor THEN
        RAISE EXCEPTION 'You can''t remove yourself.' USING ERRCODE = 'P0001';
    END IF;
    SELECT d.preset INTO v_preset
      FROM public.staff_roles r
      JOIN public.staff_role_defs d ON d.id = r.role_id
     WHERE r.user_id = p_user_id
       FOR UPDATE OF r;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That person isn''t on the team.' USING ERRCODE = 'P0001';
    END IF;
    IF v_actor = 'mods' AND v_preset IN ('admin', 'mods') THEN
        RAISE EXCEPTION 'Mods can only change sales, support and custom-role members.'
            USING ERRCODE = 'P0001';
    END IF;
    IF v_preset = 'admin' AND public.staff_admin_count() <= 1 THEN
        RAISE EXCEPTION 'There has to be at least one admin.' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.staff_roles WHERE user_id = p_user_id;
    PERFORM public.staff_role_audit(p_actor, 'staff.removed', 'staff', p_user_id, '{}'::JSONB);
END $$;

-- ---------------------------------------------------------------- Grants

DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.staff_known_permissions()',
        'public.staff_sort_permissions(TEXT[])',
        'public.staff_touch_session(UUID, UUID)',
        'public.staff_list_admins()',
        'public.staff_list_roles()',
        'public.staff_role_audit(UUID, TEXT, TEXT, UUID, JSONB)',
        'public.staff_require_manager(UUID)',
        'public.staff_lock_admins()',
        'public.staff_admin_count()',
        'public.staff_check_role(TEXT, TEXT, TEXT[], UUID)',
        'public.staff_create_role(UUID, TEXT, TEXT, TEXT[])',
        'public.staff_update_role(UUID, UUID, TEXT, TEXT, TEXT[], TIMESTAMPTZ, BOOLEAN)',
        'public.staff_delete_role(UUID, UUID)',
        'public.staff_add_member(UUID, UUID, UUID, BOOLEAN)',
        'public.staff_set_member_role(UUID, UUID, UUID, BOOLEAN)',
        'public.staff_remove_member(UUID, UUID)'
    ] LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END $$;

COMMIT;
