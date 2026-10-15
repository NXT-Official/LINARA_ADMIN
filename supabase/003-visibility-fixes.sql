-- LINARA_ADMIN, Phase 2 review fixes. Apply after 002-visibility.sql.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md D32 (amended 2026-10-15), NFR-7, D31.
--
-- 1. Activity (D32): LINARA's hourly job copies every repeating task into each
--    new day (add-repeating-tasks.sql, spawn_routine_tasks_everywhere). A copy
--    keeps its series' routine_id, which is the first task's id. Only tasks a
--    person scheduled count: no routine_id, or a routine_id equal to the
--    task's own id. Marked done still counts whoever made the task.
-- 2. Speed (NFR-7): the Households list and the dashboard read tickets once,
--    grouped, instead of once per household or per day.
--
-- Replaces three functions with the same signatures; grants are kept. Creates
-- no table, index or policy, and writes nothing.

BEGIN;

CREATE OR REPLACE FUNCTION public.staff_household_activity(p_household_id UUID, p_now TIMESTAMPTZ)
RETURNS TABLE (tasks_scheduled_7d INT, tasks_done_7d INT, tasks_done_30d INT,
               last_activity_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT
        count(*) FILTER (WHERE t.status <> 'cancelled'
                           AND (t.routine_id IS NULL OR t.routine_id = t.id::TEXT)
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
                                             AND (t.routine_id IS NULL OR t.routine_id = t.id::TEXT)
                                             AND t.scheduled_start <= p_now)
        )
    FROM public.tickets t
    WHERE t.household_id = p_household_id
$$;

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
    done_by_day AS (
        SELECT (t.actual_end AT TIME ZONE 'Asia/Manila')::DATE AS day, count(*)::INT AS n
        FROM public.tickets t
        WHERE t.status = 'done'
          AND t.actual_end > p_now - INTERVAL '15 days'
          AND t.actual_end <= p_now
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
                               AND (t.routine_id IS NULL OR t.routine_id = t.id::TEXT)
                               AND t.scheduled_start > p_now - INTERVAL '7 days'
                               AND t.scheduled_start <= p_now)::INT AS scheduled_7d,
            count(*) FILTER (WHERE t.status = 'done'
                               AND t.actual_end > p_now - INTERVAL '7 days'
                               AND t.actual_end <= p_now)::INT AS done_7d,
            greatest(
                max(t.actual_end) FILTER (WHERE t.status = 'done' AND t.actual_end <= p_now),
                max(t.scheduled_start) FILTER (WHERE t.status <> 'cancelled'
                                                 AND (t.routine_id IS NULL
                                                      OR t.routine_id = t.id::TEXT)
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

COMMIT;
