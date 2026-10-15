-- LINARA_ADMIN, Phase 3b: CRM data in and out. Apply after 005-crm-fixes.sql.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md FR-CRM-10, FR-CRM-15, S-24, S-25, D34, D35.
--
-- Apply by hand in the Supabase SQL editor: linara dev first. One transaction.
-- Adds the import, the duplicate check and the nightly lead retention, and
-- schedules the retention with pg_cron (as LINARA schedules its own jobs).
-- Changes one console column (a follow-up note may be cleared); nothing here
-- touches a main-app table.

BEGIN;

-- Anonymising clears a follow-up's note (D35); the length check still holds otherwise.
ALTER TABLE public.crm_follow_ups ALTER COLUMN note DROP NOT NULL;

-- Saved contacts matching any of these emails (ignoring case) or phones, so the
-- import preview can flag duplicates (FR-CRM-10). Anonymised contacts don't count.
CREATE FUNCTION public.crm_find_duplicates(p_emails TEXT[], p_phones TEXT[])
RETURNS TABLE (email TEXT, phone TEXT, contact_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT c.email, c.phone, c.id
    FROM public.crm_contacts c
    WHERE c.anonymized_at IS NULL
      AND (lower(c.email) = ANY (SELECT lower(e) FROM unnest(p_emails) e)
           OR c.phone = ANY (p_phones))
$$;

-- Imports a batch of leads, already checked by the console's server, all or
-- nothing, with one audit entry (FR-CRM-10, S-24, D34). Each row is
-- {full_name, email, phone, source, tags, note}.
CREATE FUNCTION public.crm_import_leads(p_actor UUID, p_rows JSONB, p_consent TEXT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    r JSONB;
    v_id UUID;
    v_first UUID;
    v_count INT := 0;
BEGIN
    IF jsonb_array_length(p_rows) > 500 THEN
        RAISE EXCEPTION 'Import at most 500 rows at a time.';
    END IF;
    IF p_consent IS NULL OR char_length(btrim(p_consent)) NOT BETWEEN 5 AND 300 THEN
        RAISE EXCEPTION 'Say how these people agreed to be contacted (5 to 300 characters).';
    END IF;

    FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
        IF r->>'email' IS NULL AND r->>'phone' IS NULL THEN
            RAISE EXCEPTION 'Row %: a lead needs an email or a phone number.', v_count + 1;
        END IF;
        INSERT INTO public.crm_contacts
            (full_name, email, phone, source, tags, consent_basis, created_by)
        VALUES (
            r->>'full_name', r->>'email', r->>'phone', r->>'source',
            coalesce(ARRAY(SELECT jsonb_array_elements_text(r->'tags')), '{}'),
            btrim(p_consent), p_actor
        )
        RETURNING id INTO v_id;
        IF r->>'note' IS NOT NULL THEN
            INSERT INTO public.crm_activities (contact_id, kind, body, occurred_at, author_id)
            VALUES (v_id, 'note', r->>'note', now(), p_actor);
        END IF;
        v_first := coalesce(v_first, v_id);
        v_count := v_count + 1;
    END LOOP;

    IF v_count > 0 THEN
        INSERT INTO public.staff_audit_log (actor_user_id, action, target_type, target_id, metadata)
        VALUES (p_actor, 'crm.imported', 'import', v_first::TEXT,
                jsonb_build_object('rows', v_count));
    END IF;
    RETURN v_count;
END $$;

-- Anonymises leads untouched for over 12 months (FR-CRM-15, S-25, D35). The
-- last touch is the latest edit, activity or follow-up; a lost lead's stage
-- change is an edit. Stage, source, owner and dates stay for reporting.
CREATE FUNCTION public.crm_run_retention(p_now TIMESTAMPTZ) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_ids UUID[];
    v_count INT;
BEGIN
    SELECT coalesce(array_agg(c.id), '{}') INTO v_ids
    FROM public.crm_contacts c
    WHERE c.user_id IS NULL
      AND c.anonymized_at IS NULL
      AND greatest(
              c.updated_at,
              (SELECT max(a.occurred_at) FROM public.crm_activities a WHERE a.contact_id = c.id),
              (SELECT max(f.created_at) FROM public.crm_follow_ups f WHERE f.contact_id = c.id)
          ) < p_now - INTERVAL '12 months';
    v_count := cardinality(v_ids);

    UPDATE public.crm_contacts
    SET full_name = NULL, email = NULL, phone = NULL, tags = '{}', lost_reason = NULL,
        consent_basis = NULL, anonymized_at = p_now
    WHERE id = ANY (v_ids);
    UPDATE public.crm_activities SET body = NULL WHERE contact_id = ANY (v_ids);
    UPDATE public.crm_follow_ups SET note = NULL WHERE contact_id = ANY (v_ids);

    -- The automatic job is the actor: no admin did this (D35).
    INSERT INTO public.staff_audit_log (actor_user_id, action, target_type, target_id, metadata)
    VALUES ('00000000-0000-0000-0000-000000000000', 'crm.retention_ran', 'contact', NULL,
            jsonb_build_object('anonymised', v_count));
    RETURN v_count;
END $$;

-- Every crm_ function is for the server key only (as in 004).
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

-- Nightly at 02:15 Manila (18:15 UTC). Re-applying replaces the job.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
        EXECUTE $q$SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'crm-retention'$q$;
        EXECUTE $q$SELECT cron.schedule('crm-retention', '15 18 * * *',
                                        'SELECT public.crm_run_retention(now())')$q$;
    END IF;
END $$;

COMMIT;

-- Check it's there, and later that it ran:
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'crm-retention';
--   SELECT status, start_time FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'crm-retention')
--   ORDER BY start_time DESC LIMIT 5;
