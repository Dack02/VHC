-- Advisor Attention notes: a note can be flagged for advisor attention and
-- stays "red" (unactioned) until someone confirms it has been seen.
-- Unactioned = advisor_attention AND actioned_at IS NULL - drives the nav
-- badge (site-wide, not per-advisor, so nothing is missed when someone is off).
ALTER TABLE workshop_notes ADD COLUMN IF NOT EXISTS advisor_attention BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE workshop_notes ADD COLUMN IF NOT EXISTS actioned_at TIMESTAMPTZ;
ALTER TABLE workshop_notes ADD COLUMN IF NOT EXISTS actioned_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_workshop_notes_unactioned
  ON workshop_notes(organization_id, created_at DESC)
  WHERE advisor_attention = true AND actioned_at IS NULL;
