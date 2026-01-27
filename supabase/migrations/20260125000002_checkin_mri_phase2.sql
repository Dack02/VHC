-- ============================================================================
-- Check-In & MRI Scan Feature - Phase 2: Organisation Settings & MRI Tables
-- Creates organisation_checkin_settings, mri_items, and mri_scan_results tables
-- ============================================================================

-- ============================================================================
-- Organisation Check-In Settings Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS organization_checkin_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Feature toggle
    checkin_enabled BOOLEAN DEFAULT FALSE,

    -- Optional field visibility settings
    show_mileage_in BOOLEAN DEFAULT TRUE,
    show_time_required BOOLEAN DEFAULT TRUE,
    show_key_location BOOLEAN DEFAULT TRUE,

    -- Check-in timeout threshold (minutes)
    checkin_timeout_minutes INTEGER DEFAULT 20,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT organization_checkin_settings_org_unique UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS idx_org_checkin_settings_org
    ON organization_checkin_settings(organization_id);

COMMENT ON TABLE organization_checkin_settings IS 'Per-organization settings for the Check-In feature';
COMMENT ON COLUMN organization_checkin_settings.checkin_enabled IS 'When true, vehicles must complete check-in before being assigned to a technician';
COMMENT ON COLUMN organization_checkin_settings.checkin_timeout_minutes IS 'Alert threshold for vehicles waiting in check-in status';

-- ============================================================================
-- MRI Items Configuration Table
-- Stores the configurable MRI checklist items per organisation
-- ============================================================================
CREATE TABLE IF NOT EXISTS mri_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Item details
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'Other',  -- e.g., 'Service Items', 'Safety & Compliance', 'Other'
    item_type TEXT NOT NULL CHECK (item_type IN ('date_mileage', 'yes_no')),

    -- RAG configuration for date_mileage items
    severity_when_due TEXT CHECK (severity_when_due IN ('red', 'amber', 'green')),

    -- RAG configuration for yes_no items
    severity_when_yes TEXT CHECK (severity_when_yes IN ('red', 'amber', 'green')),
    severity_when_no TEXT CHECK (severity_when_no IN ('red', 'amber', 'green')),

    -- For informational items (no RAG status, just record)
    is_informational BOOLEAN DEFAULT FALSE,

    -- Settings
    enabled BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,

    -- Track if this is a default item (vs custom)
    is_default BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mri_items_org ON mri_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_mri_items_org_enabled ON mri_items(organization_id) WHERE enabled = TRUE;

COMMENT ON TABLE mri_items IS 'Configurable MRI (Manufacturer Recommended Items) checklist items per organisation';
COMMENT ON COLUMN mri_items.item_type IS 'date_mileage = items with due date/mileage tracking, yes_no = binary status checks';
COMMENT ON COLUMN mri_items.severity_when_due IS 'RAG status to assign when date_mileage item is due';
COMMENT ON COLUMN mri_items.is_informational IS 'When true, item is recorded but does not generate RAG status';

-- ============================================================================
-- MRI Scan Results Table
-- Stores the results of MRI scans for each health check
-- ============================================================================
CREATE TABLE IF NOT EXISTS mri_scan_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
    mri_item_id UUID NOT NULL REFERENCES mri_items(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    -- Type A: Date/Mileage items
    next_due_date DATE,
    next_due_mileage INTEGER,
    due_if_not_replaced BOOLEAN DEFAULT FALSE,

    -- Type B: Yes/No items
    yes_no_value BOOLEAN,

    -- Common fields
    notes TEXT,
    rag_status TEXT CHECK (rag_status IN ('red', 'amber', 'green')),

    -- Link to auto-created repair item (if flagged)
    repair_item_id UUID,  -- Will be set when repair item is auto-created

    -- Tracking
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES users(id),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure one result per MRI item per health check
    CONSTRAINT mri_scan_results_unique UNIQUE (health_check_id, mri_item_id)
);

CREATE INDEX IF NOT EXISTS idx_mri_results_health_check ON mri_scan_results(health_check_id);
CREATE INDEX IF NOT EXISTS idx_mri_results_org ON mri_scan_results(organization_id);

COMMENT ON TABLE mri_scan_results IS 'Stores MRI scan results for each health check';
COMMENT ON COLUMN mri_scan_results.due_if_not_replaced IS 'For date_mileage items: checked when item is due if not already replaced';
COMMENT ON COLUMN mri_scan_results.repair_item_id IS 'Reference to auto-created repair item when MRI item is flagged';

-- ============================================================================
-- Add source column to repair_items table for tracking item origin
-- ============================================================================
ALTER TABLE repair_items
    ADD COLUMN IF NOT EXISTS source TEXT;

COMMENT ON COLUMN repair_items.source IS 'Origin of repair item: inspection, mri_scan, manual, dms_prebooked';

-- Create index for filtering by source
CREATE INDEX IF NOT EXISTS idx_repair_items_source ON repair_items(source) WHERE source IS NOT NULL;

-- ============================================================================
-- Enable RLS on new tables
-- ============================================================================
ALTER TABLE organization_checkin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mri_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE mri_scan_results ENABLE ROW LEVEL SECURITY;

-- RLS Policies (drop first to make idempotent)
DROP POLICY IF EXISTS org_isolation ON organization_checkin_settings;
CREATE POLICY org_isolation ON organization_checkin_settings
    FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS org_isolation ON mri_items;
CREATE POLICY org_isolation ON mri_items
    FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);

DROP POLICY IF EXISTS org_isolation ON mri_scan_results;
CREATE POLICY org_isolation ON mri_scan_results
    FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);
