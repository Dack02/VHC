-- =============================================================================
-- Communications stats accuracy fixes.
--  1. Backfill communication_logs.organization_id from the linked health check
--     (the column was historically left NULL by several send paths, so all the
--     attributed-only super-admin views silently dropped those rows).
--  2. admin_comms_delivery: LEFT JOIN organizations so unattributed sends are no
--     longer hidden, and surface 'sent' / 'pending' buckets. On dev there is no
--     delivery-receipt webhook, so successfully dispatched messages stay at
--     'sent' and must count as dispatched, not be ignored (which read as
--     "100% failed").
--  3. admin_org_usage_history: per-org monthly usage counted live from
--     communication_logs + health_checks. The organization_usage rollup
--     counters are NOT maintained (only its storage_used_bytes is real), so the
--     org "Usage History" table always read 0.
-- Safe: only function DROP/REPLACE + a WHERE-bounded UPDATE. No table drops.
-- =============================================================================

-- 1. Backfill org attribution on existing rows. Every historically-NULL row has
--    a health_check_id, so the org is always recoverable. WHERE-bounded.
UPDATE communication_logs cl
SET organization_id = h.organization_id
FROM health_checks h
WHERE cl.health_check_id = h.id
  AND cl.organization_id IS NULL
  AND h.organization_id IS NOT NULL;

-- 2. Delivery quality incl. unattributed + sent/pending buckets.
--    Return-type changes require DROP then CREATE (CREATE OR REPLACE can't alter
--    the column set of an existing function).
DROP FUNCTION IF EXISTS admin_comms_delivery(timestamptz, timestamptz);
CREATE FUNCTION admin_comms_delivery(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(
  organization_id uuid,
  organization_name text,
  channel text,
  total bigint,
  delivered bigint,
  sent bigint,
  failed bigint,
  bounced bigint,
  pending bigint
)
LANGUAGE sql STABLE AS $$
  SELECT cl.organization_id,
         COALESCE(o.name, 'Unattributed') AS organization_name,
         cl.channel,
         COUNT(*)::bigint,
         COUNT(*) FILTER (WHERE cl.status = 'delivered')::bigint,
         COUNT(*) FILTER (WHERE cl.status = 'sent')::bigint,
         COUNT(*) FILTER (WHERE cl.status = 'failed')::bigint,
         COUNT(*) FILTER (WHERE cl.status = 'bounced')::bigint,
         COUNT(*) FILTER (WHERE cl.status = 'pending')::bigint
  FROM communication_logs cl
  LEFT JOIN organizations o ON o.id = cl.organization_id
  WHERE cl.created_at >= p_from AND cl.created_at <= p_to
  GROUP BY cl.organization_id, COALESCE(o.name, 'Unattributed'), cl.channel;
$$;
REVOKE ALL ON FUNCTION admin_comms_delivery(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_comms_delivery(timestamptz, timestamptz) TO service_role;

-- 3. Per-org monthly usage history, counted live (12 months incl. empty months).
--    Counts SMS/email as dispatched (status sent/delivered/bounced), matching
--    admin_usage_by_org. storage_used_bytes is merged in by the API from
--    organization_usage (its only real column).
CREATE OR REPLACE FUNCTION admin_org_usage_history(p_org uuid, p_from date, p_to date)
RETURNS TABLE(
  period_start date,
  sms_sent bigint,
  emails_sent bigint,
  health_checks_created bigint,
  health_checks_completed bigint
)
LANGUAGE sql STABLE AS $$
  WITH months AS (
    SELECT generate_series(date_trunc('month', p_from::timestamptz),
                           date_trunc('month', p_to::timestamptz),
                           interval '1 month')::date AS m
  ),
  comms AS (
    SELECT date_trunc('month', cl.created_at)::date AS m,
           COUNT(*) FILTER (WHERE cl.channel = 'sms'   AND cl.status IN ('sent','delivered','bounced')) AS sms_sent,
           COUNT(*) FILTER (WHERE cl.channel = 'email' AND cl.status IN ('sent','delivered','bounced')) AS emails_sent
    FROM communication_logs cl
    WHERE cl.organization_id = p_org
      AND cl.created_at >= date_trunc('month', p_from::timestamptz)
      AND cl.created_at <  (date_trunc('month', p_to::timestamptz) + interval '1 month')
    GROUP BY 1
  ),
  hc AS (
    SELECT date_trunc('month', h.created_at)::date AS m,
           COUNT(*)                                       AS health_checks_created,
           COUNT(*) FILTER (WHERE h.status = 'completed') AS health_checks_completed
    FROM health_checks h
    WHERE h.organization_id = p_org
      AND h.created_at >= date_trunc('month', p_from::timestamptz)
      AND h.created_at <  (date_trunc('month', p_to::timestamptz) + interval '1 month')
    GROUP BY 1
  )
  SELECT mo.m,
         COALESCE(c.sms_sent, 0)::bigint,
         COALESCE(c.emails_sent, 0)::bigint,
         COALESCE(hc.health_checks_created, 0)::bigint,
         COALESCE(hc.health_checks_completed, 0)::bigint
  FROM months mo
  LEFT JOIN comms c ON c.m = mo.m
  LEFT JOIN hc      ON hc.m = mo.m
  ORDER BY mo.m DESC;
$$;
REVOKE ALL ON FUNCTION admin_org_usage_history(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_org_usage_history(uuid, date, date) TO service_role;
