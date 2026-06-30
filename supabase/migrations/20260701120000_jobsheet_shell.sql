-- TECH_JOB_MODEL.md P2 — One-jobsheet invariant (the hidden shell jobsheet)
--
-- A standalone VHC (manual create, DMS import) gets a lightweight hidden jobsheet so
-- "every VHC has a jobsheet" holds going forward. Shells are operational plumbing, not
-- commercial documents: they get no JS reference and are excluded from every jobsheet/
-- invoice/diary surface. The API spawns them on VHC create (crud.ts + dms-import.ts).
--
-- Per owner decision: NO historical backfill of existing standalone VHCs here — only
-- the column + trigger skip + consumer exclusions land, so new shells never leak.
-- Additive + idempotent. No destructive operations.

ALTER TABLE jobsheets
  ADD COLUMN IF NOT EXISTS is_shell BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN jobsheets.is_shell IS
  'Hidden shell jobsheet wrapping a standalone VHC (TECH_JOB_MODEL.md §5). Never invoiceable, never listed, no JS reference. Excluded from all commercial/diary surfaces.';

-- ---------------------------------------------------------------------------
-- 1. Teach the reference trigger to skip shells (alongside drafts) so a shell
--    never burns a JS number or bumps organization_settings.next_jobsheet_number.
--    Body copied verbatim from 20260623200000 with the is_shell guard added.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_jobsheet_reference()
RETURNS TRIGGER AS $$
DECLARE
  v_next_number INTEGER;
BEGIN
  -- Drafts and shells don't get a reference. Drafts get one on commit; shells never do.
  IF NEW.reference IS NULL
     AND COALESCE(NEW.is_draft, false) = false
     AND COALESCE(NEW.is_shell, false) = false THEN
    -- Atomically get and increment the per-org counter
    UPDATE organization_settings
    SET next_jobsheet_number = COALESCE(next_jobsheet_number, 1) + 1,
        updated_at = NOW()
    WHERE organization_id = NEW.organization_id
    RETURNING next_jobsheet_number - 1 INTO v_next_number;

    -- If no organization_settings row exists, create one
    IF v_next_number IS NULL THEN
      INSERT INTO organization_settings (organization_id, next_jobsheet_number, created_at, updated_at)
      VALUES (NEW.organization_id, 2, NOW(), NOW())
      ON CONFLICT (organization_id) DO UPDATE
      SET next_jobsheet_number = COALESCE(organization_settings.next_jobsheet_number, 1) + 1,
          updated_at = NOW()
      RETURNING next_jobsheet_number - 1 INTO v_next_number;
    END IF;

    NEW.reference := 'JS' || LPAD(v_next_number::TEXT, 5, '0');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 2. Make shells transparent to the Booking Diary feed. A shell-backed VHC must
--    behave exactly as it did before it had a jobsheet:
--      - GMS arm (FROM jobsheets): exclude shells so they never appear as bare
--        bookings or double-count their child VHC.
--      - DMS arm (FROM health_checks): the "standalone" predicate was
--        `jobsheet_id IS NULL`; widen it so a VHC whose only jobsheet is a shell
--        still surfaces here with its full DMS detail (service type, booked
--        repairs, MOT flag) instead of vanishing.
--    View body copied from 20260626120000 with only those two WHERE changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_diary_bookings AS
-- GMS-native jobsheets (committed, non-shell only)
SELECT
  j.id                                           AS booking_id,
  'gms'::text                                    AS source,
  j.organization_id,
  j.site_id,
  j.due_in_date                                  AS appt_date,
  j.due_in_time                                  AS appt_time,
  j.customer_id,
  j.vehicle_id,
  v.registration                                 AS registration,
  NULLIF(TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), '') AS customer_name,
  st.label                                       AS service_type_label,
  COALESCE(
    NULLIF(TRIM(j.booking_notes), ''),
    (SELECT COALESCE(NULLIF(TRIM(ri.description), ''), ri.name)
       FROM repair_items ri
      WHERE ri.jobsheet_id = j.id AND ri.source = 'booking'
      ORDER BY ri.created_at LIMIT 1),
    st.label
  )                                              AS description,
  COALESCE(st.is_mot, false)                     AS is_mot,
  EXISTS (
    SELECT 1 FROM jobsheet_booking_codes jbc
    JOIN booking_codes bc ON bc.id = jbc.booking_code_id
    WHERE jbc.jobsheet_id = j.id AND bc.code ILIKE 'waiting'
  )                                              AS is_waiting,
  COALESCE(j.courtesy_vehicle_required, false)   AS is_loan,
  COALESCE(
    j.estimated_hours,
    (SELECT SUM(rl.hours)
       FROM repair_items ri
       JOIN repair_labour rl ON rl.repair_item_id = ri.id
      WHERE ri.jobsheet_id = j.id AND ri.source = 'booking'),
    st.default_hours
  )                                              AS estimated_hours,
  hc.status::text                                AS status,
  COALESCE(hc.job_state, j.job_state)            AS job_state,
  j.id                                           AS jobsheet_id,
  hc.id                                          AS health_check_id,
  j.origin_source                                AS origin_source,
  j.follow_up_case_id                            AS follow_up_case_id,
  hc.technician_id                               AS technician_id,
  j.advisor_id                                   AS advisor_id,
  hc.bay_number::text                            AS bay_number
