-- Set all existing template items to not required
-- This ensures existing items are non-mandatory by default
-- Admins can then opt-in specific items as required

UPDATE template_items
SET is_required = false
WHERE is_required = true;
