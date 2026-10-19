-- LINARA_ADMIN, business console: billing plans and the free-tier switch.
-- Apply after 015-business-permissions.sql. Safe to run twice.
-- Spec: LINARA docs/superpowers/specs/2026-10-19-sell-linara-design.md (plans).
--
-- Apply by hand in the Supabase SQL editor: linara dev first. One transaction.
-- billing_plans holds the plans staff price; money is integer centavos (PHP,
-- tax-inclusive). NULL included_* means unlimited seats; NULL extra_*_centavos
-- means extra seats cannot be bought. billing_settings is one row (id = 1)
-- holding the free-tier switch. Both tables are closed to the app roles; staff
-- write through the billing_* functions below, which audit in the same
-- transaction with ids only, never amounts (S-22).
--
-- Documented exceptions to the console's staff-only rule: the public site and
-- the household app read through billing_public_plans() (anon, authenticated)
-- and billing_settings_public() (authenticated). Both return only what the
-- pricing page and the seat limits need.

BEGIN;

-- ---------------------------------------------------------------- Tables

CREATE TABLE IF NOT EXISTS public.billing_plans (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
    tagline                TEXT NOT NULL DEFAULT '',
    inclusions             TEXT[] NOT NULL DEFAULT '{}',
    interval               TEXT NOT NULL CHECK (interval IN ('one_time', 'monthly', 'yearly')),
    base_centavos          BIGINT NOT NULL DEFAULT 0 CHECK (base_centavos >= 0),
    included_helpers       INT NULL CHECK (included_helpers >= 0),
    included_managers      INT NULL CHECK (included_managers >= 0),
    included_homes         INT NULL CHECK (included_homes >= 0),
    extra_helper_centavos  BIGINT NULL CHECK (extra_helper_centavos >= 0),
    extra_manager_centavos BIGINT NULL CHECK (extra_manager_centavos >= 0),
    extra_home_centavos    BIGINT NULL CHECK (extra_home_centavos >= 0),
    trial_days             INT NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
    is_public              BOOLEAN NOT NULL DEFAULT false,
    status                 TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'active', 'archived')),
    sort_order             INT NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_plans_public_idx
    ON public.billing_plans (status, is_public, sort_order);

CREATE TABLE IF NOT EXISTS public.billing_settings (
    id                 INT PRIMARY KEY CHECK (id = 1),
    free_tier_enabled  BOOLEAN NOT NULL DEFAULT true,
    free_helper_seats  INT NULL CHECK (free_helper_seats >= 0),
    free_manager_seats INT NULL CHECK (free_manager_seats >= 0),
    support_email      TEXT NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.billing_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.billing_touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS billing_plans_touch ON public.billing_plans;
CREATE TRIGGER billing_plans_touch BEFORE UPDATE ON public.billing_plans
    FOR EACH ROW EXECUTE FUNCTION public.billing_touch_updated_at();
DROP TRIGGER IF EXISTS billing_settings_touch ON public.billing_settings;
CREATE TRIGGER billing_settings_touch BEFORE UPDATE ON public.billing_settings
    FOR EACH ROW EXECUTE FUNCTION public.billing_touch_updated_at();

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_plans, public.billing_settings FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- Audit

CREATE OR REPLACE FUNCTION public.billing_audit(
    p_actor UUID, p_action TEXT, p_target_type TEXT, p_target_id TEXT, p_metadata JSONB
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.staff_audit_log (actor_user_id, action, target_type, target_id, metadata)
    VALUES (p_actor, p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::JSONB))
$$;

-- ---------------------------------------------------------------- Public reads

-- What the pricing page shows: active, public plans in display order.
CREATE OR REPLACE FUNCTION public.billing_public_plans() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.sort_order, p.name, p.id), '[]'::JSONB)
    FROM public.billing_plans p
    WHERE p.status = 'active' AND p.is_public
$$;

-- The free-tier switch, for signed-in households.
CREATE OR REPLACE FUNCTION public.billing_settings_public() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT to_jsonb(s) FROM public.billing_settings s WHERE s.id = 1
$$;

-- ---------------------------------------------------------------- Input checks

-- An integer field from a JSON document: the default when absent, NULL when
-- null (if p_null allows it), otherwise a whole number from 0 to p_max.
CREATE OR REPLACE FUNCTION public.billing_json_int(
    p_doc JSONB, p_key TEXT, p_label TEXT, p_null BOOLEAN, p_default BIGINT, p_max NUMERIC
) RETURNS BIGINT
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
    v JSONB := p_doc -> p_key;
    n NUMERIC;
