# MOT Tester Routing

## Problem

Some garages have designated MOT tester(s). When a job carries **an MOT plus other
repairs**, the MOT should go to a tester while the other work goes to a different
technician — one booking, split across people.

## Model (the shape)

- **One jobsheet, split the lines.** The MOT is a work line on the job (a
  `repair_items` row whose `repair_type.is_mot = true`). It gets its own
  `assigned_technician_id`; the other repair lines get theirs. We never split the
  vehicle's visit into two jobs (that would fracture the customer / vehicle /
  invoice / board card).
- **Designation is a per-site list, not a certificate.** Being listed as an MOT
  tester for a site *is* the qualification. No `technician_certifications` row is
  required. Certs remain optional metadata (a garage may still record a licence
  number / expiry, and we can surface a soft expiry warning) but they never gate
  pool membership or assignment.
- **Ordered pool with caps.** Each tester has a `priority` (1 = filled first) and
  an optional `daily_mot_cap` ("Ian's slots"). Auto-assign fills by priority until
  the **first cap bites** — the tester's own `daily_mot_cap` *or* the site-wide
  bay cap (`resource_site_config.mot_daily_cap`) — then overflows to the next
  tester. When the bay is full, no more MOTs that day (existing capacity gate).
- **Advisory, not forced.** Consistent with the rest of the routing stack
  (skill-routing / quotas ship off-by-default), auto-assign is **opt-in** and every
  assignment is overridable by the advisor.
- **Time follows the line.** A labour line is a quantity of *time sold*
  (`repair_labour.hours`: e.g. an MOT line = 0.7h). At invoice / jobsheet-complete,
  each completed line's sold hours are **awarded to the tech who completed it** —
  this is the efficiency numerator, and it's what makes a split job attribute
  correctly (today all the job's hours go to the single primary tech, so the MOT
  tester gets no credit and the primary tech is credited for the MOT they didn't do).

## Phase 1 — routing foundation (manual)

**DB** (`20260702130000_mot_tester_pool.sql`)

```
site_mot_testers (
  id, organization_id, site_id, technician_id,
  priority        SMALLINT   -- 1 = filled first
  daily_mot_cap   SMALLINT   -- null = no per-tester cap (bay cap still applies)
  is_active       BOOLEAN
  UNIQUE (site_id, technician_id)
)
```

**API** (`apps/api/src/routes/resource-manager.ts`)
- `GET  /mot-testers?siteId=` → ordered pool + active technician roster (for the picker)
- `PUT  /mot-testers?siteId=` → replace the whole ordered pool (upsert + prune), site_admin+

**Web**
- Settings → Resource Manager: a "MOT Testers" section — add/remove techs, drag/set
  priority, set per-tester daily cap.
- Job card: on an MOT line, a qualified-only (pool-scoped) technician picker + a
  per-line tech chip so the split is visible.

## Phase 2 — auto-assign + tester worklist

- Per-site setting `auto_assign_mot` (default **off**).
- On MOT-line creation (MOT booking, or a VHC failure that adds an MOT line) / at
  check-in: walk `site_mot_testers` by priority → skip anyone at `daily_mot_cap`
  → deny if site `mot_daily_cap` reached → set `assigned_technician_id` on the MOT
  line to the first eligible tester. Advisor can override.
- "My MOTs today" filter (mobile + web) for the tester.

## Phase 3 — earned-hours attribution

- **Rule:** earned hours for a tech on a job = Σ `repair_labour.hours` of the lines
  they completed, resolved by `work_completed_by` → `repair_items.assigned_technician_id`
  → jobsheet primary. Authorised / invoiced lines only. Uses the line's **priced**
  hours (`repair_labour.hours`), *not* `mot_capacity_hours` (that's diary-loading
  overhead, a different number).
- **Snapshot** at invoice / jobsheet-complete into `jobsheet_labour_attribution
  (jobsheet_id, technician_id, earned_hours)` — frozen at `closed_at`, recomputed on
  reopen (mirrors how COGS is frozen at close; today nothing freezes labour).
- **Report:** rebuild `report_technician_efficiency`'s numerator onto attributed
  earned hours (snapshots for closed jobs, live for open); the clocked-hours
  denominator is unchanged.

## Locked decisions

1. Pool membership = designation. **No cert required.** (Certs optional metadata.)
2. Ordered pool by `priority`; fill until tech cap **or** bay cap bites, then overflow.
3. Auto-assign is opt-in (Phase 2), always overridable.
4. Earned hours = labour-line sold time, per line, to the completing tech, snapshot
   at invoice. Efficiency numerator moves from job-level `estimated_hours` to
   Σ line hours; `estimated_hours` stays only for diary/bay capacity planning.
