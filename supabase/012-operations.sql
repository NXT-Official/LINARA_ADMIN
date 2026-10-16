-- LINARA_ADMIN, Phase 6: payouts and AI usage. Apply after 011-support-fixes.sql.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md §5.7, §5.8, §8.2, FR-DB-6, S-17, D33, D38.
--
-- Apply by hand in the Supabase SQL editor: linara dev first. One transaction.
-- Three read functions, server key only. They read payout_attempts, payslips,
-- helper_profiles, households, user_profiles and ai_calls and write nothing
-- (FR-PO-2). None returns a payout amount: that is revealed one attempt at a
-- time, recorded first (S-17).

BEGIN;

-- ---------------------------------------------------------------- Payouts (D38)

-- The latest attempt of each payslip, with its problem kind, or NULL when it
-- isn't a problem: a later attempt that went through hides an earlier failure.
CREATE FUNCTION public.staff_payout_problem_kind(p_status TEXT, p_created_at TIMESTAMPTZ,
                                                 p_now TIMESTAMPTZ) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE
        WHEN p_status = 'failed' THEN 'failed'
        WHEN p_status = 'cancelled' THEN 'cancelled'
        WHEN p_status = 'ambiguous' THEN 'unclear'
        WHEN p_status = 'sending' AND p_created_at < p_now - INTERVAL '1 hour' THEN 'stuck'
        WHEN p_status = 'accepted' AND p_created_at < p_now - INTERVAL '24 hours' THEN 'no_answer'
    END
$$;

CREATE FUNCTION public.staff_list_payout_problems(p_now TIMESTAMPTZ, p_kind TEXT, p_limit INT,
                                                  p_offset INT)
RETURNS TABLE (attempt_id UUID, payslip_id UUID, attempt_number INT, kind TEXT,
               failure_reason TEXT, reference_id TEXT, channel_code TEXT, helper_id UUID,
               helper_name TEXT, household_id UUID, household_name TEXT, cutoff_start DATE,
               cutoff_end DATE, created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_kind IS NOT NULL
       AND p_kind NOT IN ('failed', 'cancelled', 'unclear', 'stuck', 'no_answer') THEN
        RAISE EXCEPTION 'Unknown payout problem kind.' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY
    WITH latest AS (
        SELECT DISTINCT ON (a.payslip_id) a.*
        FROM public.payout_attempts a
        ORDER BY a.payslip_id, a.attempt_number DESC
    ), problems AS (
        SELECT l.*, public.staff_payout_problem_kind(l.status, l.created_at, p_now) AS k
        FROM latest l
    )
    SELECT p.id, p.payslip_id, p.attempt_number, p.k, p.failure_reason, p.reference_id,
           p.channel_code, ps.helper_id, hp.name, hp.household_id, h.name, ps.cutoff_start,
           ps.cutoff_end, p.created_at
    FROM problems p
    JOIN public.payslips ps ON ps.id = p.payslip_id
    LEFT JOIN public.helper_profiles hp ON hp.id = ps.helper_id
    LEFT JOIN public.households h ON h.id = hp.household_id
    WHERE p.k IS NOT NULL AND (p_kind IS NULL OR p.k = p_kind)
    ORDER BY p.created_at DESC, p.id
    LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE FUNCTION public.staff_payout_counts(p_now TIMESTAMPTZ) RETURNS JSONB
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
        'no_answer', count(*) FILTER (WHERE k = 'no_answer')::INT
    )
    FROM latest
$$;

-- ---------------------------------------------------------------- AI usage (D38)

-- The 48 hours before p_now. take_ai_call refuses the call that would go
-- over a limit and doesn't store it, so a hit is 60 stored calls to one
-- function within an hour, or 300 within a day; the first of each is shown.
CREATE FUNCTION public.staff_ai_usage(p_now TIMESTAMPTZ) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH calls AS (
        SELECT c.user_id, c.fn, c.at
        FROM public.ai_calls c
        WHERE c.at > p_now - INTERVAL '48 hours' AND c.at <= p_now
    ), windowed AS (
        SELECT c.*,
               count(*) OVER (PARTITION BY c.user_id, c.fn ORDER BY c.at
                              RANGE BETWEEN INTERVAL '1 hour' PRECEDING AND CURRENT ROW) AS in_hour,
               count(*) OVER (PARTITION BY c.user_id ORDER BY c.at
                              RANGE BETWEEN INTERVAL '1 day' PRECEDING AND CURRENT ROW) AS in_day
        FROM calls c
    ), hits AS (
        SELECT user_id, 'hourly' AS kind, fn, min(at) AS at
        FROM windowed WHERE in_hour >= 60 GROUP BY user_id, fn
        UNION ALL
        SELECT user_id, 'daily', NULL, min(at)
        FROM windowed WHERE in_day >= 300 GROUP BY user_id
    ), hourly AS (
        SELECT fn, date_trunc('hour', at) AS hour, count(*)::INT AS calls
        FROM calls GROUP BY fn, date_trunc('hour', at)
    ), top_users AS (
        SELECT user_id, count(*)::INT AS calls
        FROM calls WHERE at > p_now - INTERVAL '24 hours'
        GROUP BY user_id
        ORDER BY count(*) DESC, user_id
        LIMIT 10
    )
    SELECT jsonb_build_object(
        'hourly', COALESCE((SELECT jsonb_agg(jsonb_build_object('fn', fn, 'hour', hour,
                                                                'calls', calls)
                                             ORDER BY hour, fn) FROM hourly), '[]'::JSONB),
        'top_users', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', t.user_id,
                                                                   'name', up.full_name,
                                                                   'calls', t.calls)
                                                ORDER BY t.calls DESC, t.user_id)
                               FROM top_users t
                               LEFT JOIN public.user_profiles up ON up.id = t.user_id),
                              '[]'::JSONB),
        'limit_hits', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', x.user_id,
                                                                    'name', up.full_name,
                                                                    'kind', x.kind, 'fn', x.fn,
                                                                    'at', x.at)
                                                 ORDER BY x.at DESC)
                                FROM hits x
                                LEFT JOIN public.user_profiles up ON up.id = x.user_id),
                               '[]'::JSONB),
        'calls_24h', (SELECT count(*)::INT FROM calls WHERE at > p_now - INTERVAL '24 hours')
    )
$$;

-- ---------------------------------------------------------------- Grants

DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.staff_payout_problem_kind(TEXT, TIMESTAMPTZ, TIMESTAMPTZ)',
        'public.staff_list_payout_problems(TIMESTAMPTZ, TEXT, INT, INT)',
        'public.staff_payout_counts(TIMESTAMPTZ)',
        'public.staff_ai_usage(TIMESTAMPTZ)'
    ] LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END $$;

COMMIT;
