-- =============================================================================
-- Booking Diary — best-effort backfill of is_mot_booking for existing DMS rows.
--
-- The importer now tags MOT bookings at import, but rows imported BEFORE the
-- Booking Diary patch were never tagged. Re-derive the flag from the same signal
-- the importer uses (\bmot\b in the free-text notes or the booked work JSON), so
-- the diary's MOT counts are accurate for historical bookings too.
--
-- Gemini has no MOT field — this is the only available signal — so it is
-- best-effort by design. Idempotent: only touches rows currently false; safe to
-- re-run. Additive, non-destructive.
-- =============================================================================

UPDATE health_checks
SET is_mot_booking = true
WHERE external_source = 'gemini_osi'
  AND is_mot_booking = false
  AND (
    COALESCE(notes, '') ~* '\ymot\y'
    OR COALESCE(booked_repairs::text, '') ~* '\ymot\y'
  );
