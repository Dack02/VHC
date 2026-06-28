-- Add VehicleDetails (paid DVLA) lookup usage + cost to the super-admin Usage
-- aggregations. Extends admin_usage_by_org and admin_usage_totals with three
-- new measures sourced from vehicle_data_lookups (20260628130000):
--   vehicle_lookups        — all lookups in the window
--   vehicle_lookups_billed — lookups that actually billed (billed = true)
--   vehicle_lookup_cost    — sum of our real cost (transactionCost, GBP)
-- Billable/sell price is applied in the API (flat platform price), not here.
--
-- Both functions return TABLE(...); adding columns needs DROP + CREATE (CREATE OR
-- REPLACE cannot change the return signature). admin_usage_totals references
-- admin_usage_by_org columns by name in an opaque SQL body, so the drop order is
-- safe. See docs/vehicle-details-billing-plan.md.

DROP FUNCTION IF EXISTS admin_usage_totals(date, date);
DROP FUNCTION IF EXISTS admin_usage_by_org(date, date);

CREATE FUNCTION admin_usage_by_org(p_from date, p_to date)
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
  ai_cost_usd numeric,
  vehicle_lookups bigint,
  vehicle_lookups_billed bigint,
  vehicle_lookup_cost numeric
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
  -- Live storage: sum real object sizes in the vhc-photos bucket per org.
  -- Current gauge — deliberately not windowed by [p_from, p_to].
  storage AS (
    SELECT (split_part(obj.name, '/', 1))::uuid       AS organization_id,
           SUM((obj.metadata->>'size')::bigint)       AS storage_used_bytes
    FROM storage.objects obj
    WHERE obj.bucket_id = 'vhc-photos'
      AND obj.metadata ? 'size'
      AND split_part(obj.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    GROUP BY 1
  ),
  ai AS (
    SELECT l.organization_id,
           COUNT(*)                           AS ai_generations,
           COALESCE(SUM(l.total_cost_usd), 0) AS ai_cost_usd
    FROM ai_usage_logs l
    WHERE l.created_at >= p_from::timestamptz
      AND l.created_at <  (p_to + 1)::timestamptz
    GROUP BY l.organization_id
  ),
  vdl AS (
    SELECT v.organization_id,
           COUNT(*)                                  AS vehicle_lookups,
           COUNT(*) FILTER (WHERE v.billed)          AS vehicle_lookups_billed,
           COALESCE(SUM(v.cost), 0)                  AS vehicle_lookup_cost
    FROM vehicle_data_lookups v
    WHERE v.created_at >= p_from::timestamptz
      AND v.created_at <  (p_to + 1)::timestamptz
      AND v.organization_id IS NOT NULL
    GROUP BY v.organization_id
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
         COALESCE(a.ai_cost_usd, 0)::numeric,
         COALESCE(v.vehicle_lookups, 0)::bigint,
         COALESCE(v.vehicle_lookups_billed, 0)::bigint,
         COALESCE(v.vehicle_lookup_cost, 0)::numeric
  FROM organizations o
  LEFT JOIN comms   c  ON c.organization_id = o.id
  LEFT JOIN hc      hc ON hc.organization_id = o.id
  LEFT JOIN storage s  ON s.organization_id = o.id
  LEFT JOIN ai      a  ON a.organization_id = o.id
  LEFT JOIN vdl     v  ON v.organization_id = o.id
  WHERE o.status <> 'cancelled';
$$;

CREATE FUNCTION admin_usage_totals(p_from date, p_to date)
RETURNS TABLE(
  sms_sent bigint,
  emails_sent bigint,
  health_checks_created bigint,
  health_checks_completed bigint,
  ai_generations bigint,
  ai_cost_usd numeric,
  vehicle_lookups bigint,
  vehicle_lookups_billed bigint,
  vehicle_lookup_cost numeric,
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
    COALESCE(SUM(vehicle_lookups), 0)::bigint,
    COALESCE(SUM(vehicle_lookups_billed), 0)::bigint,
    COALESCE(SUM(vehicle_lookup_cost), 0)::numeric,
    COUNT(*) FILTER (WHERE status = 'active')::bigint
  FROM admin_usage_by_org(p_from, p_to);
$$;

REVOKE ALL ON FUNCTION admin_usage_by_org(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_usage_totals(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_usage_by_org(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION admin_usage_totals(date, date) TO service_role;
