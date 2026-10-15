-- LINARA_ADMIN, Phase 2: read functions for Dashboard, Users and Households.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md §5.1, §5.3, §5.4, D31, D32, D33.
--
-- Apply by hand in the Supabase SQL editor after 001-staff-foundation.sql:
-- linara dev first, then (later) staging and production. It runs in one
-- transaction and only creates functions: no table, index or policy changes,
-- and nothing here writes to a main-app table.
--
-- Rules (D33): each screen's data is one query, callable by the server key
-- only. No function returns a pay amount or payout account; those come one
-- helper at a time from the console's recorded reveal (S-17).
--
-- Active (D32): tasks have no creation time, so a household is active when a
-- task that isn't cancelled was scheduled in the window up to now, or a task
-- was marked done in the window.

BEGIN;

-- ---------------------------------------------------------------- Helpers

-- A search term as an ILIKE pattern with \, % and _ taken literally (S-20).
CREATE FUNCTION public.staff_like_pattern(p_term TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT '%' || replace(replace(replace(p_term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;

-- One household's task activity up to p_now (D32).
CREATE FUNCTION public.staff_household_activity(p_household_id UUID, p_now TIMESTAMPTZ)
RETURNS TABLE (tasks_scheduled_7d INT, tasks_done_7d INT, tasks_done_30d INT,
               last_activity_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT
        count(*) FILTER (WHERE t.status <> 'cancelled'
                           AND t.scheduled_start > p_now - INTERVAL '7 days'
                           AND t.scheduled_start <= p_now)::INT,
        count(*) FILTER (WHERE t.status = 'done'
                           AND t.actual_end > p_now - INTERVAL '7 days'
                           AND t.actual_end <= p_now)::INT,
        count(*) FILTER (WHERE t.status = 'done'
                           AND t.actual_end > p_now - INTERVAL '30 days'
                           AND t.actual_end <= p_now)::INT,
        greatest(
            max(t.actual_end) FILTER (WHERE t.status = 'done' AND t.actual_end <= p_now),
            max(t.scheduled_start) FILTER (WHERE t.status <> 'cancelled'
                                             AND t.scheduled_start <= p_now)
        )
    FROM public.tickets t
    WHERE t.household_id = p_household_id
$$;

-- ---------------------------------------------------------------- Dashboard

-- Every Phase 2 dashboard number and both charts, in one call (FR-DB-1 to FR-DB-3).
CREATE FUNCTION public.staff_dashboard(p_now TIMESTAMPTZ) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH
    today AS (SELECT (p_now AT TIME ZONE 'Asia/Manila')::DATE AS d),
    this_week AS (SELECT date_trunc('week', p_now AT TIME ZONE 'Asia/Manila')::DATE AS w),
    active AS (
        SELECT DISTINCT t.household_id
        FROM public.tickets t
        WHERE (t.status <> 'cancelled'
               AND t.scheduled_start > p_now - INTERVAL '7 days' AND t.scheduled_start <= p_now)
           OR (t.status = 'done'
               AND t.actual_end > p_now - INTERVAL '7 days' AND t.actual_end <= p_now)
    ),
    manager_homes AS (
        SELECT m.user_id, count(DISTINCT m.household_id) AS homes
        FROM public.household_managers m
        GROUP BY m.user_id
    ),
    weeks AS (
        SELECT (w.w - (n * 7))::DATE AS week_start
        FROM this_week w, generate_series(0, 7) AS n
    ),
    days AS (
        SELECT (td.d - n)::DATE AS day
        FROM today td, generate_series(0, 13) AS n
    )
    SELECT jsonb_build_object(
        'households', (SELECT count(*)::INT FROM public.households),
        'households_new_7d', (SELECT count(*)::INT FROM public.households h
                              WHERE h.created_at > p_now - INTERVAL '7 days'
                                AND h.created_at <= p_now),
        'households_new_30d', (SELECT count(*)::INT FROM public.households h
                               WHERE h.created_at > p_now - INTERVAL '30 days'
                                 AND h.created_at <= p_now),
        'households_active_7d', (SELECT count(*)::INT FROM active),
        'managers', (SELECT count(*)::INT FROM manager_homes),
        'managers_multi_home', (SELECT count(*)::INT FROM manager_homes WHERE homes > 1),
        'helpers_active', (SELECT count(*)::INT FROM public.helper_profiles WHERE status = 'ACTIVE'),
        'helpers_invited', (SELECT count(*)::INT FROM public.helper_profiles
                            WHERE status = 'PENDING_CLAIM'),
        'helpers_ended', (SELECT count(*)::INT FROM public.helper_profiles
                          WHERE status = 'INACTIVE'),
        'new_households_weekly', (
            SELECT jsonb_agg(jsonb_build_object(
                       'week_start', wk.week_start,
                       'count', (SELECT count(*)::INT FROM public.households h
                                 WHERE (h.created_at AT TIME ZONE 'Asia/Manila')::DATE
                                       >= wk.week_start
                                   AND (h.created_at AT TIME ZONE 'Asia/Manila')::DATE
                                       < wk.week_start + 7))
                   ORDER BY wk.week_start)
            FROM weeks wk
        ),
        'tasks_done_daily', (
            SELECT jsonb_agg(jsonb_build_object(
                       'day', dy.day,
                       'count', (SELECT count(*)::INT FROM public.tickets t
                                 WHERE t.status = 'done'
                                   AND t.actual_end > p_now - INTERVAL '15 days'
                                   AND (t.actual_end AT TIME ZONE 'Asia/Manila')::DATE = dy.day))
                   ORDER BY dy.day)
            FROM days dy
        )
    )
$$;

-- ---------------------------------------------------------------- Users

-- One page of accounts with a Linara profile (FR-US-1, FR-US-2). Search runs
-- on name and email, and on a helper's phone by its digits.
CREATE FUNCTION public.staff_list_users(p_search TEXT, p_kind TEXT, p_limit INT, p_offset INT)
RETURNS TABLE (user_id UUID, full_name TEXT, email TEXT, user_type TEXT,
               household_id UUID, household_name TEXT, household_count INT,
               joined_at TIMESTAMPTZ, last_sign_in_at TIMESTAMPTZ, suspended BOOLEAN,
               devices INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH
    term AS (
        SELECT public.staff_like_pattern(p_search) AS pattern,
               regexp_replace(coalesce(p_search, ''), '\D', '', 'g') AS digits
    ),
    page AS (
        SELECT p.id, p.full_name, u.email::TEXT AS email, p.user_type, p.household_id,
               u.created_at AS joined_at, u.last_sign_in_at,
               coalesce(u.banned_until > now(), false) AS suspended
        FROM public.user_profiles p
        JOIN auth.users u ON u.id = p.id
        CROSS JOIN term
        WHERE (p_kind IS NULL OR p.user_type = p_kind)
          AND (p_search IS NULL
               OR p.full_name ILIKE term.pattern
               OR u.email ILIKE term.pattern
               OR (length(term.digits) >= 3 AND EXISTS (
                       SELECT 1 FROM public.helper_profiles hp
                       WHERE hp.user_id = p.id
                         AND regexp_replace(coalesce(hp.phone, ''), '\D', '', 'g')
                             LIKE '%' || term.digits || '%')))
        ORDER BY u.created_at DESC, p.id
        LIMIT p_limit OFFSET p_offset
    )
    SELECT pg.id, pg.full_name, pg.email, pg.user_type, pg.household_id, h.name,
           (SELECT count(*)::INT FROM (
                SELECT m.household_id FROM public.household_managers m WHERE m.user_id = pg.id
                UNION
                SELECT hp.household_id FROM public.helper_profiles hp WHERE hp.user_id = pg.id
                UNION
                SELECT hh.household_id FROM public.helper_households hh
                JOIN public.helper_profiles hp ON hp.id = hh.helper_id
                WHERE hp.user_id = pg.id
            ) homes),
           pg.joined_at, pg.last_sign_in_at, pg.suspended,
           (SELECT count(*)::INT FROM public.push_tokens pt WHERE pt.user_id = pg.id)
    FROM page pg
    LEFT JOIN public.households h ON h.id = pg.household_id
    ORDER BY pg.joined_at DESC, pg.id
$$;

-- One account's detail page (FR-US-3), or null. Jobs include ended ones.
CREATE FUNCTION public.staff_get_user(p_user_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object(
        'user_id', p.id,
        'full_name', p.full_name,
        'email', u.email,
        'user_type', p.user_type,
        'joined_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'suspended', coalesce(u.banned_until > now(), false),
        'devices', (SELECT count(*)::INT FROM public.push_tokens pt WHERE pt.user_id = p.id),
        'memberships', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'household_id', m.household_id,
                       'household_name', h.name,
                       'role', m.role) ORDER BY m.added_at, m.household_id)
            FROM public.household_managers m
            JOIN public.households h ON h.id = m.household_id
            WHERE m.user_id = p.id
        ), '[]'::JSONB),
        'jobs', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'helper_id', hp.id,
                       'household_id', hp.household_id,
                       'household_name', h.name,
                       'station', hp.station,
                       'employment', hp.employment,
                       'status', hp.status,
                       'started_on', hp.started_on,
                       'ended_on', hp.ended_on,
                       'also_works_in', coalesce((
                           SELECT jsonb_agg(jsonb_build_object(
                                      'household_id', hh.household_id,
                                      'household_name', h2.name) ORDER BY h2.name)
                           FROM public.helper_households hh
                           JOIN public.households h2 ON h2.id = hh.household_id
                           WHERE hh.helper_id = hp.id
                       ), '[]'::JSONB)) ORDER BY hp.created_at, hp.id)
            FROM public.helper_profiles hp
            JOIN public.households h ON h.id = hp.household_id
            WHERE hp.user_id = p.id
        ), '[]'::JSONB),
        'deletion', (
            SELECT jsonb_build_object('id', d.id, 'requested_at', d.requested_at)
            FROM public.account_deletion_requests d
            WHERE d.user_id = p.id AND d.status = 'pending'
            ORDER BY d.requested_at DESC
            LIMIT 1
        )
    )
    FROM public.user_profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_user_id
