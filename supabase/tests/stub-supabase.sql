-- The parts of a Supabase project the console's SQL touches, for PGlite.
-- Modelled on LINARA/supabase/tests/base-schema.sql.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
    id UUID PRIMARY KEY,
    email TEXT,
    last_sign_in_at TIMESTAMPTZ
);
CREATE TABLE auth.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE TABLE auth.mfa_factors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    factor_type TEXT NOT NULL,
    status TEXT NOT NULL
);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

-- A household account in the main app (LINARA web owns this table).
CREATE TABLE public.user_profiles (id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
