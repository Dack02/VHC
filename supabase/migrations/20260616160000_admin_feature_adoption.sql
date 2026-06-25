-- =============================================================================
-- Super Admin cross-org FEATURE ADOPTION rollup.
-- Companion to admin_usage_by_org (20260615120000): that answers "how much are
-- they spending" (SMS / email / HC / AI / storage); this answers "which features
-- are they actually USING". Per-org activity signals for the four headline
-- modules, for an arbitrary [p_from, p_to] window. The super-admin endpoint pairs
-- each count with the org's *effective* module enablement (resolved in Node via
-- services/modules.ts) to render active / enabled-but-idle / off.
--
-- Signals (period-windowed by created_at, except workshop cards by updated_at):
--   follow_up : follow_up_cases opened in the window (the recovery module running)
--   workshop  : deliberate board actions — notes written + cards manually placed
--               (placement <> 'auto'). job_state is excluded: it is auto-derived
--               from status by a trigger, so it is not a clean "board used" signal.
--   reports   : audit_logs report.view / report.export events (instrumented in
--               apps/api/src/routes/reports.ts). No history before that landed, so
--               this reads 0 until views accrue.
--   parts     : repair_items with parts_total > 0 — parts priced onto jobs (the
--               ongoing-use signal for Parts & Packages, which is not a gated
--               module). service_package.apply audit events also reflect packages.
--
-- Locked to service_role only (called server-side by the super-admin endpoint),
-- exactly like the other admin_* aggregations.
-- =============================================================================

CREATE OR REPLACE FUNCTION admin_feature_adoption(p_from date, p_to date)
RETURNS TABLE(
  organization_id uuid,
  organization_name text,
  status text,
  follow_up_count bigint,
  workshop_count bigint,
  reports_count bigint,
  parts_count bigint
)
LANGUAGE sql STABLE AS $$
  WITH fu AS (
    SELECT f.organization_id, COUNT(*) AS n
    FROM follow_up_cases f
    WHERE f.created_at >= p_from::timestamptz AND f.created_at < (p_to + 1)::timestamptz
    GROUP BY f.organization_id
  ),
  ws AS (
    SELECT board.org_id AS organization_id, COUNT(*) AS n
    FROM (
      SELECT wn.organization_id AS org_id
      FROM workshop_notes wn
      WHERE wn.created_at >= p_from::timestamptz AND wn.created_at < (p_to + 1)::timestamptz
      UNION ALL
      SELECT wc.organization_id AS org_id
      FROM workshop_cards wc
      WHERE wc.placement <> 'auto'
        AND wc.updated_at >= p_from::timestamptz AND wc.updated_at < (p_to + 1)::timestamptz
    ) board
    GROUP BY board.org_id
  ),
  rp AS (
    SELECT al.organization_id, COUNT(*) AS n
    FROM audit_logs al
    WHERE al.action IN ('report.view', 'report.export')
      AND al.organization_id IS NOT NULL
      AND al.created_at >= p_from::timestamptz AND al.created_at < (p_to + 1)::timestamptz
    GROUP BY al.organization_id
  ),
  pt AS (
    SELECT ri.organization_id, COUNT(*) AS n
    FROM repair_items ri
    WHERE ri.parts_total > 0
      AND ri.created_at >= p_from::timestamptz AND ri.created_at < (p_to + 1)::timestamptz
    GROUP BY ri.organization_id
  )
  SELECT o.id,
         o.name,
         o.status,
         COALESCE(fu.n, 0)::bigint,
         COALESCE(ws.n, 0)::bigint,
         COALESCE(rp.n, 0)::bigint,
         COALESCE(pt.n, 0)::bigint
  FROM organizations o
  LEFT JOIN fu ON fu.organization_id = o.id
  LEFT JOIN ws ON ws.organization_id = o.id
  LEFT JOIN rp ON rp.organization_id = o.id
  LEFT JOIN pt ON pt.organization_id = o.id
  WHERE o.status <> 'cancelled';
$$;

-- Supporting indexes for the per-feature window scans (idempotent).
CREATE INDEX IF NOT EXISTS idx_follow_up_cases_org_created ON follow_up_cases(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workshop_notes_org_created  ON workshop_notes(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workshop_cards_org_updated  ON workshop_cards(organization_id, updated_at) WHERE placement <> 'auto';
CREATE INDEX IF NOT EXISTS idx_repair_items_org_created_parts ON repair_items(organization_id, created_at) WHERE parts_total > 0;

-- Lock down: server-side (service_role) only, never authenticated/anon.
REVOKE ALL ON FUNCTION admin_feature_adoption(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_feature_adoption(date, date) TO service_role;
