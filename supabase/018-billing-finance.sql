-- Phase 8 — finance. Apply after 017. Shared with LINARA: its edge functions call billing_record_ai_usage.
-- Ported from LINARA 594daf6 supabase/add-costs-and-ai-usage.sql (arithmetic and
-- definitions unchanged; the platform-admin RLS is replaced by staff functions).
--
-- Apply by hand in the Supabase SQL editor: linara dev first. One transaction.
-- Safe to run twice.
--
-- billing_cost_entries is the monthly ledger of what running Linara costs.
-- billing_model_prices is the per-model AI price list kept current by staff.
-- billing_ai_usage is one row per priced AI call, written only by LINARA's AI
-- edge functions (service_role) through billing_record_ai_usage. billing_finance
-- adds paid invoices, cost entries and AI spend into revenue, cost of goods and
-- profit per user for a date range. Money is integer centavos (PHP,
-- tax-inclusive).
--
-- Access: the three tables have RLS on, no policies, and nothing for anon or
-- authenticated. Everything goes through functions:
--   billing_price_ai_call, billing_record_ai_usage ... service_role only,
--     called by LINARA's edge functions (documented exception: not staff).
--   Staff (service_role only, p_actor first, plain-sentence P0001 refusals):
--     billing_finance, billing_list_costs, billing_save_cost,
--     billing_delete_cost, billing_list_model_prices, billing_save_model_price.
--     Writes audit in the same transaction: metadata carries ids, the cost's
--     month and category, or the model name, never amounts (S-22).
--
-- Definitions: days are Manila days, p_from..p_to inclusive. Revenue is paid
-- invoices by paid_at; cost entries count when their month's first day is in
-- range; AI spend is by call time. Paying households are those covered by a
-- subscription (active, past_due or canceled) with a price above zero whose
-- period overlaps the range (a ₱0 comp is not paying); users are the distinct
-- managers of those households. Ratios are NULL when their divisor is zero.

BEGIN;

-- ---------------------------------------------------------------- Tables

CREATE TABLE IF NOT EXISTS public.billing_cost_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    month           DATE NOT NULL CHECK (month = date_trunc('month', month)::DATE),
    category        TEXT NOT NULL CHECK (category IN ('infra', 'ai', 'payments', 'support', 'other')),
    label           TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
    amount_centavos BIGINT NOT NULL CHECK (amount_centavos >= 0),
    note            TEXT NULL,
    created_by      UUID NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_cost_entries_month_idx
    ON public.billing_cost_entries (month);

