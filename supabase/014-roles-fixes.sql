-- LINARA_ADMIN, Phase 7 review fixes. Apply after 013-roles.sql.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md D39.
--
-- Apply by hand in the Supabase SQL editor: linara dev first. One transaction.
-- 1. The table rule keeping team.manage off custom roles let it through: for a
--    custom role the preset is null, and a null CHECK passes. Now it can't.
-- 2. Only the admin and mods presets manage the team, whatever a role holds,
--    and the mod limits apply to everyone who isn't admin, so a role that
--    somehow holds team.manage can't skip them.
-- 3. A missing (null) code flag counts as no code.
-- 4. The code covers any new access (spec 0.19): creating a custom role and
--    giving admin, mods or a custom role. Giving sales or support doesn't.
-- 5. Plain wording for the Team screen (see the end of this file).
-- Replaces six functions with the same signatures, so their grants stay, and
-- staff_create_role with a new p_code_checked argument (granted below).

BEGIN;

DO $$
DECLARE c TEXT;
BEGIN
    SELECT conname INTO c FROM pg_constraint
     WHERE conrelid = 'public.staff_role_defs'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%team.manage%';
    EXECUTE format('ALTER TABLE public.staff_role_defs DROP CONSTRAINT %I', c);
END $$;

ALTER TABLE public.staff_role_defs ADD CONSTRAINT staff_role_defs_permissions_rule CHECK (
    permissions <@ public.staff_known_permissions()
    AND 'dashboard.view' = ANY (permissions)
    AND (NOT 'team.manage' = ANY (permissions) OR coalesce(preset IN ('admin', 'mods'), false))
);

-- The actor's preset, when it is admin or mods and holds team.manage; otherwise refuses.
CREATE OR REPLACE FUNCTION public.staff_require_manager(p_actor UUID) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_preset TEXT;
    v_perms  TEXT[];
BEGIN
    SELECT d.preset, d.permissions INTO v_preset, v_perms
      FROM public.staff_roles r
      JOIN public.staff_role_defs d ON d.id = r.role_id
     WHERE r.user_id = p_actor;
    IF NOT FOUND OR v_preset IS NULL OR v_preset NOT IN ('admin', 'mods')
       OR NOT 'team.manage' = ANY (v_perms) THEN
        RAISE EXCEPTION 'Your role doesn''t allow this.' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_preset;
END $$;

CREATE OR REPLACE FUNCTION public.staff_add_member(p_actor UUID, p_user_id UUID, p_role_id UUID,
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
    IF v_actor <> 'admin' AND v_new IN ('admin', 'mods') THEN
        RAISE EXCEPTION 'Mods can''t give the admin or mods role.' USING ERRCODE = 'P0001';
    END IF;
    IF (v_new IS NULL OR v_new IN ('admin', 'mods')) AND p_code_checked IS NOT TRUE THEN
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

CREATE OR REPLACE FUNCTION public.staff_set_member_role(p_actor UUID, p_user_id UUID,
                                                        p_role_id UUID, p_code_checked BOOLEAN)
RETURNS VOID
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
    IF v_actor <> 'admin' AND v_from_preset IN ('admin', 'mods') THEN
        RAISE EXCEPTION 'Mods can only change sales, support and custom-role members.'
            USING ERRCODE = 'P0001';
    END IF;
    SELECT preset INTO v_new FROM public.staff_role_defs WHERE id = p_role_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That role doesn''t exist.' USING ERRCODE = 'P0001';
    END IF;
    IF v_actor <> 'admin' AND v_new IN ('admin', 'mods') THEN
        RAISE EXCEPTION 'Mods can''t give the admin or mods role.' USING ERRCODE = 'P0001';
    END IF;
    IF v_from = p_role_id THEN
        RETURN;
    END IF;
    IF (v_new IS NULL OR v_new IN ('admin', 'mods')) AND p_code_checked IS NOT TRUE THEN
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
CREATE OR REPLACE FUNCTION public.staff_remove_member(p_actor UUID, p_user_id UUID) RETURNS VOID
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
    IF v_actor <> 'admin' AND v_preset IN ('admin', 'mods') THEN
        RAISE EXCEPTION 'Mods can only change sales, support and custom-role members.'
            USING ERRCODE = 'P0001';
    END IF;
    IF v_preset = 'admin' AND public.staff_admin_count() <= 1 THEN
        RAISE EXCEPTION 'There has to be at least one admin.' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.staff_roles WHERE user_id = p_user_id;
    PERFORM public.staff_role_audit(p_actor, 'staff.removed', 'staff', p_user_id, '{}'::JSONB);
END $$;

DROP FUNCTION public.staff_create_role(UUID, TEXT, TEXT, TEXT[]);
CREATE FUNCTION public.staff_create_role(p_actor UUID, p_name TEXT, p_description TEXT,
                                         p_permissions TEXT[], p_code_checked BOOLEAN)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_name  TEXT := btrim(p_name);
    v_desc  TEXT := nullif(btrim(p_description), '');
    v_perms TEXT[] := public.staff_sort_permissions(p_permissions);
    v_id    UUID;
BEGIN
    PERFORM public.staff_require_manager(p_actor);
    PERFORM public.staff_check_role(v_name, v_desc, v_perms, NULL);
    IF p_code_checked IS NOT TRUE THEN
        RAISE EXCEPTION 'Enter your two-step code to make this change.' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.staff_role_defs (name, description, permissions, updated_by)
    VALUES (v_name, v_desc, v_perms, p_actor)
    RETURNING id INTO v_id;
    PERFORM public.staff_role_audit(p_actor, 'role.created', 'role', v_id,
                                    jsonb_build_object('permissions', to_jsonb(v_perms)));
    RETURN v_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.staff_create_role(UUID, TEXT, TEXT, TEXT[], BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_create_role(UUID, TEXT, TEXT, TEXT[], BOOLEAN)
    TO service_role;

-- 5. Wording now that members have roles (spec 0.20): the Team screen, a team
--    member. Copies of 010's staff_process_deletion and 011's
--    support_check_assignee with only the message changed; same signatures,
--    so their grants stay.
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

    -- Ids only (FR-DL-5, S-22).
    INSERT INTO public.staff_audit_log (actor_user_id, action, target_type, target_id, metadata)
    VALUES (p_actor, 'deletion.processed', 'user', r.user_id::TEXT,
            jsonb_build_object('request_id', r.id, 'user_type', v_kind));
    RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.support_check_assignee(p_assignee_id UUID) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_assignee_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.staff_roles WHERE user_id = p_assignee_id) THEN
        RAISE EXCEPTION 'Pick a current team member.';
    END IF;
END $$;

COMMIT;
