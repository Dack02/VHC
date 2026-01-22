-- VHC Reference Number Implementation
-- Adds unique sequential reference numbers (format "VHC00001") to health checks

-- 1. Add vhc_reference column to health_checks table
ALTER TABLE health_checks
ADD COLUMN IF NOT EXISTS vhc_reference VARCHAR(20);

-- 2. Add next_vhc_number to organization_settings for tracking counters per org
ALTER TABLE organization_settings
ADD COLUMN IF NOT EXISTS next_vhc_number INTEGER DEFAULT 1;

-- 3. Create unique constraint on vhc_reference per organization
ALTER TABLE health_checks
ADD CONSTRAINT health_checks_org_vhc_reference_unique
UNIQUE (organization_id, vhc_reference);

-- 4. Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_health_checks_vhc_reference
ON health_checks(organization_id, vhc_reference);

-- 5. Create the trigger function to auto-generate vhc_reference
CREATE OR REPLACE FUNCTION generate_vhc_reference()
RETURNS TRIGGER AS $$
DECLARE
  v_next_number INTEGER;
BEGIN
  -- Only generate if vhc_reference is null (not already set)
  IF NEW.vhc_reference IS NULL THEN
    -- Atomically get and increment the counter for this organization
    UPDATE organization_settings
    SET next_vhc_number = next_vhc_number + 1,
        updated_at = NOW()
    WHERE organization_id = NEW.organization_id
    RETURNING next_vhc_number - 1 INTO v_next_number;

    -- If no organization_settings row exists, create one
    IF v_next_number IS NULL THEN
      INSERT INTO organization_settings (organization_id, next_vhc_number, created_at, updated_at)
      VALUES (NEW.organization_id, 2, NOW(), NOW())
      ON CONFLICT (organization_id) DO UPDATE
      SET next_vhc_number = organization_settings.next_vhc_number + 1,
          updated_at = NOW()
      RETURNING next_vhc_number - 1 INTO v_next_number;
    END IF;

    -- Format as VHC + 5-digit padded number
    NEW.vhc_reference := 'VHC' || LPAD(v_next_number::TEXT, 5, '0');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Create the trigger
DROP TRIGGER IF EXISTS trg_generate_vhc_reference ON health_checks;
CREATE TRIGGER trg_generate_vhc_reference
BEFORE INSERT ON health_checks
FOR EACH ROW
EXECUTE FUNCTION generate_vhc_reference();

-- 7. Backfill existing health checks with VHC references
-- Group by organization and assign sequential numbers based on created_at order
DO $$
DECLARE
  v_org_id UUID;
  v_hc RECORD;
  v_counter INTEGER;
BEGIN
  -- Process each organization
  FOR v_org_id IN SELECT DISTINCT organization_id FROM health_checks WHERE vhc_reference IS NULL
  LOOP
    v_counter := 1;

    -- Update each health check in order of creation
    FOR v_hc IN
      SELECT id
      FROM health_checks
      WHERE organization_id = v_org_id
        AND vhc_reference IS NULL
      ORDER BY created_at ASC
    LOOP
      UPDATE health_checks
      SET vhc_reference = 'VHC' || LPAD(v_counter::TEXT, 5, '0')
      WHERE id = v_hc.id;

      v_counter := v_counter + 1;
    END LOOP;

    -- Update the organization's next_vhc_number counter
    INSERT INTO organization_settings (organization_id, next_vhc_number, created_at, updated_at)
    VALUES (v_org_id, v_counter, NOW(), NOW())
    ON CONFLICT (organization_id) DO UPDATE
    SET next_vhc_number = GREATEST(organization_settings.next_vhc_number, v_counter),
        updated_at = NOW();
  END LOOP;
END $$;

-- 8. Add comment for documentation
COMMENT ON COLUMN health_checks.vhc_reference IS 'Unique sequential reference number per organization, format VHC00001';
COMMENT ON COLUMN organization_settings.next_vhc_number IS 'Next VHC reference number to assign for this organization';