CREATE TABLE IF NOT EXISTS public.billing_model_prices (
    model                     TEXT PRIMARY KEY,
    input_centavos_per_1m     BIGINT NOT NULL DEFAULT 0 CHECK (input_centavos_per_1m >= 0),
    output_centavos_per_1m    BIGINT NOT NULL DEFAULT 0 CHECK (output_centavos_per_1m >= 0),
    audio_centavos_per_minute BIGINT NOT NULL DEFAULT 0 CHECK (audio_centavos_per_minute >= 0),
    note                      TEXT NULL,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.billing_model_prices
    (model, input_centavos_per_1m, output_centavos_per_1m, audio_centavos_per_minute, note)
VALUES
    ('gpt-4o', 14000, 56000, 0, 'USD list ×56 ₱/$ — set yours'),
    ('gpt-4o-mini', 840, 3360, 0, 'USD list ×56 ₱/$ — set yours'),
    ('whisper-1', 0, 0, 34, 'USD list ×56 ₱/$ — set yours')
ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS billing_model_prices_touch ON public.billing_model_prices;
CREATE TRIGGER billing_model_prices_touch BEFORE UPDATE ON public.billing_model_prices
    FOR EACH ROW EXECUTE FUNCTION public.billing_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.billing_ai_usage (
    id            BIGSERIAL PRIMARY KEY,
    at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id       UUID NULL,
    household_id  UUID NULL,
    fn            TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens INT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    audio_seconds NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (audio_seconds >= 0),
    cost_centavos BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS billing_ai_usage_at_idx ON public.billing_ai_usage (at);
CREATE INDEX IF NOT EXISTS billing_ai_usage_household_idx ON public.billing_ai_usage (household_id);

ALTER TABLE public.billing_cost_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_model_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_cost_entries, public.billing_model_prices, public.billing_ai_usage
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.billing_ai_usage_id_seq FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- AI calls

-- The cost in centavos of one call at the price list; an unknown model is free.
CREATE OR REPLACE FUNCTION public.billing_price_ai_call(
    p_model TEXT, p_input INT, p_output INT, p_audio_seconds NUMERIC
) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT COALESCE(
        (SELECT round(
                    COALESCE(p_input, 0)::NUMERIC * mp.input_centavos_per_1m / 1000000
                  + COALESCE(p_output, 0)::NUMERIC * mp.output_centavos_per_1m / 1000000
                  + COALESCE(p_audio_seconds, 0) / 60 * mp.audio_centavos_per_minute
                )::BIGINT
           FROM public.billing_model_prices mp
          WHERE mp.model = p_model),
        0)
$$;

-- Called by LINARA's AI edge functions with the service role after each model
-- call. Returns the cost it stored. A NULL household is taken from the user's
-- profile.
CREATE OR REPLACE FUNCTION public.billing_record_ai_usage(
    p_user_id UUID, p_household_id UUID, p_fn TEXT, p_model TEXT,
    p_input_tokens INT, p_output_tokens INT, p_audio_seconds NUMERIC
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_household UUID := p_household_id;
    v_cost BIGINT;
BEGIN
    IF v_household IS NULL AND p_user_id IS NOT NULL THEN
        SELECT up.household_id INTO v_household
          FROM public.user_profiles up
         WHERE up.id = p_user_id;
    END IF;

    v_cost := public.billing_price_ai_call(
        p_model, COALESCE(p_input_tokens, 0), COALESCE(p_output_tokens, 0),
        COALESCE(p_audio_seconds, 0));

    INSERT INTO public.billing_ai_usage
        (user_id, household_id, fn, model, input_tokens, output_tokens, audio_seconds, cost_centavos)
    VALUES
        (p_user_id, v_household, p_fn, p_model, COALESCE(p_input_tokens, 0),
         COALESCE(p_output_tokens, 0), COALESCE(p_audio_seconds, 0), v_cost);

    RETURN v_cost;
END $$;

-- ---------------------------------------------------------------- Finance

CREATE OR REPLACE FUNCTION public.billing_finance(
    p_actor UUID, p_from DATE, p_to DATE, p_now TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_revenue BIGINT;
    v_costs BIGINT;
    v_ai_cost BIGINT;
    v_ai_calls BIGINT;
    v_cogs BIGINT;
    v_profit BIGINT;
    v_homes BIGINT;
    v_users BIGINT;
    v_series JSONB;
    v_by_fn JSONB;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
        RAISE EXCEPTION 'Choose a start date on or before the end date.' USING ERRCODE = 'P0001';
    END IF;
    v_start := (p_from::TIMESTAMP AT TIME ZONE 'Asia/Manila');
    v_end := ((p_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Manila');

    SELECT COALESCE(sum(bi.paid_centavos), 0) INTO v_revenue
      FROM public.billing_invoices bi
     WHERE bi.status = 'paid' AND bi.paid_at >= v_start AND bi.paid_at < v_end;

    SELECT COALESCE(sum(ce.amount_centavos), 0) INTO v_costs
      FROM public.billing_cost_entries ce
     WHERE ce.month >= p_from AND ce.month <= p_to;

    SELECT COALESCE(sum(au.cost_centavos), 0), count(*) INTO v_ai_cost, v_ai_calls
      FROM public.billing_ai_usage au
     WHERE au.at >= v_start AND au.at < v_end;

    v_cogs := v_costs + v_ai_cost;
    v_profit := v_revenue - v_cogs;

    WITH homes AS (
        SELECT DISTINCT sh.household_id
          FROM public.billing_subscription_homes sh
          JOIN public.billing_subscriptions s ON s.id = sh.subscription_id
         WHERE s.status IN ('active', 'past_due', 'canceled')
           AND s.amount_centavos > 0
           AND s.current_period_start < v_end
           AND COALESCE(s.current_period_end, 'infinity'::TIMESTAMPTZ) >= v_start
    )
    SELECT (SELECT count(*) FROM homes),
           (SELECT count(DISTINCT hm.user_id)
              FROM public.household_managers hm
              JOIN homes h ON h.household_id = hm.household_id)
      INTO v_homes, v_users;

    WITH rev AS (
        SELECT date_trunc('month', bi.paid_at AT TIME ZONE 'Asia/Manila')::DATE AS m,
               sum(bi.paid_centavos) AS revenue
          FROM public.billing_invoices bi
         WHERE bi.status = 'paid' AND bi.paid_at >= v_start AND bi.paid_at < v_end
         GROUP BY 1
    ), cst AS (
        SELECT ce.month AS m, sum(ce.amount_centavos) AS cost
          FROM public.billing_cost_entries ce
         WHERE ce.month >= p_from AND ce.month <= p_to
         GROUP BY 1
    ), ai AS (
        SELECT date_trunc('month', au.at AT TIME ZONE 'Asia/Manila')::DATE AS m,
               sum(au.cost_centavos) AS cost, count(*) AS calls
          FROM public.billing_ai_usage au
         WHERE au.at >= v_start AND au.at < v_end
         GROUP BY 1
    ), months AS (
        SELECT m FROM rev UNION SELECT m FROM cst UNION SELECT m FROM ai
    ), rows AS (
        SELECT mo.m,
               COALESCE(rev.revenue, 0) AS revenue,
               COALESCE(cst.cost, 0) + COALESCE(ai.cost, 0) AS cogs,
               COALESCE(ai.calls, 0) AS calls
          FROM months mo
          LEFT JOIN rev ON rev.m = mo.m
          LEFT JOIN cst ON cst.m = mo.m
          LEFT JOIN ai ON ai.m = mo.m
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'month', to_char(r.m, 'YYYY-MM'),
               'revenue_centavos', r.revenue,
               'cogs_centavos', r.cogs,
               'profit_centavos', r.revenue - r.cogs,
               'ai_calls', r.calls) ORDER BY r.m), '[]'::JSONB)
      INTO v_series
      FROM rows r;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'fn', t.fn,
               'calls', t.calls,
               'cost_centavos', t.cost,
               'input_tokens', t.input_tokens,
               'output_tokens', t.output_tokens) ORDER BY t.cost DESC, t.fn), '[]'::JSONB)
      INTO v_by_fn
      FROM (
          SELECT au.fn, count(*) AS calls, sum(au.cost_centavos) AS cost,
                 sum(au.input_tokens) AS input_tokens, sum(au.output_tokens) AS output_tokens
            FROM public.billing_ai_usage au
           WHERE au.at >= v_start AND au.at < v_end
           GROUP BY au.fn
      ) t;

    RETURN jsonb_build_object(
        'revenue_centavos', v_revenue,
        'cogs_centavos', v_cogs,
        'cost_entries_centavos', v_costs,
        'ai_cost_centavos', v_ai_cost,
        'ai_calls', v_ai_calls,
        'cost_per_call_centavos',
            CASE WHEN v_ai_calls = 0 THEN NULL ELSE round(v_ai_cost::NUMERIC / v_ai_calls) END,
        'profit_centavos', v_profit,
        'paying_households', v_homes,
        'users', v_users,
        'profit_per_user_centavos',
            CASE WHEN v_users = 0 THEN NULL ELSE round(v_profit::NUMERIC / v_users) END,
        'series', v_series,
        'ai_by_fn', v_by_fn);
END $$;

-- ---------------------------------------------------------------- Costs

CREATE OR REPLACE FUNCTION public.billing_list_costs(p_actor UUID, p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
        RAISE EXCEPTION 'Choose a start date on or before the end date.' USING ERRCODE = 'P0001';
    END IF;
    RETURN (SELECT coalesce(jsonb_agg(to_jsonb(ce) ORDER BY ce.month DESC, ce.created_at DESC, ce.id),
                            '[]'::JSONB)
              FROM public.billing_cost_entries ce
             WHERE ce.month >= p_from AND ce.month <= p_to);
END $$;

-- Adds a cost entry (no "id") or replaces every field of one (with "id").
CREATE OR REPLACE FUNCTION public.billing_save_cost(p_actor UUID, p_cost JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_id UUID;
    v_raw_id TEXT;
    v_month_text TEXT;
    v_month DATE;
    v_category TEXT;
    v_label TEXT;
    v_amount BIGINT;
    v_note TEXT;
BEGIN
    IF p_cost IS NULL OR jsonb_typeof(p_cost) <> 'object' THEN
        RAISE EXCEPTION 'Send the cost as an object.' USING ERRCODE = 'P0001';
    END IF;

    v_month_text := public.billing_json_text(p_cost, 'month', 'The month', 10, NULL);
    IF v_month_text IS NULL OR v_month_text !~ '^\d{4}-\d{2}-01$' THEN
        RAISE EXCEPTION 'The month must be the first day of a month, like 2026-10-01.'
            USING ERRCODE = 'P0001';
    END IF;
    BEGIN
        v_month := v_month_text::DATE;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'The month must be the first day of a month, like 2026-10-01.'
            USING ERRCODE = 'P0001';
    END;

    v_category := public.billing_json_text(p_cost, 'category', 'The category', 20, NULL);
    IF v_category IS NULL OR v_category NOT IN ('infra', 'ai', 'payments', 'support', 'other') THEN
        RAISE EXCEPTION 'The category must be infra, ai, payments, support or other.'
            USING ERRCODE = 'P0001';
    END IF;
    v_label := public.billing_json_text(p_cost, 'label', 'The label', 120, NULL);
    IF v_label IS NULL OR v_label = '' THEN
        RAISE EXCEPTION 'Give the cost a label.' USING ERRCODE = 'P0001';
    END IF;
    IF p_cost -> 'amount_centavos' IS NULL OR jsonb_typeof(p_cost -> 'amount_centavos') = 'null' THEN
        RAISE EXCEPTION 'Give the cost an amount.' USING ERRCODE = 'P0001';
    END IF;
    v_amount := public.billing_json_int(p_cost, 'amount_centavos', 'The amount', false, 0, 100000000000000);
    v_note := nullif(public.billing_json_text(p_cost, 'note', 'The note', 500, NULL), '');

    v_raw_id := public.billing_json_text(p_cost, 'id', 'The cost id', 36, NULL);
    IF v_raw_id IS NULL OR v_raw_id = '' THEN
        INSERT INTO public.billing_cost_entries (month, category, label, amount_centavos, note, created_by)
        VALUES (v_month, v_category, v_label, v_amount, v_note, p_actor)
        RETURNING id INTO v_id;
    ELSE
        IF v_raw_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RAISE EXCEPTION 'That cost doesn''t exist.' USING ERRCODE = 'P0001';
        END IF;
        v_id := v_raw_id::UUID;
        PERFORM 1 FROM public.billing_cost_entries WHERE id = v_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'That cost doesn''t exist.' USING ERRCODE = 'P0001';
        END IF;
        UPDATE public.billing_cost_entries
           SET month = v_month, category = v_category, label = v_label,
               amount_centavos = v_amount, note = v_note
         WHERE id = v_id;
    END IF;

    PERFORM public.billing_audit(p_actor, 'finance.cost_saved', 'cost', v_id::TEXT,
        jsonb_build_object('cost_id', v_id, 'month', v_month, 'category', v_category));
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.billing_delete_cost(p_actor UUID, p_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_month DATE;
BEGIN
    SELECT ce.month INTO v_month FROM public.billing_cost_entries ce
     WHERE ce.id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That cost doesn''t exist.' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.billing_cost_entries WHERE id = p_id;
    PERFORM public.billing_audit(p_actor, 'finance.cost_deleted', 'cost', p_id::TEXT,
        jsonb_build_object('cost_id', p_id, 'month', v_month));
END $$;

-- ---------------------------------------------------------------- Model prices

CREATE OR REPLACE FUNCTION public.billing_list_model_prices(p_actor UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce(jsonb_agg(to_jsonb(mp) ORDER BY mp.model), '[]'::JSONB)
    FROM public.billing_model_prices mp
$$;

-- Creates or replaces the price of one model (upsert by model).
CREATE OR REPLACE FUNCTION public.billing_save_model_price(p_actor UUID, p_price JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_model TEXT;
    v_in BIGINT;
    v_out BIGINT;
    v_audio BIGINT;
    v_note TEXT;
BEGIN
    IF p_price IS NULL OR jsonb_typeof(p_price) <> 'object' THEN
        RAISE EXCEPTION 'Send the price as an object.' USING ERRCODE = 'P0001';
    END IF;
    v_model := public.billing_json_text(p_price, 'model', 'The model', 80, NULL);
    IF v_model IS NULL OR v_model = '' THEN
        RAISE EXCEPTION 'Give the model a name.' USING ERRCODE = 'P0001';
    END IF;
    v_in := public.billing_json_int(p_price, 'input_centavos_per_1m', 'The input price', false, 0, 100000000000000);
    v_out := public.billing_json_int(p_price, 'output_centavos_per_1m', 'The output price', false, 0, 100000000000000);
    v_audio := public.billing_json_int(p_price, 'audio_centavos_per_minute', 'The audio price', false, 0, 100000000000000);
    v_note := nullif(public.billing_json_text(p_price, 'note', 'The note', 300, NULL), '');

    INSERT INTO public.billing_model_prices
        (model, input_centavos_per_1m, output_centavos_per_1m, audio_centavos_per_minute, note)
    VALUES (v_model, v_in, v_out, v_audio, v_note)
    ON CONFLICT (model) DO UPDATE
        SET input_centavos_per_1m = EXCLUDED.input_centavos_per_1m,
            output_centavos_per_1m = EXCLUDED.output_centavos_per_1m,
            audio_centavos_per_minute = EXCLUDED.audio_centavos_per_minute,
            note = EXCLUDED.note;

    PERFORM public.billing_audit(p_actor, 'finance.price_saved', 'model_price', v_model,
        jsonb_build_object('model', v_model));
END $$;

-- ---------------------------------------------------------------- Privileges

DO $$
DECLARE
    f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.billing_price_ai_call(TEXT, INT, INT, NUMERIC)',
        'public.billing_record_ai_usage(UUID, UUID, TEXT, TEXT, INT, INT, NUMERIC)',
        'public.billing_finance(UUID, DATE, DATE, TIMESTAMPTZ)',
        'public.billing_list_costs(UUID, DATE, DATE)',
        'public.billing_save_cost(UUID, JSONB)',
        'public.billing_delete_cost(UUID, UUID)',
        'public.billing_list_model_prices(UUID)',
        'public.billing_save_model_price(UUID, JSONB)'
    ] LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END $$;

COMMIT;
