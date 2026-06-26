-- =============================================================================
-- GMS — Estimates: locked-in AUTHORISED snapshot (audit)
--
-- When a customer finalises their response and authorises work, we capture an
-- IMMUTABLE snapshot of WHAT they authorised and WHEN: `authorised_at` +
-- `authorised_total` (inc-VAT sum of the approved lines at that instant).
--
-- This figure is locked at authorisation and is NEVER recomputed — editing the
-- estimate's lines afterwards does not change it. The advisor timeline reads it
-- straight back, so if the agreed price is ever questioned the exact amount the
-- customer authorised at that time is on record.
--
-- Safety: additive + idempotent (IF NOT EXISTS). No destructive statements.
-- =============================================================================

ALTER TABLE estimates ADD COLUMN IF NOT EXISTS authorised_at TIMESTAMPTZ;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS authorised_total NUMERIC(12,2);

COMMENT ON COLUMN estimates.authorised_at IS
  'When the customer authorised work (response finalised with ≥1 approved line). NULL if never authorised. Immutable once set.';
COMMENT ON COLUMN estimates.authorised_total IS
  'Inc-VAT total of the lines the customer approved, snapshotted AT authorisation. Immutable audit figure — not recomputed when the estimate is later edited.';

-- ----------------------------------------------------------------------------
-- Best-effort backfill for estimates already finalised before this column
-- existed. This reconstructs the figure from the lines currently flagged
-- approved (the true at-the-time snapshot wasn't captured for these rows), so
-- it is exact only for rows whose approved lines are unchanged since. Guarded by
-- `authorised_total IS NULL` so it runs once and never overwrites a real snapshot.
-- ----------------------------------------------------------------------------
UPDATE estimates e
SET authorised_at = e.response_finalised_at,
    authorised_total = sub.total
FROM (
  SELECT ri.estimate_id, COALESCE(SUM(ri.total_inc_vat), 0) AS total
  FROM repair_items ri
  WHERE ri.customer_approved = true
    AND ri.parent_repair_item_id IS NULL
    AND ri.deleted_at IS NULL
  GROUP BY ri.estimate_id
) sub
WHERE e.id = sub.estimate_id
  AND e.response_finalised_at IS NOT NULL
  AND e.authorised_total IS NULL
  AND sub.total > 0;
