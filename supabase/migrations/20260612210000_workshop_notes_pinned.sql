-- Pinned workshop notes: keep important operational notes at the top of the
-- job's notes feed (e.g. "Call customer before any extra work").
ALTER TABLE workshop_notes ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;
