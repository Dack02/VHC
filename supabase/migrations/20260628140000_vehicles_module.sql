-- ============================================================================
-- 20260628140000_vehicles_module.sql
-- Standalone Vehicles module: owner/driver links, vehicle notes, ownership
-- audit, typed expiry dates + org expiry-type config, expiry reminder cases.
-- All additive + idempotent (see .claude/rules/database-safety.md).
-- Complements the MOT (20260616130000) and VehicleDetails (20260628120000)
-- columns already on `vehicles` — does NOT duplicate them.
-- ============================================================================

-- Shared updated_at touch fn (idempotent; used by the tables below).
CREATE OR REPLACE FUNCTION vehicles_set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 0. last_activity_at on vehicles — drives recency suppression for campaigns.
--    Maintained by the service layer on HC create / jobsheet close / MOT sync.
-- ---------------------------------------------------------------------------
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_vehicles_last_activity
  ON vehicles(organization_id, last_activity_at);

-- One-time backfill from existing health-check activity.
UPDATE vehicles v SET last_activity_at = sub.last_at
FROM (SELECT vehicle_id, MAX(created_at) AS last_at FROM health_checks GROUP BY vehicle_id) sub
WHERE sub.vehicle_id = v.id AND v.last_activity_at IS NULL;

-- ---------------------------------------------------------------------------
-- 1. OWNER / DRIVER ROLES (many-to-many). vehicles.customer_id stays the
--    canonical PRIMARY/billing owner, kept in sync by trigger (step 4).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_customer_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id  UUID NOT NULL REFERENCES vehicles(id)  ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner','driver','keeper','fleet_account')),
  is_primary BOOLEAN NOT NULL DEFAULT false,            -- mirrors vehicles.customer_id
  is_reminder_recipient BOOLEAN NOT NULL DEFAULT false, -- who marketing/reminders target
  start_date DATE,
  end_date   DATE,                                      -- NULL = current
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vcl_vehicle_customer_role
  ON vehicle_customer_links(vehicle_id, customer_id, role);
