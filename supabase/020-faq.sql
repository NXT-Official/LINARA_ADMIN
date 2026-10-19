-- LINARA_ADMIN, Phase 8 — FAQs. Apply after 015.
--
-- Apply by hand in the Supabase SQL editor: linara dev first. One transaction,
-- safe to apply twice. The Help page's questions live here: staff write them
-- through the console, the public site reads the published ones.
-- Exception to the service-role-only rule: faq_public_list() is GRANTed to anon
-- and authenticated (the public site reads it). Every staff function is for the
-- server key only, takes p_actor first, and audits in the same transaction
-- with ids only. Nothing here touches a main-app table.

BEGIN;

-- ---------------------------------------------------------------- Table

CREATE TABLE IF NOT EXISTS public.faq_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question    TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 200),
    answer      TEXT NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 4000),
    category    TEXT NOT NULL DEFAULT 'General' CHECK (char_length(category) BETWEEN 1 AND 40),
    sort_order  INT NOT NULL DEFAULT 0,
    published   BOOLEAN NOT NULL DEFAULT false,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID
);
CREATE INDEX IF NOT EXISTS faq_entries_listing_idx
    ON public.faq_entries (published, category, sort_order);

ALTER TABLE public.faq_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.faq_entries FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.faq_touch() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS faq_entries_touch ON public.faq_entries;
CREATE TRIGGER faq_entries_touch BEFORE UPDATE ON public.faq_entries
    FOR EACH ROW EXECUTE FUNCTION public.faq_touch();

-- ---------------------------------------------------------------- Audit

CREATE OR REPLACE FUNCTION public.faq_audit(
    p_actor UUID, p_action TEXT, p_entry UUID, p_metadata JSONB
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
    INSERT INTO public.staff_audit_log (actor_user_id, action, target_type, target_id, metadata)
    VALUES (p_actor, p_action, 'faq', p_entry::TEXT, coalesce(p_metadata, '{}'::JSONB))
$$;

-- ---------------------------------------------------------------- Reads

-- What the public site shows: published entries only.
CREATE OR REPLACE FUNCTION public.faq_public_list() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', f.id, 'question', f.question, 'answer', f.answer,
               'category', f.category, 'sort_order', f.sort_order)
           ORDER BY f.category, f.sort_order, f.question), '[]'::JSONB)
    FROM public.faq_entries f
    WHERE f.published
$$;

-- Every entry, drafts included, for the console.
CREATE OR REPLACE FUNCTION public.faq_list(p_actor UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', f.id, 'question', f.question, 'answer', f.answer,
               'category', f.category, 'sort_order', f.sort_order,
               'published', f.published, 'updated_at', f.updated_at)
           ORDER BY f.category, f.sort_order, f.question), '[]'::JSONB)
    FROM public.faq_entries f
$$;

-- ---------------------------------------------------------------- Writes

-- Inserts when p_entry has no id, otherwise updates that entry.
CREATE OR REPLACE FUNCTION public.faq_save(p_actor UUID, p_entry JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_id UUID;
    v_question TEXT;
    v_answer TEXT;
    v_category TEXT;
    v_sort INT;
    v_published BOOLEAN;
BEGIN
    IF p_entry IS NULL OR jsonb_typeof(p_entry) <> 'object' THEN
        RAISE EXCEPTION 'Send the question as an object.' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_typeof(p_entry -> 'question') IS DISTINCT FROM 'string'
       OR char_length(btrim(p_entry ->> 'question')) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'The question must be 1 to 200 characters.' USING ERRCODE = 'P0001';
    END IF;
    IF jsonb_typeof(p_entry -> 'answer') IS DISTINCT FROM 'string'
       OR char_length(btrim(p_entry ->> 'answer')) NOT BETWEEN 1 AND 4000 THEN
        RAISE EXCEPTION 'The answer must be 1 to 4000 characters.' USING ERRCODE = 'P0001';
    END IF;
    IF p_entry ? 'category' AND jsonb_typeof(p_entry -> 'category') <> 'null'
       AND (jsonb_typeof(p_entry -> 'category') <> 'string'
            OR char_length(btrim(p_entry ->> 'category')) NOT BETWEEN 1 AND 40) THEN
        RAISE EXCEPTION 'The category must be 1 to 40 characters.' USING ERRCODE = 'P0001';
    END IF;
    IF p_entry ? 'sort_order' AND jsonb_typeof(p_entry -> 'sort_order') <> 'null'
       AND (jsonb_typeof(p_entry -> 'sort_order') <> 'number'
            OR (p_entry ->> 'sort_order') !~ '^-?\d{1,9}$') THEN
        RAISE EXCEPTION 'The order must be a whole number.' USING ERRCODE = 'P0001';
    END IF;
    IF p_entry ? 'published' AND jsonb_typeof(p_entry -> 'published') NOT IN ('boolean', 'null') THEN
        RAISE EXCEPTION 'Published must be true or false.' USING ERRCODE = 'P0001';
    END IF;
    IF p_entry ? 'id' AND jsonb_typeof(p_entry -> 'id') <> 'null'
       AND (jsonb_typeof(p_entry -> 'id') <> 'string'
            OR (p_entry ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
        RAISE EXCEPTION 'That question id isn''t valid.' USING ERRCODE = 'P0001';
    END IF;

    v_question := btrim(p_entry ->> 'question');
    v_answer := btrim(p_entry ->> 'answer');
    v_category := coalesce(btrim(p_entry ->> 'category'), 'General');
    v_sort := coalesce((p_entry ->> 'sort_order')::INT, 0);
    v_published := coalesce((p_entry ->> 'published')::BOOLEAN, false);

    IF p_entry ->> 'id' IS NULL THEN
        INSERT INTO public.faq_entries (question, answer, category, sort_order, published, updated_by)
        VALUES (v_question, v_answer, v_category, v_sort, v_published, p_actor)
        RETURNING id INTO v_id;
    ELSE
        v_id := (p_entry ->> 'id')::UUID;
        PERFORM 1 FROM public.faq_entries WHERE id = v_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'That question doesn''t exist.' USING ERRCODE = 'P0001';
        END IF;
        UPDATE public.faq_entries
        SET question = v_question, answer = v_answer, category = v_category,
            sort_order = v_sort, published = v_published, updated_by = p_actor
        WHERE id = v_id;
    END IF;
    PERFORM public.faq_audit(p_actor, 'faq.saved', v_id,
        jsonb_build_object('published', v_published));
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.faq_delete(p_actor UUID, p_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM 1 FROM public.faq_entries WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That question doesn''t exist.' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.faq_entries WHERE id = p_id;
    PERFORM public.faq_audit(p_actor, 'faq.deleted', p_id, '{}'::JSONB);
END $$;

-- ---------------------------------------------------------------- Privileges

REVOKE EXECUTE ON FUNCTION
    public.faq_touch(),
    public.faq_audit(UUID, TEXT, UUID, JSONB),
    public.faq_public_list(),
    public.faq_list(UUID),
    public.faq_save(UUID, JSONB),
    public.faq_delete(UUID, UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
    public.faq_audit(UUID, TEXT, UUID, JSONB),
    public.faq_list(UUID),
    public.faq_save(UUID, JSONB),
    public.faq_delete(UUID, UUID)
TO service_role;

GRANT EXECUTE ON FUNCTION public.faq_public_list() TO anon, authenticated, service_role;

COMMIT;
