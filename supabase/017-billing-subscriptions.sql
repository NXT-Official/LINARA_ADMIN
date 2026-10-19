-- LINARA_ADMIN, Phase 8 — subscriptions and invoices. Apply after 016-billing-plans.sql.
-- Shared with LINARA: its seat-limit trigger calls billing_household_entitlements;
-- its edge functions call billing_record_invoice_result.
-- Spec: LINARA docs/superpowers/specs/2026-10-19-sell-linara-design.md (billing).
--
-- Apply by hand in the Supabase SQL editor: linara dev first. One transaction.
-- Safe to run twice.
--
-- billing_subscriptions is one purchase of a plan by its owner (the primary
-- manager who paid; NULL once that account is deleted), covering the
-- households in billing_subscription_homes. billing_invoices is each bill for
-- it, numbered LIN-<year>-000001 per Manila calendar year from
-- billing_invoice_counters, and sent to Xendit with external_id
-- 'sub_<subscription id>_<n>' (n counts that subscription's invoices). Money is
-- integer centavos (PHP, tax-inclusive; no VAT: the seller is a non-VAT BMBE).
--
-- Access: the four tables have RLS on, no policies, and nothing for anon or
-- authenticated. Everything goes through the functions below.
--   Household functions (documented exception to the console's staff-only
--   rule): granted to authenticated, they check auth.uid() themselves and
--   refuse with 'CODE:detail' (NOT_PRIMARY, PLAN_NOT_ACTIVE,
--   SEATS_OVER_PLAN:<kind>, ONE_TIME_PLAN, NOT_FOUND, NOT_FOUND:revoked,
--   BAD_URL, BAD_SESSION, BAD_SEATS:<kind>); the web matches the prefix. Seat counts asked for are
--   0 to 1000 (NULL: the plan's included seats).
--     billing_quote ............. any signed-in user
--     billing_trial_eligible,
--     billing_start ............. a primary manager of every home
--     billing_attach_session, billing_renew,
--     billing_cancel ............ the current primary manager of every home the
--                                 subscription covers (not an owner who has
--                                 since handed over or left, nor a primary of
--                                 only one of its homes)
--     billing_household_entitlements,
--     billing_my_billing ........ the household's managers. The entitlements
--                                 are also read inside LINARA's seat-limit
--                                 trigger, whoever is writing.
--     billing_my_billing returns subscriptions without note and invoices with
--     their 13 safe columns only: not raw_callback (Xendit's payload),
--     payer_email, xendit_session_id, paid_centavos, paid_channel or quote.
--   billing_record_invoice_result: the Xendit webhook, service_role only.
--   Staff (service_role only, p_actor first, plain-sentence refusals):
--     billing_grant, billing_mark_paid and billing_revoke audit in the same
--     transaction with ids and the reason only, never amounts (S-22);
--     billing_household_detail and billing_invoice_detail read the notes and
--     raw callbacks.
--
-- Seats: NULL means unlimited, on a plan (included_*) and on a subscription
-- (helper_seats, manager_seats). Seats are PER HOME, on purpose: a
-- subscription for 2 homes with 3 helper seats gives each home 3. A quote
-- never gives fewer seats than the plan includes.
--
-- Payments: the webhook is idempotent and only PAID, EXPIRED and FAILED change
-- anything (see billing_settle_invoice). A Xendit payment that can't be applied
-- (the invoice was already paid, by hand or by another session, or its plan was
-- replaced) is never silent: it is noted on the subscription for staff to
-- refund, with its callback kept. Paying a subscription in full for the first
-- time makes it its homes' plan: any other running subscription whose homes are
-- all among its homes ends then, any checkout on those homes never paid for
-- (pending) is canceled, and their pending invoices expire (changing plan starts
-- a new period on payment). A renewal replaces nothing. A subscription that
-- also covers a home the payer's doesn't is left alone. Nor does a first
-- payment replace anything when the buyer is no longer the primary manager of
-- every home it covers (handed over or left since the checkout began): the
-- money was received, so it still activates, noted for staff to check with the
-- household. Each invoice start and renew make carries the quote it was priced
-- from (billing_invoices.quote); paying it in full sets the subscription's
-- seats to that quote's. Staff end any subscription for good with
-- billing_revoke (revoked_at): it can't be renewed, canceled, given a payment
-- link or paid again (a PAID for it is noted for a refund), and gives no
-- entitlement; a new subscription for its homes is unaffected.
--
-- Trials: a plan's trial is given only when none of the homes has had a
-- subscription that started, and the buyer has never owned one that started.
-- A checkout that was never paid (pending, or canceled before it started)
-- doesn't use it up. A trial is the plan as it comes: its included seats
-- whatever was asked for, and no more homes than it includes.
--
-- Entitlement: a subscription covers its homes once it has started (paid,
-- comped or trialing, so current_period_start is set; a pending or underpaid
-- one that never started covers nothing) and until 7 days after its period
-- ends, those 7 days being past_due; a canceled one until its period ends. A
-- NULL period end (a one-time plan, an open-ended comp) never ends. Otherwise
-- the household is on the free tier (billing_settings), or has no seats when
-- the free tier is off. LINARA's add-seat-limits.sql enforces the seats.

BEGIN;

-- ---------------------------------------------------------------- Tables

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id              UUID NOT NULL REFERENCES public.billing_plans(id),
    -- A deleted account leaves its subscriptions and their invoices (the
    -- revenue record) in place, without an owner.
    owner_user_id        UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    status               TEXT NOT NULL
                         CHECK (status IN ('pending', 'trialing', 'active', 'past_due',
                                           'expired', 'canceled')),
    helper_seats         INT NULL CHECK (helper_seats >= 0),
    manager_seats        INT NULL CHECK (manager_seats >= 0),
    home_seats           INT NOT NULL DEFAULT 1 CHECK (home_seats >= 1),
    amount_centavos      BIGINT NOT NULL CHECK (amount_centavos >= 0),
    current_period_start TIMESTAMPTZ NULL,
    current_period_end   TIMESTAMPTZ NULL,
    canceled_at          TIMESTAMPTZ NULL,
    note                 TEXT NULL,
    -- Set once by billing_revoke and never cleared: a revoked subscription
    -- can't be renewed, paid, canceled or given a payment link again.
    revoked_at           TIMESTAMPTZ NULL,
    revoked_by           UUID NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- For a database that ran an earlier version of this file.
ALTER TABLE public.billing_subscriptions
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS revoked_by UUID NULL;
CREATE INDEX IF NOT EXISTS billing_subscriptions_plan_idx
    ON public.billing_subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS billing_subscriptions_owner_idx
    ON public.billing_subscriptions (owner_user_id);

CREATE TABLE IF NOT EXISTS public.billing_subscription_homes (
    subscription_id UUID NOT NULL REFERENCES public.billing_subscriptions(id) ON DELETE CASCADE,
    household_id    UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
    PRIMARY KEY (subscription_id, household_id)
);
CREATE INDEX IF NOT EXISTS billing_subscription_homes_household_idx
    ON public.billing_subscription_homes (household_id);

CREATE TABLE IF NOT EXISTS public.billing_invoice_counters (
    year INT PRIMARY KEY,
    last INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.billing_invoices (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number    TEXT NOT NULL UNIQUE,
    subscription_id   UUID NOT NULL REFERENCES public.billing_subscriptions(id),
    external_id       TEXT NOT NULL UNIQUE,
    xendit_session_id TEXT NULL,
    payment_url       TEXT NULL,
    expires_at        TIMESTAMPTZ NULL,
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
    amount_centavos   BIGINT NOT NULL CHECK (amount_centavos >= 0),
    currency          TEXT NOT NULL DEFAULT 'PHP',
    period_start      TIMESTAMPTZ NOT NULL,
    period_end        TIMESTAMPTZ NULL,
    paid_at           TIMESTAMPTZ NULL,
    paid_centavos     BIGINT NULL,
    paid_channel      TEXT NULL,
    payer_email       TEXT NULL,
    raw_callback      JSONB NULL,
    -- {helper_seats, manager_seats, home_seats, amount_centavos} the invoice
    -- was priced from.
    quote             JSONB NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_invoices_subscription_idx
    ON public.billing_invoices (subscription_id);
CREATE INDEX IF NOT EXISTS billing_invoices_status_idx ON public.billing_invoices (status);

DROP TRIGGER IF EXISTS billing_subscriptions_touch ON public.billing_subscriptions;
CREATE TRIGGER billing_subscriptions_touch BEFORE UPDATE ON public.billing_subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.billing_touch_updated_at();

ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscription_homes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invoice_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_subscriptions, public.billing_subscription_homes,
              public.billing_invoice_counters, public.billing_invoices
    FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- Audit

-- billing_audit (016) with the staff member's reason in the log's reason column.
CREATE OR REPLACE FUNCTION public.billing_audit(
    p_actor UUID, p_action TEXT, p_target_type TEXT, p_target_id TEXT, p_reason TEXT,
    p_metadata JSONB
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.staff_audit_log
        (actor_user_id, action, target_type, target_id, reason, metadata)
    VALUES (p_actor, p_action, p_target_type, p_target_id, p_reason,
            coalesce(p_metadata, '{}'::JSONB))
$$;

-- ---------------------------------------------------------------- Internal helpers
-- No caller check of their own: only the functions further down call them.

-- Whether p_user manages the household, in any manager role.
CREATE OR REPLACE FUNCTION public.billing_manages(p_user UUID, p_household_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT p_user IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.household_managers hm
                   WHERE hm.household_id = p_household_id AND hm.user_id = p_user)
$$;

-- Whether p_user may act for a subscription (pay for it, cancel it, attach its
-- payment link): the current primary manager of EVERY home it covers, as
-- billing_start requires of a buyer, so a primary of one home can't act for
-- another household's coverage. The owner qualifies only while still that; one
-- who handed over or left does not. A subscription with no homes left (its
-- households deleted) has no one to act for it.
CREATE OR REPLACE FUNCTION public.billing_can_manage(p_user UUID, p_subscription_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT p_user IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.billing_subscription_homes sh
                   WHERE sh.subscription_id = p_subscription_id)
       AND NOT EXISTS (
           SELECT 1 FROM public.billing_subscription_homes sh
           WHERE sh.subscription_id = p_subscription_id
             AND NOT EXISTS (SELECT 1 FROM public.household_managers hm
                             WHERE hm.household_id = sh.household_id
                               AND hm.user_id = p_user
                               AND hm.role = 'primary_manager'))
$$;

-- The end of a period starting at p_start: a month or a year on, or none for a
-- one-time plan.
CREATE OR REPLACE FUNCTION public.billing_period_end(p_start TIMESTAMPTZ, p_interval TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT CASE p_interval
               WHEN 'monthly' THEN p_start + INTERVAL '1 month'
               WHEN 'yearly' THEN p_start + INTERVAL '1 year'
           END
$$;

-- ₱1,234.50 for 123450 centavos, for notes staff read.
CREATE OR REPLACE FUNCTION public.billing_peso(p_centavos BIGINT) RETURNS TEXT
LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT '₱' || to_char(p_centavos / 100.0, 'FM999,999,999,990.00')
$$;

-- A note line added under whatever is there.
CREATE OR REPLACE FUNCTION public.billing_add_note(p_note TEXT, p_line TEXT) RETURNS TEXT
LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT concat_ws(E'\n', nullif(p_note, ''), p_line)
$$;

-- Staff text: trimmed, NULL when empty, refused past p_max characters.
CREATE OR REPLACE FUNCTION public.billing_text(p_value TEXT, p_label TEXT, p_max INT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
    s TEXT := nullif(btrim(p_value), '');
BEGIN
    IF char_length(s) > p_max THEN
        RAISE EXCEPTION '% is too long (% characters at most).', p_label, p_max
            USING ERRCODE = 'P0001';
    END IF;
    RETURN s;
END $$;

-- Seat counts a household asks for: NULL (the plan's included) or 0 to 1000.
CREATE OR REPLACE FUNCTION public.billing_check_seats(p_helper_seats INT, p_manager_seats INT)
RETURNS VOID
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
    IF p_helper_seats < 0 OR p_helper_seats > 1000 THEN
        RAISE EXCEPTION 'BAD_SEATS:helper';
    END IF;
    IF p_manager_seats < 0 OR p_manager_seats > 1000 THEN
        RAISE EXCEPTION 'BAD_SEATS:manager';
    END IF;
END $$;

-- LIN-2026-000001: the next number of the current Manila year. The upsert
-- locks that year's counter row, so concurrent callers queue and never share a
-- number. Past 999999 the number just grows a digit.
CREATE OR REPLACE FUNCTION public.billing_next_invoice_number() RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_year INT := EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Manila')::INT;
    v_last INT;
BEGIN
    INSERT INTO public.billing_invoice_counters AS c (year, last)
    VALUES (v_year, 1)
    ON CONFLICT (year) DO UPDATE SET last = c.last + 1
    RETURNING c.last INTO v_last;
    RETURN 'LIN-' || v_year || '-' || lpad(v_last::TEXT, GREATEST(6, length(v_last::TEXT)), '0');
END $$;

-- The price of a plan for these seats and homes, from the plan's stored prices
-- whatever its status (a renewal on an archived plan prices the same way).
-- NULL included_* is unlimited: NULL seats and nothing extra.
CREATE OR REPLACE FUNCTION public.billing_price(
    p_plan public.billing_plans, p_helper_seats INT, p_manager_seats INT, p_homes INT
) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
    v_helpers INT;
    v_managers INT;
    v_helper_extra BIGINT := 0;
    v_manager_extra BIGINT := 0;
    v_home_extra BIGINT := 0;
BEGIN
    IF p_plan.included_helpers IS NOT NULL THEN
        v_helpers := GREATEST(coalesce(p_helper_seats, p_plan.included_helpers),
                              p_plan.included_helpers);
        IF v_helpers > p_plan.included_helpers AND p_plan.extra_helper_centavos IS NULL THEN
            RAISE EXCEPTION 'SEATS_OVER_PLAN:helper';
        END IF;
        v_helper_extra := (v_helpers - p_plan.included_helpers)
                          * coalesce(p_plan.extra_helper_centavos, 0);
    END IF;

    IF p_plan.included_managers IS NOT NULL THEN
        v_managers := GREATEST(coalesce(p_manager_seats, p_plan.included_managers),
                               p_plan.included_managers);
        IF v_managers > p_plan.included_managers AND p_plan.extra_manager_centavos IS NULL THEN
            RAISE EXCEPTION 'SEATS_OVER_PLAN:manager';
        END IF;
        v_manager_extra := (v_managers - p_plan.included_managers)
                           * coalesce(p_plan.extra_manager_centavos, 0);
    END IF;

    IF p_plan.included_homes IS NOT NULL AND p_homes > p_plan.included_homes THEN
        IF p_plan.extra_home_centavos IS NULL THEN
            RAISE EXCEPTION 'SEATS_OVER_PLAN:home';
        END IF;
        v_home_extra := (p_homes - p_plan.included_homes) * p_plan.extra_home_centavos;
    END IF;

    RETURN jsonb_build_object(
        'amount_centavos', p_plan.base_centavos + v_helper_extra + v_manager_extra + v_home_extra,
        'base_centavos', p_plan.base_centavos,
        'helper_extra_centavos', v_helper_extra,
        'manager_extra_centavos', v_manager_extra,
        'home_extra_centavos', v_home_extra,
        'helper_seats', v_helpers,
        'manager_seats', v_managers,
        'home_seats', p_homes,
        'interval', p_plan.interval);
END $$;

-- A pending invoice for the period starting at p_period_start, priced from
-- p_quote ({helper_seats, manager_seats, home_seats, amount_centavos}, kept on
-- the invoice). Counts the subscription's invoices for external_id's n under a
-- lock on the subscription, so two callers can't both take the same n.
CREATE OR REPLACE FUNCTION public.billing_new_invoice(
    p_subscription_id UUID, p_period_start TIMESTAMPTZ, p_quote JSONB
) RETURNS public.billing_invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_sub public.billing_subscriptions%ROWTYPE;
    v_interval TEXT;
    v_n INT;
    v_invoice public.billing_invoices%ROWTYPE;
BEGIN
    SELECT * INTO v_sub FROM public.billing_subscriptions
    WHERE id = p_subscription_id FOR UPDATE;
    SELECT p.interval INTO v_interval FROM public.billing_plans p WHERE p.id = v_sub.plan_id;
    SELECT count(*) + 1 INTO v_n FROM public.billing_invoices WHERE subscription_id = v_sub.id;
    INSERT INTO public.billing_invoices
        (invoice_number, subscription_id, external_id, amount_centavos, period_start, period_end,
         quote)
    VALUES (public.billing_next_invoice_number(), v_sub.id, 'sub_' || v_sub.id || '_' || v_n,
            (p_quote ->> 'amount_centavos')::BIGINT, p_period_start,
            public.billing_period_end(p_period_start, v_interval), p_quote)
    RETURNING * INTO v_invoice;
    RETURN v_invoice;
END $$;

-- The one transition from a payment result, for the webhook and for staff
-- marking an invoice paid by hand (p_xendit_id NULL). Reports
-- {applied, invoice_status, subscription_status}; when not applied, nothing
-- changed apart from a duplicate-payment note.
--   Only PAID, EXPIRED and FAILED do anything; any other status (or none) is
--     not applied.
--   EXPIRED / FAILED: only a pending invoice, and only from the session stored
--     for it (or any when none is stored), so a stale session's late result
--     can't kill the live one.
--   PAID on a pending, expired or failed invoice, as invoiced (p_paid_centavos
--     NULL or equal): the invoice is paid, its period rewritten to the one
--     granted, and the subscription active for that period: from the current
--     period's end if that's still ahead, else from now, with the seats of the
--     invoice's quote when it has one. On its first payment (the subscription
--     had never started; a renewal replaces nothing) every other running
--     subscription whose homes are all among this one's ends now, replaced,
--     every checkout never paid for (pending, never started) on those homes is
--     canceled, and their pending invoices expire, marked replaced. That needs
--     the buyer to be primary manager of every covered home NOW, not only
--     when the checkout began: otherwise nothing is replaced and a note asks
--     staff to check with the household.
--   PAID, another amount: the payment is recorded and the subscription marked
--     past_due with a note for staff; its period doesn't move.
--   PAID on an invoice already paid, or expired by a replacement or a staff
--     revoke: not applied. From a Xendit session (p_xendit_id set) it is money
--     taken for nothing when the invoice was marked paid by hand, was paid by
--     another session, or was replaced or revoked: noted once on the
--     subscription for staff to refund, and its
--     callback kept on the invoice (raw_callback when that's empty, else under
--     'callback_<session>'). The session stored on an invoice marked paid by
--     hand is Xendit confirming that payment, which may or may not be a second
--     one: noted once, asking staff to check. The paying session again, or a
--     staff mark again, is just a repeat.
CREATE OR REPLACE FUNCTION public.billing_settle_invoice(
    p_invoice_id UUID, p_status TEXT, p_paid_centavos BIGINT, p_paid_at TIMESTAMPTZ,
    p_channel TEXT, p_raw JSONB, p_xendit_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_invoice public.billing_invoices%ROWTYPE;
    v_sub public.billing_subscriptions%ROWTYPE;
    v_session TEXT := nullif(btrim(p_xendit_id), '');
    v_interval TEXT;
    v_paid BIGINT;
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_replaced BOOLEAN;
    v_confirmed BOOLEAN;
    v_first BOOLEAN;
    v_stale BOOLEAN;
    v_lost TEXT;
    v_paid_on TEXT;
    v_duplicate TEXT;
    v_marker TEXT;
BEGIN
    SELECT * INTO v_invoice FROM public.billing_invoices WHERE id = p_invoice_id FOR UPDATE;
    SELECT * INTO v_sub FROM public.billing_subscriptions
    WHERE id = v_invoice.subscription_id FOR UPDATE;

    IF p_status IS NULL OR p_status NOT IN ('PAID', 'EXPIRED', 'FAILED') THEN
        RETURN jsonb_build_object('applied', false, 'invoice_status', v_invoice.status,
                                  'subscription_status', v_sub.status);
    END IF;

    IF p_status IN ('EXPIRED', 'FAILED') THEN
        IF v_invoice.status <> 'pending'
           OR (v_invoice.xendit_session_id IS NOT NULL
               AND v_session IS DISTINCT FROM v_invoice.xendit_session_id) THEN
            RETURN jsonb_build_object('applied', false, 'invoice_status', v_invoice.status,
                                      'subscription_status', v_sub.status);
        END IF;
        UPDATE public.billing_invoices
        SET status = lower(p_status), raw_callback = p_raw
        WHERE id = v_invoice.id
        RETURNING * INTO v_invoice;
        RETURN jsonb_build_object('applied', true, 'invoice_status', v_invoice.status,
                                  'subscription_status', v_sub.status);
    END IF;

    -- PAID for a revoked subscription never applies and never replaces
    -- anything: noted once per paying session for staff to refund, its
    -- callback kept under 'revoked_paid_<session>'. (A paid invoice's repeats
    -- and duplicates go on to the branch below, which already says what to do.)
    IF v_sub.revoked_at IS NOT NULL AND v_invoice.status <> 'paid' THEN
        v_marker := 'revoked_paid_' || coalesce(v_session, 'none');
        IF NOT coalesce(v_invoice.raw_callback ? v_marker, false) THEN
            UPDATE public.billing_subscriptions
            SET note = public.billing_add_note(note, format(
                    'Paid %s after its plan was revoked on %s; refund in Xendit',
                    v_invoice.invoice_number,
                    to_char(v_sub.revoked_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')))
            WHERE id = v_sub.id
            RETURNING * INTO v_sub;
            UPDATE public.billing_invoices
            SET raw_callback = coalesce(raw_callback, '{}'::JSONB)
                               || jsonb_build_object(v_marker, p_raw)
            WHERE id = v_invoice.id
            RETURNING * INTO v_invoice;
        END IF;
        RETURN jsonb_build_object('applied', false, 'invoice_status', v_invoice.status,
                                  'subscription_status', v_sub.status);
    END IF;

    -- Expired by a replacement (or marked by a revoke): its plan is over.
    v_replaced := v_invoice.status = 'expired'
                  AND coalesce(v_invoice.raw_callback ? 'replaced_by'
                               OR v_invoice.raw_callback ? 'revoked_by', false);
    IF v_invoice.status = 'paid' OR v_replaced THEN
        v_confirmed := NOT v_replaced
                       AND v_invoice.paid_channel LIKE 'manual:%'
                       AND v_session IS NOT DISTINCT FROM v_invoice.xendit_session_id;
        v_marker := CASE WHEN v_confirmed
            THEN format('Xendit confirmed session %s after invoice %s ', v_session,
                        v_invoice.invoice_number)
            ELSE format('session %s paid invoice %s ', v_session, v_invoice.invoice_number)
        END;
        IF v_session IS NOT NULL
           AND (v_replaced
                OR v_invoice.paid_channel LIKE 'manual:%'
                OR v_session IS DISTINCT FROM v_invoice.xendit_session_id)
           AND position(v_marker IN coalesce(v_sub.note, '')) = 0 THEN
            v_paid_on := to_char(coalesce(p_paid_at, now()) AT TIME ZONE 'Asia/Manila',
                                 'YYYY-MM-DD');
            v_duplicate := CASE
                WHEN v_replaced
                THEN format('Late payment: session %s paid invoice %s on %s after its plan was %s; refund in Xendit',
                            v_session, v_invoice.invoice_number, v_paid_on,
                            CASE WHEN v_invoice.raw_callback ? 'revoked_by' THEN 'revoked'
                                 ELSE 'replaced' END)
                WHEN v_confirmed
                THEN format('Xendit confirmed session %s after invoice %s was marked paid by hand on %s; check Xendit and refund if the hand-marked payment was separate',
                            v_session, v_invoice.invoice_number,
                            to_char(coalesce(v_invoice.paid_at, now()) AT TIME ZONE 'Asia/Manila',
                                    'YYYY-MM-DD'))
                ELSE format('Duplicate payment: session %s paid invoice %s again on %s; refund in Xendit',
                            v_session, v_invoice.invoice_number, v_paid_on)
            END;
            UPDATE public.billing_subscriptions
            SET note = public.billing_add_note(note, v_duplicate)
            WHERE id = v_sub.id
            RETURNING * INTO v_sub;
            UPDATE public.billing_invoices
            SET raw_callback = CASE WHEN raw_callback IS NULL THEN p_raw
                                    ELSE raw_callback
                                         || jsonb_build_object('callback_' || v_session, p_raw)
                               END
            WHERE id = v_invoice.id
            RETURNING * INTO v_invoice;
        END IF;
        RETURN jsonb_build_object('applied', false, 'invoice_status', v_invoice.status,
                                  'subscription_status', v_sub.status);
    END IF;

    v_paid := coalesce(p_paid_centavos, v_invoice.amount_centavos);
    IF v_paid = v_invoice.amount_centavos THEN
        SELECT p.interval INTO v_interval FROM public.billing_plans p WHERE p.id = v_sub.plan_id;
        v_start := CASE WHEN v_sub.current_period_end IS NOT NULL
                             AND v_sub.current_period_end > now()
                        THEN v_sub.current_period_end
                        ELSE now() END;
        v_end := public.billing_period_end(v_start, v_interval);
        v_first := v_sub.current_period_start IS NULL;
        -- The buyer's authority now, not when the checkout began: a first
        -- payment from someone no longer primary of every covered home still
        -- buys the plan (the money was received) but replaces nothing.
        v_stale := v_first AND NOT public.billing_can_manage(v_sub.owner_user_id, v_sub.id);
        IF v_stale THEN
            SELECT string_agg(sh.household_id::TEXT, ', ' ORDER BY sh.household_id)
            INTO v_lost
            FROM public.billing_subscription_homes sh
            WHERE sh.subscription_id = v_sub.id
              AND NOT EXISTS (SELECT 1 FROM public.household_managers hm
                              WHERE hm.household_id = sh.household_id
                                AND hm.user_id = v_sub.owner_user_id
                                AND hm.role = 'primary_manager');
        END IF;

        UPDATE public.billing_invoices
        SET status = 'paid',
            paid_at = coalesce(p_paid_at, now()),
            paid_centavos = v_paid,
            paid_channel = p_channel,
            raw_callback = p_raw,
            xendit_session_id = coalesce(v_session, xendit_session_id),
            period_start = v_start,
            period_end = v_end
        WHERE id = v_invoice.id
        RETURNING * INTO v_invoice;

        UPDATE public.billing_subscriptions
        SET status = 'active',
            current_period_start = v_start,
            current_period_end = v_end,
            amount_centavos = v_invoice.amount_centavos,
            canceled_at = NULL,
            helper_seats = CASE WHEN v_invoice.quote IS NULL THEN helper_seats
                                ELSE (v_invoice.quote ->> 'helper_seats')::INT END,
            manager_seats = CASE WHEN v_invoice.quote IS NULL THEN manager_seats
                                 ELSE (v_invoice.quote ->> 'manager_seats')::INT END,
            home_seats = CASE WHEN v_invoice.quote ? 'home_seats'
                              THEN (v_invoice.quote ->> 'home_seats')::INT
                              ELSE home_seats END,
            note = CASE WHEN v_stale
                        THEN public.billing_add_note(note, format(
                                 'Paid after the buyer stopped managing %s; check with the household, and refund in Xendit if the plan wasn''t wanted',
                                 coalesce(v_lost, 'its homes')))
                        ELSE note END
        WHERE id = v_sub.id
        RETURNING * INTO v_sub;

        -- Replaced, on the first payment only (a renewal of a broader plan must
        -- not end a narrower one mid-period): running subscriptions sharing a
        -- home with this one whose homes are all among its homes (the payer is
        -- primary of every one of them), and checkouts on those homes never
        -- paid for (pending, never started), so the link of an abandoned
        -- checkout cannot later activate the old plan over this one. Their
        -- pending invoices expire with them, marked replaced: paying one later
        -- is a late payment to refund. Not when the buyer's authority is stale.
        IF v_first AND NOT v_stale THEN
            WITH replaced AS (
                UPDATE public.billing_subscriptions o
                SET status = 'canceled',
                    canceled_at = now(),
                    current_period_end = CASE WHEN o.current_period_start IS NULL
                                              THEN o.current_period_end
                                              ELSE now() END,
                    note = public.billing_add_note(o.note, 'Replaced by ' || v_sub.id)
                WHERE o.id <> v_sub.id
                  AND ((o.status IN ('trialing', 'active', 'past_due', 'canceled')
                        AND o.current_period_start IS NOT NULL
                        AND (o.current_period_end IS NULL OR o.current_period_end > now()))
                       OR (o.status = 'pending' AND o.current_period_start IS NULL))
                  AND EXISTS (SELECT 1 FROM public.billing_subscription_homes mine
                              JOIN public.billing_subscription_homes theirs
                                ON theirs.household_id = mine.household_id
                              WHERE mine.subscription_id = v_sub.id
                                AND theirs.subscription_id = o.id)
                  AND NOT EXISTS (SELECT 1 FROM public.billing_subscription_homes theirs
                                  WHERE theirs.subscription_id = o.id
                                    AND NOT EXISTS (
                                        SELECT 1 FROM public.billing_subscription_homes mine
                                        WHERE mine.subscription_id = v_sub.id
                                          AND mine.household_id = theirs.household_id))
                RETURNING o.id
            )
            UPDATE public.billing_invoices i
            SET status = 'expired',
                raw_callback = jsonb_build_object('replaced_by', v_sub.id,
                                                  'note', 'Replaced by ' || v_sub.id)
            WHERE i.status = 'pending'
              AND i.subscription_id IN (SELECT id FROM replaced);
        END IF;
    ELSE
        UPDATE public.billing_invoices
        SET status = 'paid',
            paid_at = coalesce(p_paid_at, now()),
            paid_centavos = v_paid,
            paid_channel = p_channel,
            raw_callback = p_raw,
            xendit_session_id = coalesce(v_session, xendit_session_id)
        WHERE id = v_invoice.id
        RETURNING * INTO v_invoice;

        UPDATE public.billing_subscriptions
        SET status = 'past_due',
            note = public.billing_add_note(note,
                       format('Paid %s for an invoice of %s; check in Xendit',
                              public.billing_peso(v_paid),
                              public.billing_peso(v_invoice.amount_centavos)))
        WHERE id = v_sub.id
        RETURNING * INTO v_sub;
    END IF;

    RETURN jsonb_build_object('applied', true, 'invoice_status', v_invoice.status,
                              'subscription_status', v_sub.status);
END $$;

-- What a household is entitled to at p_now, with no caller check. Prefers a
-- covering subscription that isn't expired, the one with the latest period end
-- (NULL, no end, first); with none, the free tier, still naming the latest
-- expired subscription so the page can offer to renew it.
CREATE OR REPLACE FUNCTION public.billing_entitlements(p_household_id UUID, p_now TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_pick RECORD;
    v_days INT;
    v_free BOOLEAN;
    v_free_helpers INT;
    v_free_managers INT;
BEGIN
    SELECT c.id, c.status, c.effective_status, c.helper_seats, c.manager_seats,
           c.current_period_end, p.name AS plan_name
    INTO v_pick
    FROM (
        SELECT s.id, s.plan_id, s.status, s.helper_seats, s.manager_seats,
               s.current_period_end, s.created_at,
               CASE
                   WHEN s.revoked_at IS NOT NULL THEN 'expired'
                   WHEN s.current_period_end IS NULL THEN s.status
                   WHEN s.status = 'canceled' AND s.current_period_end < p_now THEN 'expired'
                   WHEN s.current_period_end < p_now - INTERVAL '7 days' THEN 'expired'
                   WHEN s.current_period_end < p_now THEN 'past_due'
                   ELSE s.status
               END AS effective_status
        FROM public.billing_subscriptions s
        JOIN public.billing_subscription_homes sh ON sh.subscription_id = s.id
        WHERE sh.household_id = p_household_id
          AND s.status IN ('trialing', 'active', 'past_due', 'canceled')
          AND s.current_period_start IS NOT NULL
    ) c
    JOIN public.billing_plans p ON p.id = c.plan_id
    ORDER BY c.effective_status = 'expired', c.current_period_end DESC NULLS FIRST,
             c.created_at DESC
    LIMIT 1;

    v_days := CASE WHEN v_pick.current_period_end IS NOT NULL THEN
                  GREATEST(0, ceil(EXTRACT(EPOCH FROM (v_pick.current_period_end - p_now))
                                   / 86400))::INT
              END;

    IF v_pick.id IS NOT NULL AND v_pick.effective_status <> 'expired' THEN
        RETURN jsonb_build_object(
            'source', 'subscription',
            'subscription_id', v_pick.id,
            'plan_name', v_pick.plan_name,
            'status', v_pick.status,
            'effective_status', v_pick.effective_status,
            'helper_seats', v_pick.helper_seats,
            'manager_seats', v_pick.manager_seats,
            'period_end', v_pick.current_period_end,
            'days_left', v_days);
    END IF;

    SELECT bs.free_tier_enabled, bs.free_helper_seats, bs.free_manager_seats
    INTO v_free, v_free_helpers, v_free_managers
    FROM public.billing_settings bs
    WHERE bs.id = 1;
    -- 016 inserts the row and nothing deletes it; without it, the column default.
    v_free := coalesce(v_free, true);

    RETURN jsonb_build_object(
        'source', CASE WHEN v_free THEN 'free' ELSE 'none' END,
        'subscription_id', v_pick.id,
        'plan_name', v_pick.plan_name,
        'status', v_pick.status,
        'effective_status', v_pick.effective_status,
        'helper_seats', CASE WHEN v_free THEN v_free_helpers ELSE 0 END,
        'manager_seats', CASE WHEN v_free THEN v_free_managers ELSE 0 END,
        'period_end', v_pick.current_period_end,
        'days_left', v_days);
END $$;

-- What takes a seat, as LINARA's seat-limit trigger counts it: helpers that
-- aren't INACTIVE (an invited, unclaimed one takes a seat) and manager rows.
CREATE OR REPLACE FUNCTION public.billing_usage(p_household_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SET search_path = '' AS $$
    SELECT jsonb_build_object(
        'helpers', (SELECT count(*)::INT FROM public.helper_profiles hp
                    WHERE hp.household_id = p_household_id AND hp.status <> 'INACTIVE'),
        'managers', (SELECT count(*)::INT FROM public.household_managers hm
                     WHERE hm.household_id = p_household_id))
$$;

-- ---------------------------------------------------------------- Household functions

-- The price of an active plan for these seats and homes, broken down, for a
-- signed-in user. Read-only.
CREATE OR REPLACE FUNCTION public.billing_quote(
    p_plan_id UUID, p_helper_seats INT, p_manager_seats INT, p_home_ids UUID[]
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_plan public.billing_plans%ROWTYPE;
    v_homes INT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND:user';
    END IF;
    PERFORM public.billing_check_seats(p_helper_seats, p_manager_seats);
    SELECT * INTO v_plan FROM public.billing_plans WHERE id = p_plan_id;
    IF v_plan.id IS NULL OR v_plan.status <> 'active' THEN
        RAISE EXCEPTION 'PLAN_NOT_ACTIVE:plan';
    END IF;
    SELECT count(DISTINCT h) INTO v_homes FROM unnest(p_home_ids) AS h WHERE h IS NOT NULL;
    IF v_homes = 0 THEN
        RAISE EXCEPTION 'NOT_FOUND:home';
    END IF;
    RETURN public.billing_price(v_plan, p_helper_seats, p_manager_seats, v_homes);
END $$;

-- Whether starting this plan for these homes would begin with its trial: the
-- plan has one, the caller is primary manager of every home, none of the homes
-- has had a subscription that started, and the caller has never owned one that
-- started (so new households don't farm trials). A checkout that was never paid
-- doesn't count. billing_start decides with this.
CREATE OR REPLACE FUNCTION public.billing_trial_eligible(p_plan_id UUID, p_home_ids UUID[])
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH homes AS (
        SELECT DISTINCT h AS household_id FROM unnest(p_home_ids) AS h WHERE h IS NOT NULL
    )
    SELECT auth.uid() IS NOT NULL
       AND EXISTS (SELECT 1 FROM homes)
       AND coalesce((SELECT p.trial_days > 0 FROM public.billing_plans p WHERE p.id = p_plan_id),
                    false)
       AND NOT EXISTS (
           SELECT 1 FROM homes
           WHERE NOT EXISTS (SELECT 1 FROM public.household_managers hm
                             WHERE hm.household_id = homes.household_id
                               AND hm.user_id = auth.uid()
                               AND hm.role = 'primary_manager'))
       AND NOT EXISTS (
           SELECT 1 FROM public.billing_subscriptions s
           JOIN public.billing_subscription_homes sh ON sh.subscription_id = s.id
           WHERE sh.household_id IN (SELECT household_id FROM homes)
             AND s.current_period_start IS NOT NULL)
       AND NOT EXISTS (
           SELECT 1 FROM public.billing_subscriptions s
           WHERE s.owner_user_id = auth.uid() AND s.current_period_start IS NOT NULL)
$$;

-- Buys a plan for homes the caller is primary manager of: a pending
-- subscription and its first pending invoice, or a trial (no invoice) when
-- billing_trial_eligible says so. A trial is the plan as it comes: the seats
-- asked for are ignored for its included ones (so a trial can't hand out
-- seats nobody paid for), and it covers no more homes than the plan includes.
CREATE OR REPLACE FUNCTION public.billing_start(
    p_plan_id UUID, p_helper_seats INT, p_manager_seats INT, p_home_ids UUID[]
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_homes UUID[];
    v_plan public.billing_plans%ROWTYPE;
    v_quote JSONB;
    v_trial BOOLEAN;
    v_sub public.billing_subscriptions%ROWTYPE;
    v_invoice public.billing_invoices%ROWTYPE;
BEGIN
    PERFORM public.billing_check_seats(p_helper_seats, p_manager_seats);
    v_homes := ARRAY(SELECT DISTINCT h FROM unnest(p_home_ids) AS h WHERE h IS NOT NULL ORDER BY h);
    IF cardinality(v_homes) = 0 THEN
        RAISE EXCEPTION 'NOT_FOUND:home';
    END IF;
    IF v_uid IS NULL OR EXISTS (
        SELECT 1 FROM unnest(v_homes) AS h
        WHERE NOT EXISTS (SELECT 1 FROM public.household_managers hm
                          WHERE hm.household_id = h AND hm.user_id = v_uid
                            AND hm.role = 'primary_manager')) THEN
        RAISE EXCEPTION 'NOT_PRIMARY:home';
    END IF;

    -- One start at a time per buyer and per home, so two at once can't both
    -- take a trial (billing_trial_eligible is keyed on both).
    PERFORM pg_advisory_xact_lock(hashtext('trial:' || v_uid::TEXT));
    PERFORM 1 FROM public.households WHERE id = ANY (v_homes) ORDER BY id FOR NO KEY UPDATE;

    v_trial := public.billing_trial_eligible(p_plan_id, v_homes);
    IF v_trial THEN
        SELECT * INTO v_plan FROM public.billing_plans WHERE id = p_plan_id;
        IF v_plan.status <> 'active' THEN
            RAISE EXCEPTION 'PLAN_NOT_ACTIVE:plan';
        END IF;
        IF v_plan.included_homes IS NOT NULL
           AND cardinality(v_homes) > v_plan.included_homes THEN
            RAISE EXCEPTION 'SEATS_OVER_PLAN:home';
        END IF;
        v_quote := public.billing_price(v_plan, v_plan.included_helpers,
                                        v_plan.included_managers, cardinality(v_homes));
    ELSE
        v_quote := public.billing_quote(p_plan_id, p_helper_seats, p_manager_seats, v_homes);
    END IF;

    INSERT INTO public.billing_subscriptions
        (plan_id, owner_user_id, status, helper_seats, manager_seats, home_seats, amount_centavos,
         current_period_start, current_period_end)
    VALUES (p_plan_id, v_uid,
            CASE WHEN v_trial THEN 'trialing' ELSE 'pending' END,
            (v_quote ->> 'helper_seats')::INT,
            (v_quote ->> 'manager_seats')::INT,
            (v_quote ->> 'home_seats')::INT,
            (v_quote ->> 'amount_centavos')::BIGINT,
            CASE WHEN v_trial THEN now() END,
            CASE WHEN v_trial THEN now() + make_interval(days => v_plan.trial_days) END)
    RETURNING * INTO v_sub;

    INSERT INTO public.billing_subscription_homes (subscription_id, household_id)
    SELECT v_sub.id, h FROM unnest(v_homes) AS h;

    IF NOT v_trial THEN
        SELECT * INTO v_invoice
        FROM public.billing_new_invoice(v_sub.id, now(), jsonb_build_object(
                 'helper_seats', v_quote -> 'helper_seats',
                 'manager_seats', v_quote -> 'manager_seats',
                 'home_seats', v_quote -> 'home_seats',
                 'amount_centavos', v_quote -> 'amount_centavos'));
    END IF;

    RETURN jsonb_build_object(
        'subscription_id', v_sub.id,
        'invoice_id', v_invoice.id,
        'external_id', v_invoice.external_id,
        'invoice_number', v_invoice.invoice_number,
        'amount_centavos', v_sub.amount_centavos,
        'status', v_sub.status);
END $$;

-- Stores the Xendit Payment Session made for a pending invoice, and the email
-- the web gave Xendit for the payer. The link must be Xendit's. Never for a
-- revoked subscription (NOT_FOUND:revoked, to those who may act for it).
CREATE OR REPLACE FUNCTION public.billing_attach_session(
    p_invoice_id UUID, p_xendit_id TEXT, p_url TEXT, p_expires_at TIMESTAMPTZ,
    p_payer_email TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    -- Trimmed as billing_settle_invoice trims the webhook's, so they compare.
    v_session TEXT := nullif(btrim(p_xendit_id), '');
    v_subscription UUID;
    v_revoked BOOLEAN;
BEGIN
    IF p_url IS NULL
       OR NOT (p_url ~* '^https://xen\.to/' OR p_url ~* '^https://([a-z0-9-]+\.)+xendit\.co/') THEN
        RAISE EXCEPTION 'BAD_URL:payment_url';
    END IF;
    IF v_session IS NULL THEN
        RAISE EXCEPTION 'BAD_SESSION:xendit_id';
    END IF;
    SELECT s.id, s.revoked_at IS NOT NULL INTO v_subscription, v_revoked
    FROM public.billing_invoices i
    JOIN public.billing_subscriptions s ON s.id = i.subscription_id
    WHERE i.id = p_invoice_id;
    IF v_revoked AND public.billing_can_manage(auth.uid(), v_subscription) THEN
        RAISE EXCEPTION 'NOT_FOUND:revoked';
    END IF;
    UPDATE public.billing_invoices i
    SET xendit_session_id = v_session,
        payment_url = p_url,
        expires_at = p_expires_at,
        payer_email = coalesce(nullif(btrim(p_payer_email), ''), i.payer_email)
    WHERE i.id = p_invoice_id
      AND i.status = 'pending'
      AND public.billing_can_manage(auth.uid(), i.subscription_id);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND:invoice';
    END IF;
END $$;

-- An invoice for the next period, or the pending one if there is one already
-- (reused). The next period starts when the current one ends, or now if it has
-- ended. The invoice carries its quote: the subscription's seats and amount. A
-- comp (amount 0) is priced from its plan for its seats, so its renewal isn't
-- free; a comp seat that's NULL (unlimited) is priced, and after payment
-- granted, as the plan's included seats, or 1 where the plan has none. Never
-- for a revoked subscription (NOT_FOUND:revoked).
CREATE OR REPLACE FUNCTION public.billing_renew(p_subscription_id UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_sub public.billing_subscriptions%ROWTYPE;
    v_plan public.billing_plans%ROWTYPE;
    v_invoice public.billing_invoices%ROWTYPE;
    v_price JSONB;
    v_quote JSONB;
    v_reused BOOLEAN := true;
BEGIN
    IF NOT public.billing_can_manage(auth.uid(), p_subscription_id) THEN
        RAISE EXCEPTION 'NOT_FOUND:subscription';
    END IF;
    SELECT * INTO v_sub FROM public.billing_subscriptions WHERE id = p_subscription_id FOR UPDATE;
    IF v_sub.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'NOT_FOUND:revoked';
    END IF;
    SELECT * INTO v_plan FROM public.billing_plans WHERE id = v_sub.plan_id;
    IF v_plan.interval = 'one_time' THEN
        RAISE EXCEPTION 'ONE_TIME_PLAN:subscription';
    END IF;

    SELECT * INTO v_invoice FROM public.billing_invoices
    WHERE subscription_id = v_sub.id AND status = 'pending'
    ORDER BY created_at DESC, invoice_number DESC
    LIMIT 1;
    IF v_invoice.id IS NULL THEN
        v_reused := false;
        IF v_sub.amount_centavos = 0 THEN
            v_price := public.billing_price(
                v_plan,
                coalesce(v_sub.helper_seats, v_plan.included_helpers, 1),
                coalesce(v_sub.manager_seats, v_plan.included_managers, 1),
                v_sub.home_seats);
            v_quote := jsonb_build_object(
                'helper_seats', v_price -> 'helper_seats',
                'manager_seats', v_price -> 'manager_seats',
                'home_seats', v_price -> 'home_seats',
                'amount_centavos', v_price -> 'amount_centavos');
        ELSE
            v_quote := jsonb_build_object(
                'helper_seats', v_sub.helper_seats,
                'manager_seats', v_sub.manager_seats,
                'home_seats', v_sub.home_seats,
                'amount_centavos', v_sub.amount_centavos);
        END IF;
        SELECT * INTO v_invoice
        FROM public.billing_new_invoice(
                 v_sub.id, GREATEST(now(), coalesce(v_sub.current_period_end, now())), v_quote);
    END IF;

    RETURN jsonb_build_object(
        'subscription_id', v_sub.id,
        'invoice_id', v_invoice.id,
        'external_id', v_invoice.external_id,
        'invoice_number', v_invoice.invoice_number,
        'amount_centavos', v_invoice.amount_centavos,
        'status', v_sub.status,
        'reused', v_reused);
END $$;

-- Stops a subscription; its homes stay entitled until the period ends. A comp
-- (amount 0) ends now. A revoked one is already over (NOT_FOUND:revoked).
CREATE OR REPLACE FUNCTION public.billing_cancel(p_subscription_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_revoked BOOLEAN;
BEGIN
    IF NOT public.billing_can_manage(auth.uid(), p_subscription_id) THEN
        RAISE EXCEPTION 'NOT_FOUND:subscription';
    END IF;
    SELECT revoked_at IS NOT NULL INTO v_revoked FROM public.billing_subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;
    IF v_revoked THEN
        RAISE EXCEPTION 'NOT_FOUND:revoked';
    END IF;
    UPDATE public.billing_subscriptions
    SET status = 'canceled',
        canceled_at = coalesce(canceled_at, now()),
        current_period_end = CASE WHEN amount_centavos = 0
                                  THEN LEAST(coalesce(current_period_end, now()), now())
                                  ELSE current_period_end END
    WHERE id = p_subscription_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND:subscription';
    END IF;
END $$;

-- What a household is entitled to (see the header). A signed-in caller must
-- manage the household, unless the call comes from inside a trigger: LINARA's
-- seat-limit trigger asks for the household being written to, whoever writes
-- (a helper claiming an invite, a new co-manager). The server key (no
-- auth.uid()) reads any household's.
CREATE OR REPLACE FUNCTION public.billing_household_entitlements(p_household_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NOT NULL AND pg_trigger_depth() = 0
       AND NOT public.billing_manages(v_uid, p_household_id) THEN
        RAISE EXCEPTION 'NOT_FOUND:household';
    END IF;
    RETURN public.billing_entitlements(p_household_id, now());
END $$;

-- Everything the household's plan page shows, in one call, for its managers:
-- entitlements, the subscriptions covering it (without note, with their plan's
-- name and interval, and whether staff revoked it, so the page can say "Revoked
-- by Linara support"), their invoices (the 13 safe columns), seats in use, the
-- caller's homes, and whether each public plan with a trial would start with
-- it for this home.
CREATE OR REPLACE FUNCTION public.billing_my_billing(p_household_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF NOT public.billing_manages(v_uid, p_household_id) THEN
        RAISE EXCEPTION 'NOT_FOUND:household';
    END IF;
    RETURN jsonb_build_object(
        'entitlements', public.billing_entitlements(p_household_id, now()),
        'subscriptions', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', s.id,
                       'plan_id', s.plan_id,
                       'plan_name', p.name,
                       'interval', p.interval,
                       'owner_user_id', s.owner_user_id,
                       'status', s.status,
                       'helper_seats', s.helper_seats,
                       'manager_seats', s.manager_seats,
                       'home_seats', s.home_seats,
                       'amount_centavos', s.amount_centavos,
                       'current_period_start', s.current_period_start,
                       'current_period_end', s.current_period_end,
                       'canceled_at', s.canceled_at,
                       'created_at', s.created_at,
                       'updated_at', s.updated_at,
                       'revoked', s.revoked_at IS NOT NULL)
                   ORDER BY s.created_at DESC, s.id)
            FROM public.billing_subscriptions s
            JOIN public.billing_subscription_homes sh
              ON sh.subscription_id = s.id AND sh.household_id = p_household_id
            JOIN public.billing_plans p ON p.id = s.plan_id), '[]'::JSONB),
        'invoices', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', i.id,
                       'invoice_number', i.invoice_number,
                       'subscription_id', i.subscription_id,
                       'external_id', i.external_id,
                       'payment_url', i.payment_url,
                       'expires_at', i.expires_at,
                       'status', i.status,
                       'amount_centavos', i.amount_centavos,
                       'currency', i.currency,
                       'period_start', i.period_start,
                       'period_end', i.period_end,
                       'paid_at', i.paid_at,
                       'created_at', i.created_at)
                   ORDER BY i.created_at DESC, i.invoice_number DESC)
            FROM public.billing_invoices i
            JOIN public.billing_subscription_homes sh
              ON sh.subscription_id = i.subscription_id AND sh.household_id = p_household_id),
            '[]'::JSONB),
        'usage', public.billing_usage(p_household_id),
        'homes', coalesce((
            SELECT jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name,
                                                'primary', hm.role = 'primary_manager')
                             ORDER BY lower(h.name), hm.added_at, h.id)
            FROM public.household_managers hm
            JOIN public.households h ON h.id = hm.household_id
            WHERE hm.user_id = v_uid), '[]'::JSONB),
        'trial_eligible_by_plan', coalesce((
            SELECT jsonb_object_agg(p.id::TEXT,
                                    public.billing_trial_eligible(p.id, ARRAY[p_household_id]))
            FROM public.billing_plans p
            WHERE p.status = 'active' AND p.is_public AND p.trial_days > 0), '{}'::JSONB));
END $$;

-- ---------------------------------------------------------------- The webhook

-- The Xendit webhook's result for the invoice it was sent as p_external_id.
-- Idempotent: see billing_settle_invoice. An unknown external_id is reported,
-- not raised, so the webhook can answer 200 to a callback that isn't ours.
CREATE OR REPLACE FUNCTION public.billing_record_invoice_result(
    p_external_id TEXT, p_xendit_id TEXT, p_status TEXT, p_paid_centavos BIGINT,
    p_paid_at TIMESTAMPTZ, p_channel TEXT, p_raw JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_invoice_id UUID;
BEGIN
    SELECT id INTO v_invoice_id FROM public.billing_invoices WHERE external_id = p_external_id;
    IF v_invoice_id IS NULL THEN
        RETURN jsonb_build_object('applied', false, 'invoice_status', NULL,
                                  'subscription_status', NULL);
    END IF;
    RETURN public.billing_settle_invoice(v_invoice_id, upper(btrim(p_status)), p_paid_centavos,
                                         p_paid_at, p_channel, p_raw, p_xendit_id);
END $$;

-- ---------------------------------------------------------------- Staff reads

-- One household's billing in full (notes included), for the household page:
-- entitlements at p_now, the subscriptions covering it (with note, plan name,
-- interval, revoked, and the homes each covers), their invoices with every column, the
-- homes those subscriptions cover, seats in use, and the subscriptions' notes
-- (underpaid, duplicate payment, replaced, comp), latest first.
CREATE OR REPLACE FUNCTION public.billing_household_detail(
    p_actor UUID, p_household_id UUID, p_now TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.households WHERE id = p_household_id) THEN
        RAISE EXCEPTION 'That household doesn''t exist.' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
        'entitlements', public.billing_entitlements(p_household_id, coalesce(p_now, now())),
        'subscriptions', coalesce((
            SELECT jsonb_agg(to_jsonb(s) || jsonb_build_object(
                       'plan_name', p.name,
                       'interval', p.interval,
                       'revoked', s.revoked_at IS NOT NULL,
                       'home_ids', (SELECT jsonb_agg(o.household_id ORDER BY o.household_id)
                                    FROM public.billing_subscription_homes o
                                    WHERE o.subscription_id = s.id))
                   ORDER BY s.created_at DESC, s.id)
            FROM public.billing_subscriptions s
            JOIN public.billing_subscription_homes sh
              ON sh.subscription_id = s.id AND sh.household_id = p_household_id
            JOIN public.billing_plans p ON p.id = s.plan_id), '[]'::JSONB),
        'invoices', coalesce((
            SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at DESC, i.invoice_number DESC)
            FROM public.billing_invoices i
            JOIN public.billing_subscription_homes sh
              ON sh.subscription_id = i.subscription_id AND sh.household_id = p_household_id),
            '[]'::JSONB),
        'homes', coalesce((
            SELECT jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name)
                             ORDER BY lower(h.name), h.id)
            FROM public.households h
            WHERE h.id IN (SELECT o.household_id
                           FROM public.billing_subscription_homes o
                           JOIN public.billing_subscription_homes sh
                             ON sh.subscription_id = o.subscription_id
                           WHERE sh.household_id = p_household_id)), '[]'::JSONB),
        'usage', public.billing_usage(p_household_id),
        'notes', coalesce((
            SELECT jsonb_agg(jsonb_build_object('subscription_id', s.id, 'status', s.status,
                                                'note', s.note)
                             ORDER BY s.updated_at DESC, s.id)
            FROM public.billing_subscriptions s
            JOIN public.billing_subscription_homes sh
              ON sh.subscription_id = s.id AND sh.household_id = p_household_id
            WHERE s.note IS NOT NULL), '[]'::JSONB));
END $$;

-- An invoice and its subscription in full, raw_callback and note included.
CREATE OR REPLACE FUNCTION public.billing_invoice_detail(p_actor UUID, p_invoice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_detail JSONB;
BEGIN
    SELECT jsonb_build_object('invoice', to_jsonb(i), 'subscription', to_jsonb(s))
    INTO v_detail
    FROM public.billing_invoices i
    JOIN public.billing_subscriptions s ON s.id = i.subscription_id
    WHERE i.id = p_invoice_id;
    IF v_detail IS NULL THEN
        RAISE EXCEPTION 'That invoice doesn''t exist.' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_detail;
END $$;

-- ---------------------------------------------------------------- Staff writes

-- A comp: an active subscription for one household, owned by its primary
-- manager, for nothing, until p_period_end (NULL: no end). The paid invoice of
-- 0 keeps revenue honest while the entitlement is real. NULL seats are
-- unlimited.
CREATE OR REPLACE FUNCTION public.billing_grant(
    p_actor UUID, p_household_id UUID, p_plan_id UUID, p_helper_seats INT, p_manager_seats INT,
    p_period_end TIMESTAMPTZ, p_note TEXT, p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_reason TEXT := public.billing_text(p_reason, 'The reason', 300);
    v_note TEXT := public.billing_text(p_note, 'The note', 500);
    v_owner UUID;
    v_sub public.billing_subscriptions%ROWTYPE;
    v_invoice public.billing_invoices%ROWTYPE;
BEGIN
    IF v_reason IS NULL THEN
        RAISE EXCEPTION 'Give a reason for granting this plan.' USING ERRCODE = 'P0001';
    END IF;
    IF p_period_end IS NOT NULL AND p_period_end <= now() THEN
        RAISE EXCEPTION 'The end date must be in the future.' USING ERRCODE = 'P0001';
    END IF;
    IF p_helper_seats < 0 THEN
        RAISE EXCEPTION 'Helper seats can''t be negative.' USING ERRCODE = 'P0001';
    END IF;
    IF p_helper_seats > 1000 THEN
        RAISE EXCEPTION 'Helper seats can be 1000 at most (leave them empty for unlimited).'
            USING ERRCODE = 'P0001';
    END IF;
    IF p_manager_seats < 0 THEN
        RAISE EXCEPTION 'Manager seats can''t be negative.' USING ERRCODE = 'P0001';
    END IF;
    IF p_manager_seats > 1000 THEN
        RAISE EXCEPTION 'Manager seats can be 1000 at most (leave them empty for unlimited).'
            USING ERRCODE = 'P0001';
    END IF;
    SELECT hm.user_id INTO v_owner FROM public.household_managers hm
    WHERE hm.household_id = p_household_id AND hm.role = 'primary_manager'
    ORDER BY hm.added_at
    LIMIT 1;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'That household has no primary manager to hold the plan.'
            USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.billing_plans WHERE id = p_plan_id) THEN
        RAISE EXCEPTION 'That plan doesn''t exist.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.billing_subscriptions
        (plan_id, owner_user_id, status, helper_seats, manager_seats, home_seats, amount_centavos,
         current_period_start, current_period_end, note)
    VALUES (p_plan_id, v_owner, 'active', p_helper_seats, p_manager_seats, 1, 0,
            now(), p_period_end, v_note)
    RETURNING * INTO v_sub;

    INSERT INTO public.billing_subscription_homes (subscription_id, household_id)
    VALUES (v_sub.id, p_household_id);

    INSERT INTO public.billing_invoices
        (invoice_number, subscription_id, external_id, status, amount_centavos, period_start,
         period_end, paid_at, paid_centavos, paid_channel, raw_callback)
    VALUES (public.billing_next_invoice_number(), v_sub.id, 'sub_' || v_sub.id || '_1', 'paid', 0,
            now(), p_period_end, now(), 0, 'comp',
            jsonb_build_object('comp', true, 'note', v_note, 'by', p_actor))
    RETURNING * INTO v_invoice;

    PERFORM public.billing_audit(p_actor, 'billing.granted', 'household', p_household_id::TEXT,
        v_reason, jsonb_build_object('household_id', p_household_id, 'plan_id', p_plan_id,
                                     'subscription_id', v_sub.id, 'invoice_id', v_invoice.id));
    RETURN jsonb_build_object('subscription_id', v_sub.id, 'invoice_id', v_invoice.id);
END $$;

-- Ends a subscription for good, whatever it is (a comp, a paid plan, a trial, a
-- checkout never paid): canceled now, its period ended now (one already over
-- stays over), revoked_at and revoked_by set, the reason noted on it. Every
-- invoice of it not paid (pending, expired, failed) expires, marked revoked.
-- From then on nothing brings it back: renew, cancel and attach refuse it
-- (NOT_FOUND:revoked), a PAID for it is noted for a refund and not applied,
-- staff can't mark its invoices paid, and it gives no entitlement. A new
-- subscription for its homes (a grant, a new checkout) is unaffected.
CREATE OR REPLACE FUNCTION public.billing_revoke(
    p_actor UUID, p_subscription_id UUID, p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_reason TEXT := public.billing_text(p_reason, 'The reason', 300);
    v_sub public.billing_subscriptions%ROWTYPE;
BEGIN
    IF v_reason IS NULL THEN
        RAISE EXCEPTION 'Give a reason for revoking this plan.' USING ERRCODE = 'P0001';
    END IF;
    -- Invoices first, then the subscription: the order billing_settle_invoice
    -- locks them in, so a revoke and a payment at once queue, not deadlock.
    PERFORM 1 FROM public.billing_invoices
    WHERE subscription_id = p_subscription_id
    ORDER BY id
    FOR UPDATE;
    SELECT * INTO v_sub FROM public.billing_subscriptions WHERE id = p_subscription_id FOR UPDATE;
    IF v_sub.id IS NULL THEN
        RAISE EXCEPTION 'That subscription doesn''t exist.' USING ERRCODE = 'P0001';
    END IF;
    IF v_sub.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'That subscription is already revoked.' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.billing_subscriptions
    SET status = 'canceled',
        canceled_at = now(),
        current_period_end = LEAST(coalesce(current_period_end, now()), now()),
        revoked_at = now(),
        revoked_by = p_actor,
        note = public.billing_add_note(note, 'Revoked by staff: ' || v_reason)
    WHERE id = v_sub.id;
    UPDATE public.billing_invoices
    SET status = 'expired',
        raw_callback = coalesce(raw_callback, '{}'::JSONB)
                       || jsonb_build_object('revoked_by', p_actor)
    WHERE subscription_id = v_sub.id AND status IN ('pending', 'expired', 'failed');
    PERFORM public.billing_audit(p_actor, 'billing.revoked', 'subscription', v_sub.id::TEXT,
        v_reason, jsonb_build_object('subscription_id', v_sub.id, 'plan_id', v_sub.plan_id));
END $$;

-- A payment that came outside Xendit (a bank transfer, GCash to the owner): the
-- same transition as a PAID callback for the invoiced amount. Audited when it
-- applies; an invoice already paid, or expired by a replacement, is reported
-- with applied false and nothing changes. An invoice of a revoked subscription
-- is refused.
CREATE OR REPLACE FUNCTION public.billing_mark_paid(
    p_actor UUID, p_invoice_id UUID, p_channel TEXT, p_note TEXT, p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_reason TEXT := public.billing_text(p_reason, 'The reason', 300);
    v_note TEXT := public.billing_text(p_note, 'The note', 500);
    v_channel TEXT := public.billing_text(p_channel, 'The payment channel', 40);
    v_amount BIGINT;
    v_subscription UUID;
    v_revoked BOOLEAN;
    v_result JSONB;
BEGIN
    IF v_reason IS NULL THEN
        RAISE EXCEPTION 'Give a reason for marking this invoice paid.' USING ERRCODE = 'P0001';
    END IF;
    SELECT i.amount_centavos, i.subscription_id, s.revoked_at IS NOT NULL
    INTO v_amount, v_subscription, v_revoked
    FROM public.billing_invoices i
    JOIN public.billing_subscriptions s ON s.id = i.subscription_id
    WHERE i.id = p_invoice_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That invoice doesn''t exist.' USING ERRCODE = 'P0001';
    END IF;
    IF v_revoked THEN
        RAISE EXCEPTION 'This invoice''s plan was revoked, so it can''t be marked paid. Refund the payment instead.'
            USING ERRCODE = 'P0001';
    END IF;
    v_result := public.billing_settle_invoice(
        p_invoice_id, 'PAID', v_amount, now(), 'manual:' || coalesce(v_channel, 'other'),
        jsonb_build_object('manual', true, 'note', v_note, 'by', p_actor), NULL);
    IF (v_result ->> 'applied')::BOOLEAN THEN
        PERFORM public.billing_audit(p_actor, 'billing.marked_paid', 'invoice', p_invoice_id::TEXT,
            v_reason, jsonb_build_object('invoice_id', p_invoice_id,
                                         'subscription_id', v_subscription));
    END IF;
    RETURN v_result;
END $$;

-- ---------------------------------------------------------------- Privileges

-- Everything is the server key's; the household functions are also the
-- signed-in household's (they check auth.uid() themselves).
DO $$
DECLARE
    f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.billing_audit(UUID, TEXT, TEXT, TEXT, TEXT, JSONB)',
        'public.billing_manages(UUID, UUID)',
        'public.billing_can_manage(UUID, UUID)',
        'public.billing_period_end(TIMESTAMPTZ, TEXT)',
        'public.billing_peso(BIGINT)',
        'public.billing_add_note(TEXT, TEXT)',
        'public.billing_text(TEXT, TEXT, INT)',
        'public.billing_check_seats(INT, INT)',
        'public.billing_next_invoice_number()',
        'public.billing_price(public.billing_plans, INT, INT, INT)',
        'public.billing_new_invoice(UUID, TIMESTAMPTZ, JSONB)',
        'public.billing_settle_invoice(UUID, TEXT, BIGINT, TIMESTAMPTZ, TEXT, JSONB, TEXT)',
        'public.billing_entitlements(UUID, TIMESTAMPTZ)',
        'public.billing_usage(UUID)',
        'public.billing_quote(UUID, INT, INT, UUID[])',
        'public.billing_trial_eligible(UUID, UUID[])',
        'public.billing_start(UUID, INT, INT, UUID[])',
        'public.billing_attach_session(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT)',
        'public.billing_renew(UUID)',
        'public.billing_cancel(UUID)',
        'public.billing_household_entitlements(UUID)',
        'public.billing_my_billing(UUID)',
        'public.billing_record_invoice_result(TEXT, TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, JSONB)',
        'public.billing_household_detail(UUID, UUID, TIMESTAMPTZ)',
        'public.billing_invoice_detail(UUID, UUID)',
        'public.billing_grant(UUID, UUID, UUID, INT, INT, TIMESTAMPTZ, TEXT, TEXT)',
        'public.billing_mark_paid(UUID, UUID, TEXT, TEXT, TEXT)',
        'public.billing_revoke(UUID, UUID, TEXT)'
    ] LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION
    public.billing_quote(UUID, INT, INT, UUID[]),
    public.billing_trial_eligible(UUID, UUID[]),
    public.billing_start(UUID, INT, INT, UUID[]),
    public.billing_attach_session(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT),
    public.billing_renew(UUID),
    public.billing_cancel(UUID),
    public.billing_household_entitlements(UUID),
    public.billing_my_billing(UUID)
    TO authenticated;

COMMIT;