CREATE INDEX IF NOT EXISTS idx_vcl_vehicle  ON vehicle_customer_links(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vcl_customer ON vehicle_customer_links(organization_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_vcl_org      ON vehicle_customer_links(organization_id);
-- At most one CURRENT primary and one CURRENT reminder-recipient per vehicle.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vcl_primary_per_vehicle
  ON vehicle_customer_links(vehicle_id) WHERE is_primary AND end_date IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vcl_reminder_per_vehicle
  ON vehicle_customer_links(vehicle_id) WHERE is_reminder_recipient AND end_date IS NULL;

-- ---------------------------------------------------------------------------
-- 2. VEHICLE NOTES (table, not blob). Multi-author, pinnable, categorised.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'general'
    CHECK (category IN ('general','warning','blocked','internal')),
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_notes_vehicle
  ON vehicle_notes(vehicle_id, is_pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_notes_org ON vehicle_notes(organization_id);
DROP TRIGGER IF EXISTS trg_vehicle_notes_updated_at ON vehicle_notes;
CREATE TRIGGER trg_vehicle_notes_updated_at BEFORE UPDATE ON vehicle_notes
  FOR EACH ROW EXECUTE FUNCTION vehicles_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. OWNERSHIP HISTORY (append-only audit of owner changes).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_ownership_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  from_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  to_customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason VARCHAR(40),  -- sold | new_keeper_detected | data_correction | merge | other
  notes TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voh_vehicle
  ON vehicle_ownership_history(vehicle_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_voh_org ON vehicle_ownership_history(organization_id);

-- ---------------------------------------------------------------------------
-- 4. Mirror vehicles.customer_id from the current PRIMARY link (defence so
--    every legacy read keeps working). Links table is authoritative. Guarded
--    so it only writes when the primary owner actually changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_vehicle_primary_customer() RETURNS TRIGGER AS $$
DECLARE
  v_vehicle UUID := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  v_primary UUID;
BEGIN
  SELECT customer_id INTO v_primary FROM vehicle_customer_links
  WHERE vehicle_id = v_vehicle AND is_primary AND end_date IS NULL
  ORDER BY updated_at DESC LIMIT 1;

  UPDATE vehicles
  SET customer_id = v_primary
  WHERE id = v_vehicle AND customer_id IS DISTINCT FROM v_primary;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vcl_sync_primary ON vehicle_customer_links;
CREATE TRIGGER trg_vcl_sync_primary
  AFTER INSERT OR UPDATE OR DELETE ON vehicle_customer_links
  FOR EACH ROW EXECUTE FUNCTION sync_vehicle_primary_customer();

DROP TRIGGER IF EXISTS trg_vcl_updated_at ON vehicle_customer_links;
CREATE TRIGGER trg_vcl_updated_at BEFORE UPDATE ON vehicle_customer_links
  FOR EACH ROW EXECUTE FUNCTION vehicles_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. BACKFILL existing single-owner FK as an owner link (primary + reminder).
-- ---------------------------------------------------------------------------
INSERT INTO vehicle_customer_links
  (organization_id, vehicle_id, customer_id, role, is_primary, is_reminder_recipient)
SELECT v.organization_id, v.id, v.customer_id, 'owner', true, true
FROM vehicles v
WHERE v.customer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM vehicle_customer_links l
    WHERE l.vehicle_id = v.id AND l.customer_id = v.customer_id AND l.role = 'owner'
  );

-- ---------------------------------------------------------------------------
-- 6. ORG EXPIRY-TYPE CONFIG (tenant-defined; MOT/Service/Road Tax seeded system).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expiry_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,                 -- 'mot' | 'service' | 'road_tax' | <custom slug>
  label VARCHAR(120) NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,  -- system types are non-deletable
  is_mileage_based BOOLEAN NOT NULL DEFAULT false,
  default_interval_months INTEGER,
  default_interval_miles INTEGER,
  default_channel VARCHAR(10) NOT NULL DEFAULT 'sms',  -- sms | email | both
  default_lead_days INTEGER NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_expiry_types_org ON expiry_types(organization_id, is_active);
DROP TRIGGER IF EXISTS trg_expiry_types_updated_at ON expiry_types;
CREATE TRIGGER trg_expiry_types_updated_at BEFORE UPDATE ON expiry_types
  FOR EACH ROW EXECUTE FUNCTION vehicles_set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. PER-VEHICLE TYPED EXPIRY FACT TABLE (the queryable campaign surface).
--    One CURRENT row per (vehicle, type). MOT mirrored here on every sync.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_expiry_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  expiry_type_id UUID REFERENCES expiry_types(id) ON DELETE SET NULL,
  type_code VARCHAR(40) NOT NULL,            -- denormalised for fast filtering
  due_date DATE,                             -- next due (date track)
  due_mileage INTEGER,                       -- next due odometer (service)
  source VARCHAR(20) NOT NULL DEFAULT 'manual', -- dvsa | dvla | computed | manual | dms | service
  is_active BOOLEAN NOT NULL DEFAULT true,   -- false = dismissed for this vehicle
  last_notified_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  notes TEXT,
  computed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vehicle_id, type_code)
);
CREATE INDEX IF NOT EXISTS idx_ved_due
  ON vehicle_expiry_dates(organization_id, type_code, due_date) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_ved_mileage
  ON vehicle_expiry_dates(organization_id, type_code, due_mileage)
  WHERE is_active AND due_mileage IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ved_vehicle ON vehicle_expiry_dates(vehicle_id);
DROP TRIGGER IF EXISTS trg_ved_updated_at ON vehicle_expiry_dates;
CREATE TRIGGER trg_ved_updated_at BEFORE UPDATE ON vehicle_expiry_dates
  FOR EACH ROW EXECUTE FUNCTION vehicles_set_updated_at();

-- ---------------------------------------------------------------------------
-- 8. OPTIONAL mileage history (enables date+mileage service prediction later).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_mileage_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  reading_date DATE NOT NULL,
  mileage INTEGER NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'health_check', -- health_check | mot | dms | manual
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vmr_vehicle
  ON vehicle_mileage_readings(vehicle_id, reading_date DESC);

-- ---------------------------------------------------------------------------
-- 9. EXPIRY CAMPAIGN config — expiry type + which Follow-Up timeline cadence.
--    Reuses follow_up_timelines for cadence/templates; no new sender.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expiry_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expiry_type_id UUID NOT NULL REFERENCES expiry_types(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  timeline_id UUID REFERENCES follow_up_timelines(id),  -- reserved: future multi-step cadence
  channel VARCHAR(10) NOT NULL DEFAULT 'sms',           -- sms | email | both
  message_template TEXT,                                -- single-send body; {{placeholders}}
  lead_days INTEGER NOT NULL DEFAULT 30,
  is_enabled BOOLEAN NOT NULL DEFAULT false,            -- opt-in, like follow_up_enabled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, expiry_type_id)
);
CREATE INDEX IF NOT EXISTS idx_expiry_campaigns_org
  ON expiry_campaigns(organization_id, is_enabled);
