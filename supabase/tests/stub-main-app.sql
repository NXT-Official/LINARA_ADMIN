-- The main-app tables Phase 2 reads, at the columns linara dev has (checked
-- 2026-10-15, spec §8.4). Only the columns the console reads, plus the pay
-- columns so a test can prove they never leave. Loaded after stub-supabase.sql.
ALTER TABLE auth.users
    ADD COLUMN banned_until TIMESTAMPTZ,
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.user_profiles
    ADD COLUMN household_id UUID,
    ADD COLUMN full_name TEXT,
    ADD COLUMN user_type TEXT,
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE public.households (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    timezone TEXT
);

CREATE TABLE public.household_managers (
    household_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role TEXT NOT NULL,
    added_by UUID,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.helper_profiles (
    id UUID PRIMARY KEY,
    user_id UUID,
    household_id UUID NOT NULL,
    name TEXT NOT NULL,
    station TEXT,
    monthly_rate NUMERIC,
    status TEXT NOT NULL,
    employment TEXT,
    phone TEXT,
    started_on DATE,
    ended_on DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.helper_households (
    helper_id UUID NOT NULL,
    household_id UUID NOT NULL,
    team_id UUID,
    added_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.helper_payout_accounts (
    user_id UUID PRIMARY KEY,
    method TEXT NOT NULL,
    account_name TEXT NOT NULL,
    account_number TEXT NOT NULL,
    qr_path TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.account_deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    user_type TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);

CREATE TABLE public.push_tokens (
    token TEXT PRIMARY KEY,
    user_id UUID NOT NULL,
    platform TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tasks. There is no created_at (D32).
CREATE TABLE public.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL,
    title TEXT,
    status TEXT NOT NULL,
    scheduled_start TIMESTAMPTZ,
    actual_start TIMESTAMPTZ,
    actual_end TIMESTAMPTZ,
    occurrence_date DATE,
    cancelled_at TIMESTAMPTZ,
    -- A repeating series: its first task's id. Copies made by LINARA's hourly
    -- spawn job carry the first task's id, not their own (add-repeating-tasks.sql).
    routine_id TEXT
);

-- LINARA's account deletion (add-household-managers.sql), cut down to what the
-- console relies on: its two refusals, the login going, and the request closing.
CREATE FUNCTION public.process_account_deletion(p_user_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_type TEXT;
BEGIN
    SELECT user_type INTO v_type FROM public.user_profiles WHERE id = p_user_id;
    IF EXISTS (SELECT 1 FROM public.helper_profiles WHERE user_id = p_user_id AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'Her employment is still active. Ask the household to end it (with final pay) first.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.household_managers m
        WHERE m.user_id = p_user_id
          AND NOT EXISTS (SELECT 1 FROM public.household_managers o
                          WHERE o.household_id = m.household_id AND o.user_id <> p_user_id)
          AND EXISTS (SELECT 1 FROM public.helper_profiles h
                      WHERE h.household_id = m.household_id AND h.status = 'ACTIVE')
    ) THEN
        RAISE EXCEPTION 'A household they''re the last manager of still employs someone. End each employment (with final pay) first.';
    END IF;
    DELETE FROM public.household_managers WHERE user_id = p_user_id;
    UPDATE public.helper_profiles SET user_id = NULL WHERE user_id = p_user_id;
    DELETE FROM auth.users WHERE id = p_user_id;
    UPDATE public.account_deletion_requests
        SET status = 'done', processed_at = now(), note = NULL
        WHERE user_id = p_user_id AND status = 'pending';
    RETURN jsonb_build_object('user_id', p_user_id, 'user_type', v_type,
                              'household_deleted', false);
END $$;
REVOKE ALL ON FUNCTION public.process_account_deletion(UUID) FROM PUBLIC, anon, authenticated;

-- Payouts and AI calls (Phase 6), at linara dev's columns (checked 2026-10-16).
CREATE TABLE public.payslips (
    id UUID PRIMARY KEY,
    helper_id UUID NOT NULL,
    cutoff_start DATE NOT NULL,
    cutoff_end DATE NOT NULL,
    net_pay NUMERIC(10,2) NOT NULL DEFAULT 0,
    payout_status TEXT NOT NULL DEFAULT 'pending_send'
);

CREATE TABLE public.payout_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payslip_id UUID NOT NULL REFERENCES public.payslips(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL,
    reference_id TEXT NOT NULL UNIQUE,
    psp_payout_id TEXT,
    status TEXT NOT NULL DEFAULT 'sending',
    failure_reason TEXT,
    amount_sent NUMERIC(10,2) NOT NULL,
    channel_code TEXT NOT NULL,
    requested_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    UNIQUE (payslip_id, attempt_number)
);

CREATE TABLE public.ai_calls (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    fn TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);
