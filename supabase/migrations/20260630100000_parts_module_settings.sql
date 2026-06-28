-- =============================================================================
-- Parts module — per-org settings (GMS/PARTS.md decision 0 + §5.10 period lock)
-- =============================================================================
-- Additive only. parts_mode forks the inventory mechanics:
--   simple = no stock tracking; parts → P&L direct cost at purchase (default,
--            and the only option for VHC-only plans).
--   full   = perpetual stock + balance sheet (requires the `parts_stock` module).
-- The API coerces parts_mode -> 'simple' whenever the parts_stock module is off.
-- books_locked_through is the accounting period lock for the journal writer.
-- =============================================================================

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS parts_mode TEXT NOT NULL DEFAULT 'simple'
    CHECK (parts_mode IN ('simple', 'full'));

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS books_locked_through DATE;

COMMENT ON COLUMN organization_settings.parts_mode IS
  'Parts module mode: simple = no stock, parts->P&L direct cost at purchase; full = perpetual stock. Coerced to simple unless the parts_stock module is enabled. (GMS/PARTS.md decision 0)';
COMMENT ON COLUMN organization_settings.books_locked_through IS
  'Accounting period lock: journals dated <= this date post to the current open period instead of back-posting into a closed month (GMS/PARTS.md §5.10).';
