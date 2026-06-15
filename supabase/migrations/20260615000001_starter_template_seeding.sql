-- =============================================================================
-- Starter Inspection Template Seeding
-- =============================================================================
-- Mirrors the existing starter-reasons mechanism (copy_starter_reasons_to_org)
-- for inspection templates. A newly-provisioned organization currently receives
-- NO check_template, yet health-check creation hard-requires a template_id, so a
-- fresh org cannot create its first health check. This adds the ability to flag a
-- template as a platform "starter" and deep-copy it (with sections + items) into a
-- new org, so onboarding ends with a working, ready-to-use template.
--
-- Safe migration: additive only (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE,
-- INSERT ... ON CONFLICT DO NOTHING). Never destructive.
-- =============================================================================

-- 1. Flag column on check_templates (parallels item_reasons.is_starter_template)
ALTER TABLE check_templates
  ADD COLUMN IF NOT EXISTS is_starter_template BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_check_templates_starter
  ON check_templates(is_starter_template) WHERE is_starter_template = true;

-- 2. Deep-copy function: copy starter template(s) + their sections + items into a
--    target org. If source_org_id is provided, only copy starter templates from
--    that org; otherwise copy starter templates from any org. Idempotent: skips a
--    template whose name already exists in the target org. Returns the number of
--    templates copied.
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
        sort_order, config, reason_type, exclude_from_ai,
        requires_location, is_active
      )
      SELECT
        new_section_id, name, description, item_type, is_required,
        sort_order, config, reason_type, exclude_from_ai,
        requires_location, is_active
      FROM template_items
      WHERE section_id = sec.id;
    END LOOP;

    copied_count := copied_count + 1;
  END LOOP;

  RETURN copied_count;
END;
$$ LANGUAGE plpgsql;

-- 3. Default platform settings row for starter-template config (mirrors 'starter_reasons').
--    settings shape: { auto_copy_on_create: bool, source_organization_id: uuid|null }
INSERT INTO platform_settings (id, settings)
VALUES ('starter_template', '{"auto_copy_on_create": true}'::jsonb)
ON CONFLICT (id) DO NOTHING;