$$;

-- ---------------------------------------------------------------- Households

-- One page of households (FR-HH-1). Activity is worked out for that page only.
CREATE FUNCTION public.staff_list_households(p_search TEXT, p_limit INT, p_offset INT,
                                             p_now TIMESTAMPTZ)
RETURNS TABLE (household_id UUID, name TEXT, created_at TIMESTAMPTZ,
               primary_manager_id UUID, primary_manager_name TEXT, managers INT,
               helpers_active INT, last_activity_at TIMESTAMPTZ,
               tasks_scheduled_7d INT, tasks_done_7d INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH page AS (
        SELECT h.id, h.name, h.created_at
        FROM public.households h
        WHERE p_search IS NULL OR h.name ILIKE public.staff_like_pattern(p_search)
        ORDER BY h.created_at DESC, h.id
        LIMIT p_limit OFFSET p_offset
    )
    SELECT pg.id, pg.name, pg.created_at, pm.user_id, pm.full_name,
           (SELECT count(*)::INT FROM public.household_managers m WHERE m.household_id = pg.id),
           (SELECT count(*)::INT FROM public.helper_profiles hp
            WHERE hp.status = 'ACTIVE'
              AND (hp.household_id = pg.id OR EXISTS (
                       SELECT 1 FROM public.helper_households hh
                       WHERE hh.helper_id = hp.id AND hh.household_id = pg.id))),
           act.last_activity_at, act.tasks_scheduled_7d, act.tasks_done_7d
    FROM page pg
    LEFT JOIN LATERAL (
        SELECT m.user_id, p.full_name
        FROM public.household_managers m
        LEFT JOIN public.user_profiles p ON p.id = m.user_id
        WHERE m.household_id = pg.id AND m.role = 'primary_manager'
        LIMIT 1
    ) pm ON true
    CROSS JOIN LATERAL public.staff_household_activity(pg.id, p_now) act
    ORDER BY pg.created_at DESC, pg.id
$$;

-- One household's detail page (FR-HH-2), or null. Helpers include shared ones.
CREATE FUNCTION public.staff_get_household(p_household_id UUID, p_now TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT jsonb_build_object(
        'household_id', h.id,
        'name', h.name,
        'created_at', h.created_at,
        'timezone', h.timezone,
        'managers', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'user_id', m.user_id,
                       'full_name', p.full_name,
                       'role', m.role) ORDER BY m.role DESC, p.full_name)
            FROM public.household_managers m
            LEFT JOIN public.user_profiles p ON p.id = m.user_id
            WHERE m.household_id = h.id
        ), '[]'::JSONB),
        'helpers', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'helper_id', hp.id,
                       'user_id', hp.user_id,
                       'name', hp.name,
                       'station', hp.station,
                       'employment', hp.employment,
                       'status', hp.status,
                       'started_on', hp.started_on,
                       'ended_on', hp.ended_on,
                       'shared', hp.household_id <> h.id) ORDER BY hp.status, hp.name)
            FROM public.helper_profiles hp
            WHERE hp.household_id = h.id
               OR EXISTS (SELECT 1 FROM public.helper_households hh
                          WHERE hh.helper_id = hp.id AND hh.household_id = h.id)
        ), '[]'::JSONB),
        'tasks_scheduled_7d', act.tasks_scheduled_7d,
        'tasks_done_7d', act.tasks_done_7d,
        'tasks_done_30d', act.tasks_done_30d,
        'last_activity_at', act.last_activity_at
    )
    FROM public.households h
    CROSS JOIN LATERAL public.staff_household_activity(h.id, p_now) act
    WHERE h.id = p_household_id
$$;

-- ---------------------------------------------------------------- Privileges

REVOKE EXECUTE ON FUNCTION
    public.staff_like_pattern(TEXT),
    public.staff_household_activity(UUID, TIMESTAMPTZ),
    public.staff_dashboard(TIMESTAMPTZ),
    public.staff_list_users(TEXT, TEXT, INT, INT),
    public.staff_get_user(UUID),
    public.staff_list_households(TEXT, INT, INT, TIMESTAMPTZ),
    public.staff_get_household(UUID, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
    public.staff_like_pattern(TEXT),
    public.staff_household_activity(UUID, TIMESTAMPTZ),
    public.staff_dashboard(TIMESTAMPTZ),
    public.staff_list_users(TEXT, TEXT, INT, INT),
    public.staff_get_user(UUID),
    public.staff_list_households(TEXT, INT, INT, TIMESTAMPTZ),
    public.staff_get_household(UUID, TIMESTAMPTZ)
TO service_role;

COMMIT;
