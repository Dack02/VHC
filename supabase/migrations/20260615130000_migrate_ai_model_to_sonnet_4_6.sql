-- =============================================================================
-- Migrate AI model off the retiring Claude Sonnet 4
-- =============================================================================
-- claude-sonnet-4-20250514 ("Claude Sonnet 4") is deprecated and retires
-- 2026-06-15; after retirement the model ID returns 404 and all AI reason
-- generation breaks. Move to claude-sonnet-4-6 ("Claude Sonnet 4.6") — same
-- $3/$15 per-1M pricing, same API shape, so this is a pure model-ID swap.
-- =============================================================================

-- 1. Add the current model to the pricing table (drives the admin model dropdown,
--    which filters on effective_to IS NULL). Idempotent.
INSERT INTO ai_model_pricing (model, input_cost_per_1m_tokens, output_cost_per_1m_tokens, effective_from, notes) VALUES
  ('claude-sonnet-4-6', 3.00, 15.00, '2026-06-15', 'Claude Sonnet 4.6')
ON CONFLICT (model) DO UPDATE SET
  input_cost_per_1m_tokens = EXCLUDED.input_cost_per_1m_tokens,
  output_cost_per_1m_tokens = EXCLUDED.output_cost_per_1m_tokens,
  effective_from = EXCLUDED.effective_from,
  effective_to = NULL,
  notes = EXCLUDED.notes;

-- 2. Retire the old Sonnet 4 pricing row so it drops out of the dropdown.
--    Costs on existing ai_usage_logs are stored at insert time, so closing this
--    row does not alter historical records.
UPDATE ai_model_pricing
SET effective_to = '2026-06-15'
WHERE model = 'claude-sonnet-4-20250514'
  AND effective_to IS NULL;

-- 3. Repoint the platform default model — but only if it is still on the
--    retiring model, so a deliberate choice made via the admin UI is preserved.
UPDATE platform_ai_settings
SET value = 'claude-sonnet-4-6', updated_at = NOW()
WHERE key = 'ai_model'
  AND value = 'claude-sonnet-4-20250514';