DROP TRIGGER IF EXISTS trg_expiry_campaigns_updated_at ON expiry_campaigns;
CREATE TRIGGER trg_expiry_campaigns_updated_at BEFORE UPDATE ON expiry_campaigns
  FOR EACH ROW EXECUTE FUNCTION vehicles_set_updated_at();

-- ---------------------------------------------------------------------------
-- 10. DEDICATED EXPIRY REMINDER CASES (do NOT overload follow_up_cases — that
--     table is health_check_id NOT NULL + UNIQUE(health_check_id), bound to a
--     real HC). This reuses the engine's SEND + SUPPRESS helpers, not its schema.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expiry_reminder_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES expiry_campaigns(id) ON DELETE CASCADE,
  recipient_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  type_code VARCHAR(40) NOT NULL,
  due_date DATE NOT NULL,                    -- the expiry window this case is for
  timeline_id UUID REFERENCES follow_up_timelines(id),
  current_step INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','engaged','booking_found','closed')),
  next_action_at TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  closed_reason VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One open case per (vehicle, type, due window) — prevents re-firing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_erc_open
  ON expiry_reminder_cases(organization_id, vehicle_id, type_code, due_date)
  WHERE status <> 'closed';
CREATE INDEX IF NOT EXISTS idx_erc_due
  ON expiry_reminder_cases(organization_id, status, next_action_at);
DROP TRIGGER IF EXISTS trg_erc_updated_at ON expiry_reminder_cases;
CREATE TRIGGER trg_erc_updated_at BEFORE UPDATE ON expiry_reminder_cases
  FOR EACH ROW EXECUTE FUNCTION vehicles_set_updated_at();

-- ---------------------------------------------------------------------------
-- 11. SEED system expiry types per org (idempotent) + project existing MOT dates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_expiry_types_for_org(p_org UUID) RETURNS VOID AS $$
BEGIN
  INSERT INTO expiry_types
    (organization_id, code, label, is_system, is_mileage_based,
     default_interval_months, default_interval_miles, default_channel, default_lead_days, sort_order)
  VALUES
    (p_org,'mot','MOT',true,false,NULL,NULL,'sms',30,1),
    (p_org,'service','Service',true,true,12,12000,'sms',21,2),
    (p_org,'road_tax','Road Tax (VED)',true,false,12,NULL,'sms',14,3)
  ON CONFLICT (organization_id, code) DO NOTHING;
END; $$ LANGUAGE plpgsql;

DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT id FROM organizations LOOP PERFORM seed_expiry_types_for_org(r.id); END LOOP;
END $$;

-- Project any vehicle that already has an MOT expiry into the fact table
-- (seeding ran above, so the expiry_type_id LEFT JOIN resolves).
INSERT INTO vehicle_expiry_dates
  (organization_id, vehicle_id, type_code, due_date, source, expiry_type_id)
SELECT v.organization_id, v.id, 'mot', v.mot_expiry_date, 'dvsa', et.id
FROM vehicles v
LEFT JOIN expiry_types et
  ON et.organization_id = v.organization_id AND et.code = 'mot'
WHERE v.mot_expiry_date IS NOT NULL
ON CONFLICT (vehicle_id, type_code)
  DO UPDATE SET due_date = EXCLUDED.due_date, source = 'dvsa',
                expiry_type_id = EXCLUDED.expiry_type_id, updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 11b. CAMPAIGN AUDIENCE function — vehicles whose typed expiry falls within the
--      lead window, with the reminder recipient's contact, all suppression
--      applied (lifecycle, opt-out, snooze, recency, already-booked-in). Powers
--      both the audience-count preview and the reminder sweep.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION expiry_campaign_audience(p_org UUID, p_type_code TEXT, p_lead_days INT)
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

-- ---------------------------------------------------------------------------
-- 12. RLS — defence-in-depth ONLY. The Hono API uses the service role and never
--     sets app.current_org_id, so these policies do NOT isolate the app's own
--     traffic; isolation is enforced via explicit .eq('organization_id') in the
--     API (as today). Mirrors the customer_contacts_isolation pattern.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vehicle_customer_links','vehicle_notes','vehicle_ownership_history',
    'expiry_types','vehicle_expiry_dates','vehicle_mileage_readings',
    'expiry_campaigns','expiry_reminder_cases'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='public' AND tablename=t AND policyname=t||'_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL USING (organization_id = current_setting(''app.current_org_id'', true)::uuid)',
        t||'_isolation', t);
    END IF;
  END LOOP;
END $$;
