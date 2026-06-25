-- =============================================================================
-- Super Admin cross-org usage & communications aggregation RPCs.
-- Server-side aggregation that respects the PostgREST ~1000-row cap. Locked to
-- service_role only (called server-side by super-admin endpoints); NOT exposed
-- to authenticated/anon to prevent cross-tenant reads.
-- =============================================================================

-- Per-org usage rollup for an arbitrary [p_from, p_to] window.
-- Counts SMS/email "sent" from communication_logs (the reliable per-message
-- audit; status sent/delivered/bounced = successfully dispatched, excludes
-- failed/pending), health-check volume from health_checks, and AI from
-- ai_usage_logs. storage_used_bytes comes from organization_usage (its only
-- home; a point-in-time gauge — latest period in the window via DISTINCT ON).
-- NB: the organization_usage sms_sent/emails_sent/health_checks_* rollup
-- counters are NOT used — they are not consistently maintained.
CREATE OR REPLACE FUNCTION admin_usage_by_org(p_from date, p_to date)
RETURNS TABLE(
  organization_id uuid,
  organization_name text,
  status text,
  sms_sent bigint,
  emails_sent bigint,
  health_checks_created bigint,
  health_checks_completed bigint,
  storage_used_bytes bigint,
  ai_generations bigint,
  ai_cost_usd numeric
)
LANGUAGE sql STABLE AS $$
  WITH comms AS (
    SELECT cl.organization_id,
           COUNT(*) FILTER (WHERE cl.channel = 'sms'   AND cl.status IN ('sent','delivered','bounced')) AS sms_sent,
           COUNT(*) FILTER (WHERE cl.channel = 'email' AND cl.status IN ('sent','delivered','bounced')) AS emails_sent
    FROM communication_logs cl
    WHERE cl.created_at >= p_from::timestamptz AND cl.created_at < (p_to + 1)::timestamptz
    GROUP BY cl.organization_id
  ),
  hc AS (
    SELECT h.organization_id,
           COUNT(*)                                       AS health_checks_created,
           COUNT(*) FILTER (WHERE h.status = 'completed') AS health_checks_completed
    FROM health_checks h
    WHERE h.created_at >= p_from::timestamptz AND h.created_at < (p_to + 1)::timestamptz
    GROUP BY h.organization_id
  ),
  storage AS (
    SELECT DISTINCT ON (ou.organization_id)
           ou.organization_id, ou.storage_used_bytes
    FROM organization_usage ou
    WHERE ou.period_start >= p_from AND ou.period_start <= p_to
    ORDER BY ou.organization_id, ou.period_start DESC
  ),
  ai AS (
    SELECT l.organization_id,
           COUNT(*)                           AS ai_generations,
           COALESCE(SUM(l.total_cost_usd), 0) AS ai_cost_usd
    FROM ai_usage_logs l
    WHERE l.created_at >= p_from::timestamptz
      AND l.created_at <  (p_to + 1)::timestamptz
    GROUP BY l.organization_id
  )
  SELECT o.id,
         o.name,
         o.status,
         COALESCE(c.sms_sent, 0)::bigint,
         COALESCE(c.emails_sent, 0)::bigint,
         COALESCE(hc.health_checks_created, 0)::bigint,
         COALESCE(hc.health_checks_completed, 0)::bigint,
         COALESCE(s.storage_used_bytes, 0)::bigint,
         COALESCE(a.ai_generations, 0)::bigint,
         COALESCE(a.ai_cost_usd, 0)::numeric
  FROM organizations o
  LEFT JOIN comms   c  ON c.organization_id = o.id
  LEFT JOIN hc      hc ON hc.organization_id = o.id
  LEFT JOIN storage s  ON s.organization_id = o.id
  LEFT JOIN ai      a  ON a.organization_id = o.id
  WHERE o.status <> 'cancelled';
$$;

-- Platform-wide totals for the same window (single row), so header cards never
-- fetch raw rows into Node. Aggregates admin_usage_by_org so the header total is
-- ALWAYS exactly the sum of the per-org table (same population: non-cancelled,
-- org-attributed). Unattributed (NULL organization_id) comms are intentionally
-- excluded — they can't belong to any org row.
CREATE OR REPLACE FUNCTION admin_usage_totals(p_from date, p_to date)
RETURNS TABLE(
  sms_sent bigint,
  emails_sent bigint,
  health_checks_created bigint,
  health_checks_completed bigint,
  ai_generations bigint,
  ai_cost_usd numeric,
  active_orgs bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(SUM(sms_sent), 0)::bigint,
    COALESCE(SUM(emails_sent), 0)::bigint,
    COALESCE(SUM(health_checks_created), 0)::bigint,
    COALESCE(SUM(health_checks_completed), 0)::bigint,
    COALESCE(SUM(ai_generations), 0)::bigint,
    COALESCE(SUM(ai_cost_usd), 0)::numeric,
    COUNT(*) FILTER (WHERE status = 'active')::bigint
  FROM admin_usage_by_org(p_from, p_to);
$$;

-- Per-org / per-channel communication delivery quality for a window.
CREATE OR REPLACE FUNCTION admin_comms_delivery(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(
  organization_id uuid,
  organization_name text,
  channel text,
  total bigint,
  delivered bigint,
  failed bigint,
  bounced bigint
)
LANGUAGE sql STABLE AS $$
  SELECT cl.organization_id,
         o.name,
         cl.channel,
         COUNT(*)::bigint,
         COUNT(*) FILTER (WHERE cl.status = 'delivered')::bigint,
         COUNT(*) FILTER (WHERE cl.status = 'failed')::bigint,
         COUNT(*) FILTER (WHERE cl.status = 'bounced')::bigint
  FROM communication_logs cl
  JOIN organizations o ON o.id = cl.organization_id
  WHERE cl.created_at >= p_from AND cl.created_at <= p_to
  GROUP BY cl.organization_id, o.name, cl.channel;
$$;

-- Supporting indexes for the aggregations and the comms-log browser.
CREATE INDEX IF NOT EXISTS idx_ai_usage_org_created  ON ai_usage_logs(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comm_logs_org_created ON communication_logs(organization_id, created_at DESC);

-- Lock down: server-side (service_role) only.
REVOKE ALL ON FUNCTION admin_usage_by_org(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_usage_totals(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_comms_delivery(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_usage_by_org(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION admin_usage_totals(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION admin_comms_delivery(timestamptz, timestamptz) TO service_role;
