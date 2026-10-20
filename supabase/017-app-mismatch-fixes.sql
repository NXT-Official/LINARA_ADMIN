-- LINARA_ADMIN, app vs console data mismatches. Apply after 016-super-admin-gives-admin.sql.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md D32, D36, D38; handbook §20.1.
--
-- Where the console read a number differently from the app, the console moves
-- to the app's rule (the app is the reference; D5 forbids changing it). SQL
-- fixes are here; the wage reveal (#1) and the Payouts copy (#7) are in code.
--
--  #2 Payouts: a payment made outside Xendit (payout_provider 'manual') that the
--     helper marked "not received" (helper_ack 'disputed') is a payout problem,
--     kind 'disputed'. It has no attempt, so its row id is the payslip's id.
--  #3 Users role filter: matches the role in any household they manage, not
--     only user_profiles.user_type (the household open right now).
--  #4 Household task counts: "scheduled in 7 days" counts repeating-task copies,
--     as the app shows them. "Last activity" still prefers what a person did or
--     scheduled (D32) and only falls back to a copy, so a household that has
--     tasks never reads "No tasks yet". The dashboard's active-household rule
--     (FR-DB-3, D32) is unchanged.
--  #5 Users "and N more": ended jobs (helper status INACTIVE) no longer count.
--  #6 Dashboard daily done chart: a task counts on its scheduled day, as the app
--     does, not on the day it was finished.
--  #8 Deletion blockers: also look at the household in user_profiles.household_id
--     when the person is a manager, as process_account_deletion does.
--
-- Replaces functions with the same signatures; grants are kept. Creates no
-- table, index or policy, and writes nothing.

BEGIN;

-- ---------------------------------------------------------------- #2 Payouts

CREATE OR REPLACE FUNCTION public.staff_list_payout_problems(p_now TIMESTAMPTZ, p_kind TEXT,
                                                             p_limit INT, p_offset INT)
RETURNS TABLE (attempt_id UUID, payslip_id UUID, attempt_number INT, kind TEXT,
               failure_reason TEXT, reference_id TEXT, channel_code TEXT, helper_id UUID,
               helper_name TEXT, household_id UUID, household_name TEXT, cutoff_start DATE,
               cutoff_end DATE, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_kind IS NOT NULL
       AND p_kind NOT IN ('failed', 'cancelled', 'unclear', 'stuck', 'no_answer', 'disputed') THEN
        RAISE EXCEPTION 'Unknown payout problem kind.' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY
    WITH latest AS (
        SELECT DISTINCT ON (a.payslip_id) a.*
        FROM public.payout_attempts a
        ORDER BY a.payslip_id, a.attempt_number DESC
    ), problems AS (
        SELECT l.id AS row_id, l.payslip_id AS slip_id, l.attempt_number AS n,
               public.staff_payout_problem_kind(l.status, l.created_at, p_now) AS k,
               l.failure_reason AS reason, l.reference_id AS ref, l.channel_code AS channel,
               l.created_at AS at
        FROM latest l
        UNION ALL
        SELECT s.id, s.id, 0, 'disputed', s.helper_ack_note, '', s.payout_channel_code,
               coalesce(s.helper_ack_at, s.created_at)
        FROM public.payslips s
        WHERE s.payout_provider = 'manual' AND s.helper_ack = 'disputed'
    )
    SELECT p.row_id, p.slip_id, p.n, p.k, p.reason, p.ref, p.channel, ps.helper_id, hp.name,
           hp.household_id, h.name, ps.cutoff_start, ps.cutoff_end, p.at
    FROM problems p
    JOIN public.payslips ps ON ps.id = p.slip_id
    LEFT JOIN public.helper_profiles hp ON hp.id = ps.helper_id
    LEFT JOIN public.households h ON h.id = hp.household_id
    WHERE p.k IS NOT NULL AND (p_kind IS NULL OR p.k = p_kind)
    ORDER BY p.at DESC, p.row_id
    LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_payout_counts(p_now TIMESTAMPTZ) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH latest AS (
        SELECT DISTINCT ON (a.payslip_id)
               public.staff_payout_problem_kind(a.status, a.created_at, p_now) AS k
        FROM public.payout_attempts a
        ORDER BY a.payslip_id, a.attempt_number DESC
    )
    SELECT jsonb_build_object(
        'failed', count(*) FILTER (WHERE k = 'failed')::INT,
        'cancelled', count(*) FILTER (WHERE k = 'cancelled')::INT,
        'unclear', count(*) FILTER (WHERE k = 'unclear')::INT,
        'stuck', count(*) FILTER (WHERE k = 'stuck')::INT,
        'no_answer', count(*) FILTER (WHERE k = 'no_answer')::INT,
        'disputed', (SELECT count(*)::INT FROM public.payslips s
                     WHERE s.payout_provider = 'manual' AND s.helper_ack = 'disputed')
    )
    FROM latest
$$;

-- ------------------------------------------------- #3, #5 Users role and homes

CREATE OR REPLACE FUNCTION public.staff_list_users(p_search TEXT, p_kind TEXT, p_limit INT,
                                                   p_offset INT)
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
        WHERE (p_kind IS NULL
               OR p.user_type = p_kind
               OR EXISTS (SELECT 1 FROM public.household_managers m
                          WHERE m.user_id = p.id AND m.role = p_kind))
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
                SELECT hp.household_id FROM public.helper_profiles hp
                WHERE hp.user_id = pg.id AND hp.status <> 'INACTIVE'
                UNION
                SELECT hh.household_id FROM public.helper_households hh
                JOIN public.helper_profiles hp ON hp.id = hh.helper_id
                WHERE hp.user_id = pg.id AND hp.status <> 'INACTIVE'
            ) homes),
           pg.joined_at, pg.last_sign_in_at, pg.suspended,
           (SELECT count(*)::INT FROM public.push_tokens pt WHERE pt.user_id = pg.id)
    FROM page pg
    LEFT JOIN public.households h ON h.id = pg.household_id
    ORDER BY pg.joined_at DESC, pg.id
