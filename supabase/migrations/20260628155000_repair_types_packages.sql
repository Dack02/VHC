-- =============================================================================
-- Repair Types — Phase 2.5 (Service packages under the labour lock)
--
-- Under the lock, a work group's labour rate derives from its Repair Type (→ default
-- labour code), so a service package no longer needs a per-line labour code — it
-- carries ONE default_repair_type_id (added in 20260628130000). On apply, the group
-- is stamped with that type and the rate is resolved server-side.
--
-- This migration:
--   1. Relaxes service_package_labour.labour_code_id to NULLable (new lines need no code).
--   2. Backfills service_packages.default_repair_type_id from each package's DOMINANT
--      labour code — but ONLY for single-VAT packages (all-exempt or all-liable). Mixed-VAT
--      packages (e.g. Service+MOT) are left NULL so an admin splits/retypes them (the
--      builder flags "no repair type"). The labour_code_id column is KEPT (not dropped).
--
-- Safety: additive / nullable only; idempotent; no destructive statements.
-- Deploy via the pipeline (supabase db push), never out-of-band MCP SQL.
-- =============================================================================

-- 1. Allow package labour lines without a labour code (rate comes from the applied group's type).
ALTER TABLE service_package_labour ALTER COLUMN labour_code_id DROP NOT NULL;

-- 2. Heuristic backfill of the package's Repair Type from its dominant labour code (single-VAT only).
WITH dominant AS (
  SELECT DISTINCT ON (spl.service_package_id)
         spl.service_package_id,
         spl.labour_code_id
  FROM service_package_labour spl
  WHERE spl.labour_code_id IS NOT NULL
  GROUP BY spl.service_package_id, spl.labour_code_id
  ORDER BY spl.service_package_id, COUNT(*) DESC
),
single_vat AS (
  SELECT service_package_id
  FROM service_package_labour
  GROUP BY service_package_id
  HAVING bool_and(is_vat_exempt) OR bool_and(NOT is_vat_exempt)
),
mapped AS (
  SELECT DISTINCT ON (d.service_package_id)
         d.service_package_id,
         rt.id AS repair_type_id
  FROM dominant d
  JOIN single_vat sv ON sv.service_package_id = d.service_package_id
  JOIN service_packages sp ON sp.id = d.service_package_id
  JOIN repair_types rt
    ON rt.organization_id = sp.organization_id
   AND rt.default_labour_code_id = d.labour_code_id
   AND rt.is_active = true
  ORDER BY d.service_package_id, rt.sort_order
)
UPDATE service_packages sp
SET default_repair_type_id = m.repair_type_id
FROM mapped m
WHERE sp.id = m.service_package_id
  AND sp.default_repair_type_id IS NULL;
