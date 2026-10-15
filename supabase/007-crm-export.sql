-- LINARA_ADMIN, Phase 3b review fix. Apply after 006-crm-data.sql.
-- Spec: docs/specs/2026-10-13-linara-admin-design.md FR-CRM-11.
--
-- The export with contact details read crm_list_contacts through the API,
-- which returns at most "Max rows" table rows (1,000 by default): a larger
-- export came back shorter with no sign of it. This function returns one JSON
-- value holding the rows and the true total, so the console can refuse a file
-- that doesn't match its count. Adds one function; no table changes.

BEGIN;

CREATE FUNCTION public.crm_export_contacts(
    p_search TEXT, p_kind TEXT, p_stage TEXT, p_owner UUID, p_tag TEXT, p_role TEXT,
    p_due TEXT, p_max INT, p_now TIMESTAMPTZ, p_active_days INT, p_at_risk_days INT
) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH matched AS (
        SELECT c.*
        FROM public.crm_list_contacts(p_search, p_kind, p_stage, p_owner, p_tag, p_role, p_due,
                                      2147483647, 0, p_now, p_active_days, p_at_risk_days)
             WITH ORDINALITY AS c(contact_id, user_id, full_name, email, phone, kind, stage,
                                  source, owner_id, tags, roles, household_count,
                                  next_follow_up_at, created_at, n)
    )
    SELECT jsonb_build_object(
        'total', (SELECT count(*)::INT FROM matched),
        'rows', coalesce((
            SELECT jsonb_agg(to_jsonb(m) - 'n' ORDER BY m.n)
            FROM (SELECT * FROM matched ORDER BY n LIMIT p_max) m
        ), '[]'::JSONB)
    )
$$;

REVOKE EXECUTE ON FUNCTION public.crm_export_contacts(
    TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, INT, TIMESTAMPTZ, INT, INT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_export_contacts(
    TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, INT, TIMESTAMPTZ, INT, INT
) TO service_role;

COMMIT;