BEGIN
    IF v IS NULL THEN RETURN p_default; END IF;
    IF jsonb_typeof(v) = 'null' THEN
        IF p_null THEN RETURN NULL; END IF;
        RAISE EXCEPTION '% must be a whole number.', p_label USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_typeof(v) <> 'number' THEN
        RAISE EXCEPTION '% must be a whole number.', p_label USING ERRCODE = 'P0001';
    END IF;
    n := (v #>> '{}')::NUMERIC;
    IF n <> trunc(n) THEN
        RAISE EXCEPTION '% must be a whole number.', p_label USING ERRCODE = 'P0001';
    END IF;
    IF n < 0 THEN
        RAISE EXCEPTION '% can''t be negative.', p_label USING ERRCODE = 'P0001';
    END IF;
    IF n > p_max THEN
        RAISE EXCEPTION '% is too large.', p_label USING ERRCODE = 'P0001';
    END IF;
    RETURN n::BIGINT;
END $$;

-- A text field: the default when absent or null; otherwise trimmed text within the limit.
CREATE OR REPLACE FUNCTION public.billing_json_text(
    p_doc JSONB, p_key TEXT, p_label TEXT, p_max INT, p_default TEXT
) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
    v JSONB := p_doc -> p_key;
    s TEXT;
BEGIN
    IF v IS NULL OR jsonb_typeof(v) = 'null' THEN RETURN p_default; END IF;
    IF jsonb_typeof(v) <> 'string' THEN
        RAISE EXCEPTION '% must be text.', p_label USING ERRCODE = 'P0001';
    END IF;
    s := btrim(v #>> '{}');
    IF char_length(s) > p_max THEN
        RAISE EXCEPTION '% is too long (% characters at most).', p_label, p_max
            USING ERRCODE = 'P0001';
    END IF;
    RETURN s;
END $$;

-- A yes/no field: the default when absent.
CREATE OR REPLACE FUNCTION public.billing_json_bool(
    p_doc JSONB, p_key TEXT, p_label TEXT, p_default BOOLEAN
) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
    v JSONB := p_doc -> p_key;
BEGIN
    IF v IS NULL THEN RETURN p_default; END IF;
    IF jsonb_typeof(v) <> 'boolean' THEN
        RAISE EXCEPTION '% must be yes or no.', p_label USING ERRCODE = 'P0001';
    END IF;
    RETURN (v #>> '{}')::BOOLEAN;
END $$;

-- ---------------------------------------------------------------- Staff reads

CREATE OR REPLACE FUNCTION public.billing_list_plans(p_actor UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.sort_order, p.name, p.id), '[]'::JSONB)
    FROM public.billing_plans p
$$;

CREATE OR REPLACE FUNCTION public.billing_get_settings(p_actor UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT to_jsonb(s) FROM public.billing_settings s WHERE s.id = 1
$$;

-- ---------------------------------------------------------------- Staff writes

-- Creates a plan (no "id") or replaces every field of one (with "id") except its
-- status, which only billing_set_plan_status changes. Absent optional fields
-- take their defaults; absent or null seat limits mean unlimited / not sold.
-- A plan anyone has subscribed to keeps its interval: its subscriptions' periods
-- and renewals follow it. billing_subscriptions comes with 017, which runs
-- after this file, so the check looks the table up first (before 017, no plan
-- has subscribers).
CREATE OR REPLACE FUNCTION public.billing_save_plan(p_actor UUID, p_plan JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_id UUID;
    v_name TEXT;
    v_interval TEXT;
    v_tagline TEXT;
    v_inclusions TEXT[];
    v_item JSONB;
    v_text TEXT;
    v_base BIGINT;
    v_inc_h BIGINT;
    v_inc_m BIGINT;
    v_inc_o BIGINT;
    v_ext_h BIGINT;
    v_ext_m BIGINT;
    v_ext_o BIGINT;
    v_trial BIGINT;
    v_public BOOLEAN;
    v_sort BIGINT;
    v_created BOOLEAN;
    v_old_interval TEXT;
    c_money CONSTANT NUMERIC := 1000000000000;
    c_int CONSTANT NUMERIC := 2147483647;
BEGIN
    IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'object' THEN
        RAISE EXCEPTION 'Send the plan as a set of fields.' USING ERRCODE = 'P0001';
    END IF;

    v_name := public.billing_json_text(p_plan, 'name', 'The plan name', 60, NULL);
    IF v_name IS NULL OR char_length(v_name) < 1 THEN
        RAISE EXCEPTION 'The plan needs a name (1 to 60 characters).' USING ERRCODE = 'P0001';
    END IF;
    v_interval := public.billing_json_text(p_plan, 'interval', 'The billing interval', 20, NULL);
    IF v_interval IS NULL OR v_interval NOT IN ('one_time', 'monthly', 'yearly') THEN
        RAISE EXCEPTION 'The billing interval must be one time, monthly or yearly.'
            USING ERRCODE = 'P0001';
    END IF;
    v_tagline := public.billing_json_text(p_plan, 'tagline', 'The tagline', 200, '');

    v_inclusions := '{}';
    IF p_plan -> 'inclusions' IS NOT NULL AND jsonb_typeof(p_plan -> 'inclusions') <> 'null' THEN
        IF jsonb_typeof(p_plan -> 'inclusions') <> 'array' THEN
            RAISE EXCEPTION 'The inclusions must be a list of short sentences.'
                USING ERRCODE = 'P0001';
        END IF;
        IF jsonb_array_length(p_plan -> 'inclusions') > 20 THEN
            RAISE EXCEPTION 'A plan can list 20 inclusions at most.' USING ERRCODE = 'P0001';
        END IF;
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_plan -> 'inclusions') LOOP
            IF jsonb_typeof(v_item) <> 'string' THEN
                RAISE EXCEPTION 'The inclusions must be a list of short sentences.'
                    USING ERRCODE = 'P0001';
            END IF;
            v_text := btrim(v_item #>> '{}');
            IF char_length(v_text) = 0 THEN CONTINUE; END IF;
            IF char_length(v_text) > 200 THEN
                RAISE EXCEPTION 'Each inclusion can be 200 characters at most.'
                    USING ERRCODE = 'P0001';
            END IF;
            v_inclusions := v_inclusions || v_text;
        END LOOP;
    END IF;

    v_base := public.billing_json_int(p_plan, 'base_centavos', 'The base price', false, 0, c_money);
    v_inc_h := public.billing_json_int(p_plan, 'included_helpers', 'Included helpers', true, NULL, c_int);
    v_inc_m := public.billing_json_int(p_plan, 'included_managers', 'Included managers', true, NULL, c_int);
    v_inc_o := public.billing_json_int(p_plan, 'included_homes', 'Included homes', true, NULL, c_int);
    v_ext_h := public.billing_json_int(p_plan, 'extra_helper_centavos', 'The extra helper price', true, NULL, c_money);
    v_ext_m := public.billing_json_int(p_plan, 'extra_manager_centavos', 'The extra manager price', true, NULL, c_money);
    v_ext_o := public.billing_json_int(p_plan, 'extra_home_centavos', 'The extra home price', true, NULL, c_money);
    v_trial := public.billing_json_int(p_plan, 'trial_days', 'The trial length', false, 0, 3650);
    v_sort := public.billing_json_int(p_plan, 'sort_order', 'The sort order', false, 0, c_int);
    v_public := public.billing_json_bool(p_plan, 'is_public', 'Showing the plan publicly', false);

    IF p_plan -> 'id' IS NULL OR jsonb_typeof(p_plan -> 'id') = 'null' THEN
        INSERT INTO public.billing_plans
            (name, tagline, inclusions, interval, base_centavos, included_helpers,
             included_managers, included_homes, extra_helper_centavos, extra_manager_centavos,
             extra_home_centavos, trial_days, is_public, sort_order)
        VALUES (v_name, v_tagline, v_inclusions, v_interval, v_base, v_inc_h, v_inc_m, v_inc_o,
                v_ext_h, v_ext_m, v_ext_o, v_trial, v_public, v_sort)
        RETURNING id INTO v_id;
        v_created := true;
    ELSE
        BEGIN
            v_id := (p_plan ->> 'id')::UUID;
        EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'That plan doesn''t exist.' USING ERRCODE = 'P0001';
        END;
        SELECT p.interval INTO v_old_interval FROM public.billing_plans p
        WHERE p.id = v_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'That plan doesn''t exist.' USING ERRCODE = 'P0001';
        END IF;
        IF v_interval <> v_old_interval
           AND to_regclass('public.billing_subscriptions') IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM public.billing_subscriptions s WHERE s.plan_id = v_id) THEN
                RAISE EXCEPTION 'This plan has subscribers; make a new plan to change how often it bills.'
                    USING ERRCODE = 'P0001';
            END IF;
        END IF;
        UPDATE public.billing_plans
        SET name = v_name, tagline = v_tagline, inclusions = v_inclusions, interval = v_interval,
            base_centavos = v_base, included_helpers = v_inc_h, included_managers = v_inc_m,
            included_homes = v_inc_o, extra_helper_centavos = v_ext_h,
            extra_manager_centavos = v_ext_m, extra_home_centavos = v_ext_o,
            trial_days = v_trial, is_public = v_public, sort_order = v_sort
        WHERE id = v_id;
        v_created := false;
    END IF;

    PERFORM public.billing_audit(p_actor, 'billing.plan_saved', 'plan', v_id::TEXT,
        jsonb_build_object('plan_id', v_id, 'created', v_created));
    RETURN v_id;
END $$;

-- draft -> active; active -> draft or archived; archived -> draft.
CREATE OR REPLACE FUNCTION public.billing_set_plan_status(
    p_actor UUID, p_plan_id UUID, p_status TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    p public.billing_plans;
BEGIN
    IF p_status IS NULL OR p_status NOT IN ('draft', 'active', 'archived') THEN
        RAISE EXCEPTION 'A plan''s status must be draft, active or archived.'
            USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO p FROM public.billing_plans WHERE id = p_plan_id FOR UPDATE;
    IF p.id IS NULL THEN
        RAISE EXCEPTION 'That plan doesn''t exist.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT ((p.status = 'draft' AND p_status = 'active')
            OR (p.status = 'active' AND p_status IN ('draft', 'archived'))
            OR (p.status = 'archived' AND p_status = 'draft')) THEN
        RAISE EXCEPTION 'A % plan can''t be moved to %.', p.status, p_status
            USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.billing_plans SET status = p_status WHERE id = p.id;
    PERFORM public.billing_audit(p_actor, 'billing.plan_status', 'plan', p.id::TEXT,
        jsonb_build_object('plan_id', p.id, 'from', p.status, 'to', p_status));
END $$;

CREATE OR REPLACE FUNCTION public.billing_save_settings(p_actor UUID, p_settings JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_enabled BOOLEAN;
    v_helpers BIGINT;
    v_managers BIGINT;
    v_email TEXT;
BEGIN
    IF p_settings IS NULL OR jsonb_typeof(p_settings) <> 'object' THEN
        RAISE EXCEPTION 'Send the settings as a set of fields.' USING ERRCODE = 'P0001';
    END IF;
    IF p_settings -> 'free_tier_enabled' IS NULL THEN
        RAISE EXCEPTION 'Say whether the free tier is on.' USING ERRCODE = 'P0001';
    END IF;
    v_enabled := public.billing_json_bool(p_settings, 'free_tier_enabled', 'The free tier switch', true);
    v_helpers := public.billing_json_int(p_settings, 'free_helper_seats', 'Free helper seats', true, NULL, 2147483647);
    v_managers := public.billing_json_int(p_settings, 'free_manager_seats', 'Free manager seats', true, NULL, 2147483647);
    v_email := nullif(public.billing_json_text(p_settings, 'support_email', 'The support email', 254, NULL), '');
    IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RAISE EXCEPTION 'The support email doesn''t look like an email address.'
            USING ERRCODE = 'P0001';
    END IF;

    PERFORM 1 FROM public.billing_settings WHERE id = 1 FOR UPDATE;
    UPDATE public.billing_settings
    SET free_tier_enabled = v_enabled, free_helper_seats = v_helpers,
        free_manager_seats = v_managers, support_email = v_email
    WHERE id = 1;
    PERFORM public.billing_audit(p_actor, 'billing.settings_saved', 'settings', '1',
        jsonb_build_object('free_tier_enabled', v_enabled));
END $$;

-- ---------------------------------------------------------------- Privileges

DO $$
DECLARE
    f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.billing_audit(UUID, TEXT, TEXT, TEXT, JSONB)',
        'public.billing_touch_updated_at()',
        'public.billing_json_int(JSONB, TEXT, TEXT, BOOLEAN, BIGINT, NUMERIC)',
        'public.billing_json_text(JSONB, TEXT, TEXT, INT, TEXT)',
        'public.billing_json_bool(JSONB, TEXT, TEXT, BOOLEAN)',
        'public.billing_list_plans(UUID)',
        'public.billing_get_settings(UUID)',
        'public.billing_save_plan(UUID, JSONB)',
        'public.billing_set_plan_status(UUID, UUID, TEXT)',
        'public.billing_save_settings(UUID, JSONB)',
        'public.billing_public_plans()',
        'public.billing_settings_public()'
    ] LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.billing_public_plans() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_settings_public() TO authenticated;

COMMIT;
