-- LINARA_ADMIN, Phase 1: the console's own tables and functions.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md §8, D27, D28, D30, D31.
--
-- Apply by hand in the Supabase SQL editor: linara dev first, then (later)
-- staging and production. Safe to read top to bottom; it runs in one
-- transaction, so it applies completely or not at all.
--
-- Rules (§8.1, S-27): every table has row-level security on and no policies,
-- and no privileges for anon or authenticated. Only the console's server
-- (service_role) reaches them. Nothing here changes a main-app table.

BEGIN;

-- ---------------------------------------------------------------- Tables

-- Who can use the console, and as what. v1 allows only 'admin' (D15).
CREATE TABLE public.staff_roles (
    user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('admin')),
    granted_by UUID,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only record of every console action. Ids only, never names, emails,
-- phone numbers or amounts (S-22).
CREATE TABLE public.staff_audit_log (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id UUID NOT NULL,
    action        TEXT NOT NULL,
    target_type   TEXT,
    target_id     TEXT,
    reason        TEXT,
    metadata      JSONB NOT NULL DEFAULT '{}',
    at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX staff_audit_log_at ON public.staff_audit_log (at DESC);
CREATE INDEX staff_audit_log_actor_at ON public.staff_audit_log (actor_user_id, at DESC);
CREATE INDEX staff_audit_log_target_at ON public.staff_audit_log (target_type, at DESC);

-- Rate-limit counters shared by every server instance (D30). Keys are hashed.
CREATE TABLE public.staff_sign_in_attempts (
    key TEXT NOT NULL,
    at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX staff_sign_in_attempts_key_at ON public.staff_sign_in_attempts (key, at);
CREATE INDEX staff_sign_in_attempts_at ON public.staff_sign_in_attempts (at);

-- One row per signed-in console session (D27).
CREATE TABLE public.staff_sessions (
    session_id   UUID PRIMARY KEY,
    user_id      UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX staff_sessions_user ON public.staff_sessions (user_id);
CREATE INDEX staff_sessions_created ON public.staff_sessions (created_at);

-- ---------------------------------------------------------------- Lock-down

ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_sign_in_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_sessions ENABLE ROW LEVEL SECURITY;

-- Supabase grants new public tables to anon and authenticated by default.
REVOKE ALL ON public.staff_roles, public.staff_audit_log,
              public.staff_sign_in_attempts, public.staff_sessions
    FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_roles, public.staff_sign_in_attempts,
                                        public.staff_sessions TO service_role;
GRANT SELECT, INSERT ON public.staff_audit_log TO service_role;

-- The audit log can't be edited or emptied, by anyone (S-28).
CREATE FUNCTION public.staff_audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'staff_audit_log is append-only';
END $$;
CREATE TRIGGER staff_audit_log_no_change
    BEFORE UPDATE OR DELETE ON public.staff_audit_log
    FOR EACH ROW EXECUTE FUNCTION public.staff_audit_log_append_only();
CREATE TRIGGER staff_audit_log_no_truncate
    BEFORE TRUNCATE ON public.staff_audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION public.staff_audit_log_append_only();

-- ---------------------------------------------------------------- Functions
-- All SECURITY DEFINER with an empty search_path and fully qualified names,
-- and runnable by the server key only (granted at the end).

-- Ends every session a user has (FR-TM-3, D28). Supabase's admin sign-out
-- needs the user's own token, so a removed admin's sessions go this way.
CREATE FUNCTION public.staff_end_sessions(p_user_id UUID) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    n INT;
BEGIN
    DELETE FROM public.staff_sessions WHERE user_id = p_user_id;
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

-- Finds an account by email, and whether it has a household profile (§4.1, D28).
CREATE FUNCTION public.staff_lookup_user(p_email TEXT)
RETURNS TABLE (user_id UUID, has_household_profile BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT u.id,
           EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = u.id)
    FROM auth.users u
    WHERE lower(u.email) = lower(trim(p_email))
$$;

-- Records one attempt per key and returns each key's count in the window (D30).
-- Prunes day-old rows on about one call in fifty, so pruning stays cheap.
CREATE FUNCTION public.staff_record_attempt(p_keys TEXT[], p_window INTERVAL)
RETURNS TABLE (key TEXT, attempts INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
    IF random() < 0.02 THEN
        DELETE FROM public.staff_sign_in_attempts WHERE at < now() - INTERVAL '1 day';
    END IF;
    INSERT INTO public.staff_sign_in_attempts (key) SELECT unnest(p_keys);
    RETURN QUERY
        SELECT a.key, count(*)::INT
        FROM public.staff_sign_in_attempts a
        WHERE a.key = ANY (p_keys) AND a.at > now() - p_window
        GROUP BY a.key;
END $$;

-- The one database call per console request (D31): the admin's role and the
-- session's timing, or no row when either is gone. Returns last_seen_at as it
-- was before this call, and writes it at most once a minute.
CREATE FUNCTION public.staff_touch_session(p_session_id UUID, p_user_id UUID)
RETURNS TABLE (role TEXT, started_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE
    v_role    TEXT;
    v_started TIMESTAMPTZ;
    v_seen    TIMESTAMPTZ;
BEGIN
    SELECT r.role, s.created_at, s.last_seen_at
      INTO v_role, v_started, v_seen
      FROM public.staff_sessions s
      JOIN public.staff_roles r ON r.user_id = s.user_id
     WHERE s.session_id = p_session_id AND s.user_id = p_user_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    IF v_seen < now() - INTERVAL '60 seconds' THEN
        UPDATE public.staff_sessions SET last_seen_at = now()
         WHERE session_id = p_session_id;
    END IF;
    RETURN QUERY SELECT v_role, v_started, v_seen;
END $$;

-- Starts a console session after the two-step code (D27), and clears sessions
-- past the 12-hour cap (D29) in the same call.
CREATE FUNCTION public.staff_start_session(p_session_id UUID, p_user_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    DELETE FROM public.staff_sessions WHERE created_at < now() - INTERVAL '12 hours';
    INSERT INTO public.staff_sessions (session_id, user_id)
    VALUES (p_session_id, p_user_id)
    ON CONFLICT (session_id) DO NOTHING;
END $$;

-- Every admin with what the Admins screen shows, in one query (D31).
CREATE FUNCTION public.staff_list_admins()
RETURNS TABLE (user_id UUID, email TEXT, granted_at TIMESTAMPTZ,
               last_sign_in_at TIMESTAMPTZ, two_step_set_up BOOLEAN)
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
           )
    FROM public.staff_roles r
    JOIN auth.users u ON u.id = r.user_id
    ORDER BY r.granted_at
$$;

REVOKE EXECUTE ON FUNCTION
    public.staff_end_sessions(UUID),
    public.staff_lookup_user(TEXT),
    public.staff_record_attempt(TEXT[], INTERVAL),
    public.staff_touch_session(UUID, UUID),
    public.staff_start_session(UUID, UUID),
    public.staff_list_admins()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.staff_end_sessions(UUID),
    public.staff_lookup_user(TEXT),
    public.staff_record_attempt(TEXT[], INTERVAL),
    public.staff_touch_session(UUID, UUID),
    public.staff_start_session(UUID, UUID),
    public.staff_list_admins()
TO service_role;

COMMIT;
