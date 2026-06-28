-- =============================================================================
-- Repair Types — Phase 3 (starter-template propagation)
--
-- The starter-template deep-copy (copy_starter_template_to_org) runs CROSS-ORG, so a
-- source item's repair_type_id (a UUID scoped to the SOURCE org) must NOT be copied
-- verbatim — it would dangle in the target org. Both orgs seed the same default
-- repair_types (Service/MOT/Diagnostic/…), so we map by CODE: source repair type →
-- the target org's repair type with the same code (NULL when there's no match).
--
-- CREATE OR REPLACE only; no data change. Safe / idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION copy_starter_template_to_org(
  target_org_id UUID,
  source_org_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  copied_count INTEGER := 0;
  tmpl RECORD;
  sec RECORD;
  new_template_id UUID;
  new_section_id UUID;
BEGIN
  FOR tmpl IN
    SELECT *
    FROM check_templates
    WHERE is_starter_template = true
      AND is_active = true
      AND organization_id <> target_org_id
      AND (source_org_id IS NULL OR organization_id = source_org_id)
    ORDER BY created_at
  LOOP
    -- Idempotency: skip if the target org already has a template with this name
    IF EXISTS (
      SELECT 1 FROM check_templates
      WHERE organization_id = target_org_id AND name = tmpl.name
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO check_templates (
      organization_id, site_id, name, description,
      is_active, is_default, version
    )
    VALUES (
      target_org_id, NULL, tmpl.name, tmpl.description,
      true, tmpl.is_default, COALESCE(tmpl.version, 1)
    )
    RETURNING id INTO new_template_id;

    FOR sec IN
      SELECT * FROM template_sections WHERE template_id = tmpl.id ORDER BY sort_order
    LOOP
      INSERT INTO template_sections (template_id, name, description, sort_order)
      VALUES (new_template_id, sec.name, sec.description, sec.sort_order)
      RETURNING id INTO new_section_id;

      INSERT INTO template_items (
        section_id, name, description, item_type, is_required,
        sort_order, config, reason_type, repair_type_id, exclude_from_ai,
        requires_location, is_active
      )
      SELECT
        new_section_id, ti.name, ti.description, ti.item_type, ti.is_required,
        ti.sort_order, ti.config, ti.reason_type,
        -- map the source repair type to the target org's repair type by CODE (NULL if none)
        (SELECT rt_tgt.id
           FROM repair_types rt_src
           JOIN repair_types rt_tgt
             ON rt_tgt.organization_id = target_org_id
            AND rt_tgt.code = rt_src.code
          WHERE rt_src.id = ti.repair_type_id
          LIMIT 1),
        ti.exclude_from_ai, ti.requires_location, ti.is_active
      FROM template_items ti
      WHERE ti.section_id = sec.id;
    END LOOP;

    copied_count := copied_count + 1;
  END LOOP;

  RETURN copied_count;
END;
$$ LANGUAGE plpgsql;
