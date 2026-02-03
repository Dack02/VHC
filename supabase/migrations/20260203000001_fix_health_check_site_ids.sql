-- Fix: Reassign health checks from inactive (deactivated) sites to the org's current active site.
-- Technicians assigned to the new active site couldn't see DMS-imported health checks
-- because those health checks were still pointing at the old deactivated site.

UPDATE health_checks hc
SET site_id = active_site.id
FROM (
  SELECT s.id, s.organization_id
  FROM sites s
  WHERE s.is_active = true
  ORDER BY s.created_at DESC
  LIMIT 1
) active_site
WHERE hc.site_id IN (
  SELECT id FROM sites WHERE is_active = false
)
AND hc.organization_id = active_site.organization_id;
