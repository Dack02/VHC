-- =============================================================================
-- Follow-Up Module - Phase 1: Database Schema
-- Deferred-work recovery: per-visit cases, due-date-aware timelines, outcomes,
-- call dispositions, event log. All additive, org-scoped, RLS-protected.
-- Spec: docs/follow-up-module-spec.md
-- =============================================================================

-- =============================================================================
-- 1. FOLLOW_UP_OUTCOMES (configurable, per organization) — closes a case
-- =============================================================================

CREATE TABLE IF NOT EXISTS follow_up_outcomes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_won BOOLEAN DEFAULT false,      -- counts as recovered (e.g. Booked) in conversion reports
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,   -- system defaults cannot be deleted
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_outcomes_org ON follow_up_outcomes(organization_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_outcomes_active ON follow_up_outcomes(organization_id, is_active) WHERE is_active = true;

-- =============================================================================
-- 2. FOLLOW_UP_DISPOSITIONS (configurable, per organization) — interim call result
-- =============================================================================

CREATE TABLE IF NOT EXISTS follow_up_dispositions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,
  snooze_days INTEGER,               -- optional default snooze when chosen (NULL = no snooze)
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_dispositions_org ON follow_up_dispositions(organization_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_dispositions_active ON follow_up_dispositions(organization_id, is_active) WHERE is_active = true;

-- =============================================================================
-- 3. FOLLOW_UP_TIMELINES + STEPS (configurable cadence)
-- =============================================================================

CREATE TABLE IF NOT EXISTS follow_up_timelines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,
  anchor VARCHAR(20) NOT NULL DEFAULT 'due_date',  -- 'due_date' | 'deferral_date'
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT follow_up_timelines_anchor_chk CHECK (anchor IN ('due_date', 'deferral_date'))
);

CREATE INDEX IF NOT EXISTS idx_follow_up_timelines_org ON follow_up_timelines(organization_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_timelines_default ON follow_up_timelines(organization_id, is_default) WHERE is_default = true;

CREATE TABLE IF NOT EXISTS follow_up_timeline_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timeline_id UUID NOT NULL REFERENCES follow_up_timelines(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  step_order INTEGER NOT NULL,
  action VARCHAR(20) NOT NULL,       -- send_sms | send_email | send_both | manual_call | auto_close
  offset_days INTEGER NOT NULL DEFAULT 0,  -- relative to anchor; negative = before due date

  -- Inline message content (rendered with {{placeholders}} by the engine)
  sms_body TEXT,
  email_subject TEXT,
  email_body TEXT,

  default_outcome_id UUID REFERENCES follow_up_outcomes(id),  -- for auto_close steps

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT follow_up_timeline_steps_action_chk
    CHECK (action IN ('send_sms', 'send_email', 'send_both', 'manual_call', 'auto_close')),
  UNIQUE(timeline_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_timeline_steps_timeline ON follow_up_timeline_steps(timeline_id, step_order);
CREATE INDEX IF NOT EXISTS idx_follow_up_timeline_steps_org ON follow_up_timeline_steps(organization_id);

-- =============================================================================
-- 4. FOLLOW_UP_CASES (one per vehicle visit / health check)
-- =============================================================================

CREATE TABLE IF NOT EXISTS follow_up_cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id),
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,

  timeline_id UUID REFERENCES follow_up_timelines(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active|booking_found|engaged|manual|closed
  current_step_order INTEGER DEFAULT 0,          -- last executed step order (0 = none yet)
  anchor_date DATE,                              -- nearest unresolved item due date (NULL if none)
  next_action_at TIMESTAMPTZ,                    -- when the sweep should next look at this case

  deferred_value_snapshot DECIMAL(10,2) DEFAULT 0,  -- sum of item totals at case creation
  item_count INTEGER DEFAULT 0,

  assigned_to UUID REFERENCES users(id),         -- defaults to original advisor
  linked_booking_id UUID REFERENCES health_checks(id),  -- DMS booking (awaiting_arrival HC) if found

  last_contacted_at TIMESTAMPTZ,
  manual_attempts INTEGER DEFAULT 0,

  outcome_id UUID REFERENCES follow_up_outcomes(id),
  outcome_notes TEXT,
  closed_by UUID REFERENCES users(id),
  closed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT follow_up_cases_status_chk
    CHECK (status IN ('active', 'booking_found', 'engaged', 'manual', 'closed')),
  UNIQUE(health_check_id)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_cases_org_status ON follow_up_cases(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_follow_up_cases_due ON follow_up_cases(organization_id, status, next_action_at);
CREATE INDEX IF NOT EXISTS idx_follow_up_cases_assigned ON follow_up_cases(assigned_to) WHERE status <> 'closed';
CREATE INDEX IF NOT EXISTS idx_follow_up_cases_anchor ON follow_up_cases(organization_id, anchor_date);
CREATE INDEX IF NOT EXISTS idx_follow_up_cases_customer ON follow_up_cases(customer_id);

-- =============================================================================
-- 5. FOLLOW_UP_CASE_ITEMS (snapshot of deferred items in the case)
-- =============================================================================

CREATE TABLE IF NOT EXISTS follow_up_case_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES follow_up_cases(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repair_item_id UUID NOT NULL REFERENCES repair_items(id) ON DELETE CASCADE,

  name_snapshot VARCHAR(255),
  value_snapshot DECIMAL(10,2) DEFAULT 0,
  due_date_snapshot DATE,
  rag_snapshot VARCHAR(10),

  item_outcome_id UUID REFERENCES follow_up_outcomes(id),  -- Phase 2: per-item outcome

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(case_id, repair_item_id)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_case_items_case ON follow_up_case_items(case_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_case_items_repair ON follow_up_case_items(repair_item_id);

-- =============================================================================
-- 6. FOLLOW_UP_EVENTS (activity log — sends, replies, calls, status changes)
-- =============================================================================

CREATE TABLE IF NOT EXISTS follow_up_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES follow_up_cases(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  event_type VARCHAR(30) NOT NULL,   -- step_sent|sms_in|email_in|booking_found|call_logged|
                                     -- disposition_set|status_change|outcome_set|snoozed|note|system
  channel VARCHAR(10),               -- sms|email|phone|system
  step_order INTEGER,                -- which timeline step produced this (if any)
  disposition_id UUID REFERENCES follow_up_dispositions(id),
  body TEXT,
  metadata JSONB DEFAULT '{}',

  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_follow_up_events_case ON follow_up_events(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follow_up_events_org ON follow_up_events(organization_id);

-- =============================================================================
-- 7. CONTACT CONSENT ON CUSTOMERS (UK PECR — STOP / opt-out)
-- =============================================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_opt_out BOOLEAN DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS opt_out_at TIMESTAMPTZ;

-- =============================================================================
-- 8. SHARED updated_at TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION update_follow_up_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_follow_up_outcomes_updated ON follow_up_outcomes;
CREATE TRIGGER trg_follow_up_outcomes_updated BEFORE UPDATE ON follow_up_outcomes
  FOR EACH ROW EXECUTE FUNCTION update_follow_up_updated_at();

DROP TRIGGER IF EXISTS trg_follow_up_dispositions_updated ON follow_up_dispositions;
CREATE TRIGGER trg_follow_up_dispositions_updated BEFORE UPDATE ON follow_up_dispositions
  FOR EACH ROW EXECUTE FUNCTION update_follow_up_updated_at();

DROP TRIGGER IF EXISTS trg_follow_up_timelines_updated ON follow_up_timelines;
CREATE TRIGGER trg_follow_up_timelines_updated BEFORE UPDATE ON follow_up_timelines
  FOR EACH ROW EXECUTE FUNCTION update_follow_up_updated_at();

DROP TRIGGER IF EXISTS trg_follow_up_timeline_steps_updated ON follow_up_timeline_steps;
CREATE TRIGGER trg_follow_up_timeline_steps_updated BEFORE UPDATE ON follow_up_timeline_steps
  FOR EACH ROW EXECUTE FUNCTION update_follow_up_updated_at();

DROP TRIGGER IF EXISTS trg_follow_up_cases_updated ON follow_up_cases;
CREATE TRIGGER trg_follow_up_cases_updated BEFORE UPDATE ON follow_up_cases
  FOR EACH ROW EXECUTE FUNCTION update_follow_up_updated_at();

-- =============================================================================
-- 9. SEED DEFAULTS FOR AN ORGANIZATION
-- Seeds outcomes, dispositions, and a default due-date-aware timeline + steps.
-- Idempotent: each section only seeds when empty for the org.
-- =============================================================================

CREATE OR REPLACE FUNCTION seed_follow_up_config_for_org(p_organization_id UUID)
RETURNS VOID AS $$
DECLARE
  v_timeline_id UUID;
BEGIN
  -- Outcomes
  IF NOT EXISTS (SELECT 1 FROM follow_up_outcomes WHERE organization_id = p_organization_id) THEN
    INSERT INTO follow_up_outcomes (organization_id, name, is_won, sort_order, is_system) VALUES
      (p_organization_id, 'Booked', true, 1, false),
      (p_organization_id, 'Already Booked', true, 2, false),
      (p_organization_id, 'Unable to Contact', false, 3, false),
      (p_organization_id, 'Declined', false, 4, false),
      (p_organization_id, 'Not Interested', false, 5, false),
      (p_organization_id, 'Done Elsewhere', false, 6, false),
      (p_organization_id, 'Other', false, 99, true)
    ON CONFLICT (organization_id, name) DO NOTHING;
  END IF;

  -- Dispositions (interim call results)
  IF NOT EXISTS (SELECT 1 FROM follow_up_dispositions WHERE organization_id = p_organization_id) THEN
    INSERT INTO follow_up_dispositions (organization_id, name, snooze_days, sort_order, is_system) VALUES
      (p_organization_id, 'No Answer', 2, 1, false),
      (p_organization_id, 'Left Voicemail', 3, 2, false),
      (p_organization_id, 'Callback Requested', 1, 3, false),
      (p_organization_id, 'Wrong Number', NULL, 4, false),
      (p_organization_id, 'Considering', 7, 5, false)
    ON CONFLICT (organization_id, name) DO NOTHING;
  END IF;

  -- Default timeline + steps (due-date anchored): Step 1 SMS+Email, Step 2 SMS, Step 3 manual call.
  -- Ends at the manual-call stage; a human works it to a closing outcome from there.
  IF NOT EXISTS (SELECT 1 FROM follow_up_timelines WHERE organization_id = p_organization_id) THEN
    INSERT INTO follow_up_timelines (organization_id, name, description, anchor, is_default, is_active)
    VALUES (p_organization_id, 'Standard recovery',
            'Default due-date-aware recovery cadence for deferred work.',
            'due_date', true, true)
    RETURNING id INTO v_timeline_id;

    INSERT INTO follow_up_timeline_steps
      (timeline_id, organization_id, step_order, action, offset_days, sms_body, email_subject, email_body, default_outcome_id)
    VALUES
      (v_timeline_id, p_organization_id, 1, 'send_both', -14,
       'Hi {{customerFirstName}}, a reminder from {{dealershipName}}: your {{vehicleReg}} has work due soon (approx {{deferredTotal}}). View details & book: {{followUpUrl}}',
       'Work due soon on your {{vehicleReg}} — {{dealershipName}}',
       'Hi {{customerFirstName}},' || chr(10) || chr(10) ||
       'During your recent visit we identified work on your {{vehicleMakeModel}} ({{vehicleReg}}) that was deferred. It is now coming due.' || chr(10) || chr(10) ||
       '{{deferredItemsTable}}' || chr(10) || chr(10) ||
       'Estimated total: {{deferredTotal}}' || chr(10) || chr(10) ||
       'To book or ask a question, view the full details here: {{followUpUrl}}' || chr(10) || chr(10) ||
       'Kind regards,' || chr(10) || '{{dealershipName}}' || chr(10) || '{{dealershipPhone}}',
       NULL),
      (v_timeline_id, p_organization_id, 2, 'send_sms', -3,
       'Hi {{customerFirstName}}, just a reminder your {{vehicleReg}} has work due. We''d be happy to book you in — call {{dealershipPhone}} or view: {{followUpUrl}} ({{dealershipName}})',
       NULL, NULL, NULL),
      (v_timeline_id, p_organization_id, 3, 'manual_call', 0,
       NULL, NULL, NULL, NULL)
    ON CONFLICT (timeline_id, step_order) DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 10. RLS POLICIES (defense-in-depth; API uses service role + explicit org filter)
-- =============================================================================

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'follow_up_outcomes', 'follow_up_dispositions', 'follow_up_timelines',
    'follow_up_timeline_steps', 'follow_up_cases', 'follow_up_case_items', 'follow_up_events'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS "Org members can view %1$s" ON %1$s', tbl);
    EXECUTE format(
      'CREATE POLICY "Org members can view %1$s" ON %1$s FOR SELECT USING (organization_id = current_setting(''app.current_org_id'', true)::uuid)', tbl);

    EXECUTE format('DROP POLICY IF EXISTS "Org members can insert %1$s" ON %1$s', tbl);
    EXECUTE format(
      'CREATE POLICY "Org members can insert %1$s" ON %1$s FOR INSERT WITH CHECK (organization_id = current_setting(''app.current_org_id'', true)::uuid)', tbl);

    EXECUTE format('DROP POLICY IF EXISTS "Org members can update %1$s" ON %1$s', tbl);
    EXECUTE format(
      'CREATE POLICY "Org members can update %1$s" ON %1$s FOR UPDATE USING (organization_id = current_setting(''app.current_org_id'', true)::uuid)', tbl);

    EXECUTE format('DROP POLICY IF EXISTS "Org members can delete %1$s" ON %1$s', tbl);
    EXECUTE format(
      'CREATE POLICY "Org members can delete %1$s" ON %1$s FOR DELETE USING (organization_id = current_setting(''app.current_org_id'', true)::uuid)', tbl);
  END LOOP;
END;
$$;

-- =============================================================================
-- 11. SEED FOR ALL EXISTING ORGANIZATIONS
-- =============================================================================

DO $$
DECLARE
  org_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM organizations LOOP
    PERFORM seed_follow_up_config_for_org(org_record.id);
  END LOOP;
END;
$$;

-- =============================================================================
-- DONE
-- =============================================================================
