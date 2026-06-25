-- =============================================================================
-- Fix: copy_starter_reasons_to_org must also copy ITEM-SPECIFIC reasons
-- =============================================================================
-- The original function (20260117000001_vhc_reasons_phase1.sql) only copied
-- TYPE-BASED starter reasons (reason_type IS NOT NULL) and silently dropped every
-- item-specific reason (template_item_id IS NOT NULL, reason_type IS NULL),
-- because an item-specific reason's template_item_id points at the SOURCE org's
-- template items, which don't exist in a freshly created org.
--
-- Result: a newly provisioned org received only the handful of type-based reasons
-- (Tyre / Fluid Level / Suspension) and none of the hundreds of per-item "Unique
-- Items" reasons — even though the super-admin had marked all of them as starter.
-- (e.g. "Ollo Motors" got 63 type-based reasons and 0 of 1,575 item-specific.)
--
-- This rewrite ALSO copies item-specific reasons, remapping each source
-- template_item_id onto the TARGET org's template item with the SAME name. This
-- relies on the starter inspection template having already been copied into the
-- target org (provisioning copies the template BEFORE the reasons), so matching
-- target items exist. Items with no name match are skipped (best-effort).
--
-- Safe migration: CREATE OR REPLACE only; additive INSERT ... ON CONFLICT DO
-- NOTHING. Never destructive.
-- =============================================================================

CREATE OR REPLACE FUNCTION copy_starter_reasons_to_org(
  target_org_id UUID,
  source_org_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  type_count INTEGER := 0;
  item_count INTEGER := 0;
BEGIN
  -- (1) TYPE-BASED reasons — reason_type is org-agnostic, so copy verbatim.
  INSERT INTO item_reasons (
    organization_id, template_item_id, reason_type, reason_text,
    technical_description, customer_description,
    default_rag, category_id,
    suggested_follow_up_days, suggested_follow_up_text,
    ai_generated, ai_reviewed,
    is_active, sort_order
  )
  SELECT
    target_org_id, NULL, reason_type, reason_text,
    technical_description, customer_description,
    default_rag, category_id,
    suggested_follow_up_days, suggested_follow_up_text,
    ai_generated, true,  -- Mark copied reasons as reviewed
    is_active, sort_order
  FROM item_reasons
  WHERE is_starter_template = true
    AND reason_type IS NOT NULL
    AND organization_id <> target_org_id
    AND (source_org_id IS NULL OR organization_id = source_org_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS type_count = ROW_COUNT;

  -- (2) ITEM-SPECIFIC reasons — remap template_item_id from the source org's item
  --     to the target org's item with the same name. The name match is scoped to
  --     the target org via template_sections -> check_templates.organization_id.
  INSERT INTO item_reasons (
    organization_id, template_item_id, reason_type, reason_text,
    technical_description, customer_description,
    default_rag, category_id,
    suggested_follow_up_days, suggested_follow_up_text,
    ai_generated, ai_reviewed,
    is_active, sort_order
  )
  SELECT
    target_org_id, tgt_item.id, NULL, src.reason_text,
    src.technical_description, src.customer_description,
    src.default_rag, src.category_id,
    src.suggested_follow_up_days, src.suggested_follow_up_text,
    src.ai_generated, true,  -- Mark copied reasons as reviewed
    src.is_active, src.sort_order
  FROM item_reasons src
  JOIN template_items    src_item ON src_item.id = src.template_item_id
  JOIN template_items    tgt_item ON tgt_item.name = src_item.name
  JOIN template_sections tgt_sec  ON tgt_sec.id = tgt_item.section_id
  JOIN check_templates   tgt_tpl  ON tgt_tpl.id = tgt_sec.template_id
                                  AND tgt_tpl.organization_id = target_org_id
  WHERE src.is_starter_template = true
    AND src.reason_type IS NULL
    AND src.template_item_id IS NOT NULL
    AND src.organization_id <> target_org_id
    AND (source_org_id IS NULL OR src.organization_id = source_org_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS item_count = ROW_COUNT;

  RETURN type_count + item_count;
END;
$$ LANGUAGE plpgsql;
