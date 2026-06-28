-- =============================================================================
-- Parts module P0 — parts_catalog extended into the item master (GMS/PARTS.md §5.2)
-- =============================================================================
-- Additive ALTER ... ADD COLUMN IF NOT EXISTS only. The existing (org, part_number)
-- UNIQUE + autocomplete keep working untouched. qty_on_hand / average_cost are
-- DERIVED CACHES — only stock_movements (via apply_stock_movement) may change them.
-- =============================================================================

ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES part_categories(id) ON DELETE SET NULL;
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS is_stocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS unit_of_measure VARCHAR(20) NOT NULL DEFAULT 'each';
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS sell_price DECIMAL(10,2);
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS sell_price_override DECIMAL(10,2);
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS qty_on_hand DECIMAL(12,3) NOT NULL DEFAULT 0;
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS average_cost DECIMAL(12,4) NOT NULL DEFAULT 0;
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS min_qty DECIMAL(12,3);
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS max_qty DECIMAL(12,3);
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS bin_location VARCHAR(50);
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS preferred_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS vat_code VARCHAR(20) NOT NULL DEFAULT 'STD_20';
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS tyre_size VARCHAR(30);
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS barcode VARCHAR(64);
ALTER TABLE parts_catalog ADD COLUMN IF NOT EXISTS superseded_by_id UUID REFERENCES parts_catalog(id) ON DELETE SET NULL;

COMMENT ON COLUMN parts_catalog.is_stocked IS 'The fork: false = order-in/non-stock (default); true = perpetual stock item (GMS/PARTS.md §5.2).';
COMMENT ON COLUMN parts_catalog.qty_on_hand IS 'DERIVED CACHE — only stock_movements (apply_stock_movement) may change it (GMS/PARTS.md §5.4 invariant).';
COMMENT ON COLUMN parts_catalog.average_cost IS 'WAVCO rolling average (provisional at receipt). Valuation = stored movement total_cost, not qty_on_hand × average_cost.';

CREATE INDEX IF NOT EXISTS idx_parts_catalog_category ON parts_catalog(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parts_catalog_stocked  ON parts_catalog(organization_id, is_stocked) WHERE is_stocked = true;
CREATE INDEX IF NOT EXISTS idx_parts_catalog_pref_sup ON parts_catalog(preferred_supplier_id) WHERE preferred_supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parts_catalog_barcode  ON parts_catalog(organization_id, barcode) WHERE barcode IS NOT NULL;
-- Low-stock: stocked items at/under their reorder point
CREATE INDEX IF NOT EXISTS idx_parts_catalog_low_stock ON parts_catalog(organization_id) WHERE is_stocked = true AND min_qty IS NOT NULL;
