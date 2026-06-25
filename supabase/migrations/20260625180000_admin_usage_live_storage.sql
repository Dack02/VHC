-- =============================================================================
-- Fix the super-admin Usage "Storage" column reading 0.00 GB for every org.
--
-- Previously admin_usage_by_org sourced storage_used_bytes from the
-- organization_usage rollup. That counter is never maintained (incrementStorageUsage()
-- exists in the API but is never called), so it sits at its DEFAULT 0 forever even
-- though orgs have tens of MB of real inspection photos in the vhc-photos bucket.
--
-- This redefines the storage CTE to sum the ACTUAL object sizes from
-- storage.objects (bucket 'vhc-photos'), attributed to the org via the first
-- path segment (paths are `{org_id}/{health_check_id}/{result_id}/{ts}.jpg`).
-- Storage is a current point-in-time gauge, so it is intentionally NOT filtered
-- by the [p_from, p_to] window — it always reflects what the bucket holds now.
-- This needs no backfill and fixes historical orgs immediately.
--
-- Only admin_usage_by_org changes; admin_usage_totals sums it and inherits the fix.
-- =============================================================================

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

-- Preserve the service_role-only lockdown (CREATE OR REPLACE keeps grants, but be explicit).
REVOKE ALL ON FUNCTION admin_usage_by_org(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_usage_by_org(date, date) TO service_role;

-- NB: no index added on storage.objects — that table is owned by
-- supabase_storage_admin and the migration role cannot create indexes on it.
-- The per-org path-prefix scan over the vhc-photos bucket is cheap at current
-- volumes (hundreds of objects). Revisit if the bucket grows very large.
