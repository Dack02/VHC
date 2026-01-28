-- Change default for template_items.is_required from true to false
-- This makes new template items non-mandatory by default
-- Existing items retain their current is_required value

ALTER TABLE template_items
ALTER COLUMN is_required SET DEFAULT false;

COMMENT ON COLUMN template_items.is_required IS
'If true, technician must select a RAG status for this item before submitting the health check. Defaults to false for new items.';