$$;

-- ---------------------------------------------------------- #4 Household tasks

CREATE OR REPLACE FUNCTION public.staff_household_activity(p_household_id UUID, p_now TIMESTAMPTZ)
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
        coalesce(
            greatest(
                max(t.actual_end) FILTER (WHERE t.status = 'done' AND t.actual_end <= p_now),
                max(t.scheduled_start) FILTER (WHERE t.status <> 'cancelled'
                                                 AND (t.routine_id IS NULL OR t.routine_id = t.id::TEXT)
                                                 AND t.scheduled_start <= p_now)
            ),
            max(t.scheduled_start) FILTER (WHERE t.status <> 'cancelled'
                                             AND t.scheduled_start <= p_now)
        )
    FROM public.tickets t
    WHERE t.household_id = p_household_id
$$;

CREATE OR REPLACE FUNCTION public.staff_list_households(p_search TEXT, p_limit INT, p_offset INT,
                                                        p_now TIMESTAMPTZ)
RETURNS TABLE (household_id UUID, name TEXT, created_at TIMESTAMPTZ,
               primary_manager_id UUID, primary_manager_name TEXT, managers INT,
               helpers_active INT, last_activity_at TIMESTAMPTZ,
               tasks_scheduled_7d INT, tasks_done_7d INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH
    page AS (
        SELECT h.id, h.name, h.created_at
        FROM public.households h
        WHERE p_search IS NULL OR h.name ILIKE public.staff_like_pattern(p_search)
        ORDER BY h.created_at DESC, h.id
        LIMIT p_limit OFFSET p_offset
    ),
    -- One pass over the page's tasks, the same rules as staff_household_activity.
    act AS (
        SELECT t.household_id,
            count(*) FILTER (WHERE t.status <> 'cancelled'
                               AND t.scheduled_start > p_now - INTERVAL '7 days'
                               AND t.scheduled_start <= p_now)::INT AS scheduled_7d,
            count(*) FILTER (WHERE t.status = 'done'
                               AND t.actual_end > p_now - INTERVAL '7 days'
                               AND t.actual_end <= p_now)::INT AS done_7d,
            coalesce(
                greatest(
                    max(t.actual_end) FILTER (WHERE t.status = 'done' AND t.actual_end <= p_now),
                    max(t.scheduled_start) FILTER (WHERE t.status <> 'cancelled'
                                                     AND (t.routine_id IS NULL
                                                          OR t.routine_id = t.id::TEXT)
                                                     AND t.scheduled_start <= p_now)
                ),
                max(t.scheduled_start) FILTER (WHERE t.status <> 'cancelled'
                                                 AND t.scheduled_start <= p_now)
            ) AS last_at
        FROM public.tickets t
        WHERE t.household_id IN (SELECT id FROM page)
        GROUP BY t.household_id
    )
    SELECT pg.id, pg.name, pg.created_at, pm.user_id, pm.full_name,
           (SELECT count(*)::INT FROM public.household_managers m WHERE m.household_id = pg.id),
           (SELECT count(*)::INT FROM public.helper_profiles hp
            WHERE hp.status = 'ACTIVE'
              AND (hp.household_id = pg.id OR EXISTS (
                       SELECT 1 FROM public.helper_households hh
                       WHERE hh.helper_id = hp.id AND hh.household_id = pg.id))),
           act.last_at, coalesce(act.scheduled_7d, 0), coalesce(act.done_7d, 0)
    FROM page pg
    LEFT JOIN LATERAL (
        SELECT m.user_id, p.full_name
        FROM public.household_managers m
        LEFT JOIN public.user_profiles p ON p.id = m.user_id
        WHERE m.household_id = pg.id AND m.role = 'primary_manager'
        LIMIT 1
    ) pm ON true
    LEFT JOIN act ON act.household_id = pg.id
    ORDER BY pg.created_at DESC, pg.id
$$;

-- ----------------------------------------------------------- #6 Dashboard chart

CREATE OR REPLACE FUNCTION public.staff_dashboard(p_now TIMESTAMPTZ) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH
    today AS (SELECT (p_now AT TIME ZONE 'Asia/Manila')::DATE AS d),
    this_week AS (SELECT date_trunc('week', p_now AT TIME ZONE 'Asia/Manila')::DATE AS w),
    active AS (
        SELECT DISTINCT t.household_id
        FROM public.tickets t
        WHERE (t.status <> 'cancelled'
               AND (t.routine_id IS NULL OR t.routine_id = t.id::TEXT)
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
    new_by_week AS (
        SELECT date_trunc('week', h.created_at AT TIME ZONE 'Asia/Manila')::DATE AS week_start,
               count(*)::INT AS n
        FROM public.households h, this_week w
        WHERE h.created_at AT TIME ZONE 'Asia/Manila' >= w.w - 49
        GROUP BY 1
    ),
    days AS (
        SELECT (td.d - n)::DATE AS day
        FROM today td, generate_series(0, 13) AS n
    ),
    -- A done task counts on the day it was scheduled for, as the app shows it.
    done_by_day AS (
        SELECT (t.scheduled_start AT TIME ZONE 'Asia/Manila')::DATE AS day, count(*)::INT AS n
        FROM public.tickets t
        WHERE t.status = 'done'
          AND t.scheduled_start > p_now - INTERVAL '15 days'
          AND t.scheduled_start <= p_now + INTERVAL '2 days'
        GROUP BY 1
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
            SELECT jsonb_agg(jsonb_build_object('week_start', wk.week_start,
                                                'count', coalesce(nw.n, 0))
                             ORDER BY wk.week_start)
            FROM weeks wk LEFT JOIN new_by_week nw ON nw.week_start = wk.week_start
        ),
        'tasks_done_daily', (
            SELECT jsonb_agg(jsonb_build_object('day', dy.day, 'count', coalesce(dd.n, 0))
                             ORDER BY dy.day)
            FROM days dy LEFT JOIN done_by_day dd ON dd.day = dy.day
        )
    )
$$;

-- ------------------------------------------------------- #8 Deletion blockers

CREATE OR REPLACE FUNCTION public.staff_deletion_blockers(p_user_id UUID) RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH homes AS (
        -- Memberships, plus the open household in case it predates them.
        SELECT m.household_id FROM public.household_managers m WHERE m.user_id = p_user_id
        UNION
        SELECT up.household_id FROM public.user_profiles up
        WHERE up.id = p_user_id AND up.household_id IS NOT NULL
          AND up.user_type IN ('primary_manager', 'co_manager', 'remote_admin')
    )
    SELECT array_remove(ARRAY[
        CASE WHEN EXISTS (
            SELECT 1 FROM public.staff_roles s WHERE s.user_id = p_user_id
        ) THEN 'console_admin' END,
        CASE WHEN EXISTS (
            SELECT 1 FROM public.helper_profiles h
            WHERE h.user_id = p_user_id AND h.status = 'ACTIVE'
        ) THEN 'active_employment' END,
        CASE WHEN EXISTS (
            SELECT 1 FROM homes x
            WHERE NOT EXISTS (SELECT 1 FROM public.household_managers o
                              WHERE o.household_id = x.household_id
                                AND o.user_id <> p_user_id)
              AND EXISTS (SELECT 1 FROM public.helper_profiles h
                          WHERE h.household_id = x.household_id AND h.status = 'ACTIVE')
        ) THEN 'last_manager_with_helpers' END
    ], NULL)
$$;

COMMIT;
