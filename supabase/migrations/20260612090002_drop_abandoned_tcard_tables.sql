-- Remove the abandoned March 2026 T-card experiment tables.
--
-- These were created directly on the dev Supabase instance on 2026-03-26
-- (orphan migration version 20260326000001 — no file ever existed in the
-- repo) and the feature was rebuilt as the Workshop Management Board using
-- workshop_* tables (20260612090000). The tcard_* tables only ever held a
-- handful of March test rows on dev and nothing ever shipped against them.
--
-- Explicitly authorised by Leo on 2026-06-12. Safe on production and fresh
-- environments where these tables never existed (IF EXISTS).

DROP TABLE IF EXISTS tcard_notes;
DROP TABLE IF EXISTS tcard_assignments;
DROP TABLE IF EXISTS tcard_columns;
DROP TABLE IF EXISTS tcard_statuses;
DROP TABLE IF EXISTS tcard_board_config;
