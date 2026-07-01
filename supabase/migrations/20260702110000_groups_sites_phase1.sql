-- =============================================================================
-- Groups & Sites — Phase 1: per-site customer/vehicle separation + site branding
-- Plan: GMS/GROUPS_AND_SITES.md §4.1, §4.6, §5.1
--
-- SAFETY: additive only. No data moved or deleted. share_customers_across_sites
-- defaults TRUE (= shared = today's behaviour) so NO existing org changes; new
-- orgs are flipped to separated in provisioning (services/provisioning.ts), and
-- "separated" is only ever honoured when the flag is explicitly FALSE (§4.2/§4.3).
-- =============================================================================

-- 1. Vehicles gain a site dimension (customers already have nullable site_id) ----
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_site ON vehicles(site_id);

-- 2. Per-tenant customer/vehicle sharing toggle --------------------------------
--    DEFAULT true (shared) is the SAFE default: lazily-created settings rows and
--    every existing org stay org-wide; only an explicit FALSE means "separated".
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS share_customers_across_sites BOOLEAN NOT NULL DEFAULT true;

-- 3. Site-level branding (override on org default) -----------------------------
--    sites already has name/address/phone/email/settings; add the branding bits.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS primary_color VARCHAR(9);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS website VARCHAR(255);

-- 4. expiry_campaign_audience — add nullable p_site (backward compatible) -------
--    customers carries site_id, so the site filter rides on the recipient customer.
--    Drop the old 3-arg signature first to avoid an ambiguous overload with the
--    new defaulted 4th arg.
DROP FUNCTION IF EXISTS expiry_campaign_audience(UUID, TEXT, INT);

CREATE OR REPLACE FUNCTION expiry_campaign_audience(
  p_org UUID,
  p_type_code TEXT,
  p_lead_days INT,
  p_site UUID DEFAULT NULL
)
RETURNS TABLE (
  vehicle_id UUID,
  registration TEXT,
  make TEXT,
  model TEXT,
  due_date DATE,
  due_mileage INT,
  recipient_customer_id UUID,
  first_name TEXT,
  last_name TEXT,
  mobile TEXT,
  email TEXT
) LANGUAGE sql STABLE AS $$
  SELECT e.vehicle_id,
         v.registration::text,
         v.make::text,
         v.model::text,
         e.due_date,
         e.due_mileage,
         c.id,
         c.first_name::text,
         c.last_name::text,
         c.mobile::text,
         c.email::text
  FROM vehicle_expiry_dates e
  JOIN vehicles v ON v.id = e.vehicle_id
  JOIN vehicle_customer_links l
    ON l.vehicle_id = v.id AND l.is_reminder_recipient AND l.end_date IS NULL
  JOIN customers c ON c.id = l.customer_id
  WHERE e.organization_id = p_org
    AND e.type_code = p_type_code
    AND e.is_active
    AND e.due_date IS NOT NULL
    AND e.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + (p_lead_days || ' days')::interval
    AND (p_site IS NULL OR c.site_id = p_site)
    AND COALESCE(v.lifecycle_status, 'active') = 'active'
    AND NOT COALESCE(c.contact_opt_out, false)
    AND (e.snoozed_until IS NULL OR e.snoozed_until < NOW())
    AND (v.last_activity_at IS NULL OR v.last_activity_at > NOW() - INTERVAL '2 years')
    AND NOT EXISTS (
      SELECT 1 FROM health_checks hc
      WHERE hc.vehicle_id = v.id
        AND hc.status IN ('awaiting_arrival','awaiting_checkin','created','assigned','in_progress')
        AND hc.created_at > NOW() - INTERVAL '60 days'
    )
  ORDER BY e.due_date ASC;
$$;
