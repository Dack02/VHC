-- T-Card Workshop Board
-- Creates tables for the Kanban-style workshop management board

-- ============================================================
-- 1. tcard_statuses — Configurable job statuses per organization
-- ============================================================
CREATE TABLE IF NOT EXISTS tcard_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    name VARCHAR(50) NOT NULL,
    colour VARCHAR(7) NOT NULL,
    icon VARCHAR(50),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tcard_statuses_org ON tcard_statuses(organization_id);

-- ============================================================
-- 2. tcard_board_config — Board configuration per site
-- ============================================================
CREATE TABLE IF NOT EXISTS tcard_board_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    site_id UUID NOT NULL REFERENCES sites(id),
    default_tech_hours DECIMAL(4,1) NOT NULL DEFAULT 8.0,
    show_completed_column BOOLEAN NOT NULL DEFAULT true,
    auto_complete_statuses TEXT[] DEFAULT ARRAY['completed', 'closed', 'archived'],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_tcard_board_config_site ON tcard_board_config(site_id);

-- ============================================================
-- 3. tcard_columns — Technician columns for a site's board
-- ============================================================
CREATE TABLE IF NOT EXISTS tcard_columns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    site_id UUID NOT NULL REFERENCES sites(id),
    technician_id UUID NOT NULL REFERENCES users(id),
    sort_order INTEGER NOT NULL DEFAULT 0,
    available_hours DECIMAL(4,1) NOT NULL DEFAULT 8.0,
    is_visible BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(site_id, technician_id)
);

CREATE INDEX IF NOT EXISTS idx_tcard_columns_site ON tcard_columns(site_id);
CREATE INDEX IF NOT EXISTS idx_tcard_columns_org ON tcard_columns(organization_id);

-- ============================================================
-- 4. tcard_assignments — Card assignments and positions on board
-- ============================================================
CREATE TABLE IF NOT EXISTS tcard_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
    column_type VARCHAR(20) NOT NULL DEFAULT 'due_in',
    technician_id UUID REFERENCES users(id),
    sort_position INTEGER NOT NULL DEFAULT 0,
    tcard_status_id UUID REFERENCES tcard_statuses(id),
    priority VARCHAR(10) DEFAULT 'normal',
    board_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(health_check_id, board_date)
);

CREATE INDEX IF NOT EXISTS idx_tcard_assignments_org ON tcard_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_tcard_assignments_board ON tcard_assignments(board_date, organization_id);
CREATE INDEX IF NOT EXISTS idx_tcard_assignments_hc ON tcard_assignments(health_check_id);
CREATE INDEX IF NOT EXISTS idx_tcard_assignments_tech ON tcard_assignments(technician_id, board_date);

-- ============================================================
-- 5. tcard_notes — Operational notes on job cards
-- ============================================================
CREATE TABLE IF NOT EXISTS tcard_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tcard_notes_hc ON tcard_notes(health_check_id);
CREATE INDEX IF NOT EXISTS idx_tcard_notes_org ON tcard_notes(organization_id);

-- ============================================================
-- 6. RLS Policies
-- ============================================================
ALTER TABLE tcard_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE tcard_board_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tcard_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE tcard_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tcard_notes ENABLE ROW LEVEL SECURITY;

-- Service role bypass (API uses service key)
CREATE POLICY "Service role bypass" ON tcard_statuses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON tcard_board_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON tcard_columns FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON tcard_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON tcard_notes FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 7. Seed default statuses (applied per-org when board is first configured)
-- We'll seed these via the API when an org first accesses the board.
-- No global seed needed since this is multi-tenant.
-- ============================================================
