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
