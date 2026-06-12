-- Placeholder for the March 2026 T-card experiment.
--
-- The original migration with this version was applied ONLY to the dev
-- Supabase instance (directly via MCP on 2026-03-26, never as a repo file),
-- creating the tcard_* tables. Without a local file for this version,
-- `supabase db push` fails on dev with a migration-history mismatch.
--
-- This file intentionally does nothing: dev already has the version recorded
-- (so it is skipped there), and on any other environment the experiment's
-- tables should never be created. The experiment was superseded by the
-- Workshop Management Board (20260612090000) and its tables are dropped by
-- 20260612090002_drop_abandoned_tcard_tables.sql.

SELECT 1;