FROM jobsheets j
LEFT JOIN vehicles  v  ON v.id  = j.vehicle_id
LEFT JOIN customers c  ON c.id  = j.customer_id
LEFT JOIN service_types st ON st.id = j.service_type_id
LEFT JOIN LATERAL (
  SELECT h.id, h.status, h.job_state, h.technician_id, h.bay_number
  FROM health_checks h
  WHERE h.jobsheet_id = j.id
  ORDER BY h.created_at
  LIMIT 1
) hc ON true
WHERE COALESCE(j.is_draft, false) = false
  AND COALESCE(j.is_shell, false) = false
  AND j.deleted_at IS NULL
  AND j.due_in_date IS NOT NULL

UNION ALL

-- Gemini-DMS imports not linked to a REAL jobsheet (a shell-only link still counts as standalone)
SELECT
  hc.id                                          AS booking_id,
  'dms'::text                                    AS source,
  hc.organization_id,
  hc.site_id,
  (hc.due_date)::date                            AS appt_date,
  (hc.due_date)::time                            AS appt_time,
  hc.customer_id,
  hc.vehicle_id,
  v.registration                                 AS registration,
  NULLIF(TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), '') AS customer_name,
  hc.booked_service_type                         AS service_type_label,
  COALESCE(
    NULLIF(TRIM(split_part(COALESCE(hc.notes,''), E'\n', 1)), ''),
    (SELECT NULLIF(TRIM(br->>'description'), '')
       FROM jsonb_array_elements(COALESCE(hc.booked_repairs, '[]'::jsonb)) br
      WHERE NULLIF(TRIM(br->>'description'), '') IS NOT NULL
      LIMIT 1),
    hc.booked_service_type
  )                                              AS description,
  COALESCE(hc.is_mot_booking, false)             AS is_mot,
  COALESCE(hc.customer_waiting, false)           AS is_waiting,
  COALESCE(hc.loan_car_required, false)          AS is_loan,
  COALESCE(
    hc.estimated_hours,
    (SELECT SUM((li->>'units')::numeric)
       FROM jsonb_array_elements(COALESCE(hc.booked_repairs, '[]'::jsonb)) br,
            jsonb_array_elements(COALESCE(br->'labourItems', '[]'::jsonb)) li
      WHERE NULLIF(li->>'units','') IS NOT NULL)
  )                                              AS estimated_hours,
  hc.status::text                                AS status,
  hc.job_state                                   AS job_state,
  NULL::uuid                                     AS jobsheet_id,
  hc.id                                          AS health_check_id,
  hc.origin_source                               AS origin_source,
  hc.follow_up_case_id                           AS follow_up_case_id,
  hc.technician_id                               AS technician_id,
  hc.advisor_id                                  AS advisor_id,
  hc.bay_number::text                            AS bay_number
FROM health_checks hc
LEFT JOIN vehicles  v ON v.id = hc.vehicle_id
LEFT JOIN customers c ON c.id = hc.customer_id
WHERE (
        hc.jobsheet_id IS NULL
        OR EXISTS (SELECT 1 FROM jobsheets sj WHERE sj.id = hc.jobsheet_id AND sj.is_shell = true)
      )
  AND hc.external_source = 'gemini_osi'
  AND hc.due_date IS NOT NULL
  AND hc.status NOT IN ('cancelled', 'no_show');

REVOKE ALL ON vw_diary_bookings FROM public, anon, authenticated;
GRANT SELECT ON vw_diary_bookings TO service_role;
