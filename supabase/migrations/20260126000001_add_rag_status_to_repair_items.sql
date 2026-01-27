-- =============================================================================
-- Add rag_status column to repair_items for MRI-sourced items
-- =============================================================================
-- The new repair_items schema (from pricing migration) doesn't have rag_status.
-- Inspection items derive their RAG status from linked check_results via junction table.
-- MRI items need a direct rag_status column since they don't have check_results.
-- =============================================================================

-- Add rag_status column to repair_items
ALTER TABLE repair_items
    ADD COLUMN IF NOT EXISTS rag_status rag_status;

COMMENT ON COLUMN repair_items.rag_status IS 'Direct RAG status for MRI-sourced items (inspection items derive from check_results)';

-- Create index for efficient filtering by RAG status
CREATE INDEX IF NOT EXISTS idx_repair_items_rag_status ON repair_items(rag_status) WHERE rag_status IS NOT NULL;

-- =============================================================================
-- Backfill rag_status for existing MRI repair items
-- =============================================================================

UPDATE repair_items ri
SET rag_status = msr.rag_status::rag_status
FROM mri_scan_results msr
WHERE ri.mri_result_id = msr.id
  AND ri.source = 'mri_scan'
  AND ri.rag_status IS NULL;
