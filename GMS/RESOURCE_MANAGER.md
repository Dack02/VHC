# VHC Resource Manager — Design Document

> Status: Draft for build. Author: Principal Eng + Product Design. Date: 2026-06-28.
> Supersedes: the current Workshop Planner (`apps/web/src/pages/WorkshopBoard/*`) and extends the in-flight Booking Diary (`supabase/migrations/20260625120000_booking_diary.sql`).

---

## 1. Vision & Scope

### 1.1 What it is
The **Resource Manager** turns VHC's capacity surfaces from *passive visualisation* (a board that shows tech names + hours) into an **active booking-automation engine**. Its job is **booking acceptance and lead time** — for every booking, from every channel (manual HC, jobsheet, estimate online booking, DMS import), it answers two questions:

1. **Can this category of work go on day D?** — against an hours-based utilisation ceiling *and* staffing-driven category capacity/quotas that protect the service mix (skills feed this as *aggregate category capacity*, not a tech pick).
2. **When is the earliest it can go?** — a deterministic next-available recommendation the advisor can always override.

> It deliberately does **not** decide *which technician* does the job. That's day-of **dispatch** on the existing Workshop Board (the Resource Manager offers an *advisory* tech suggestion there — §5.2 — but never gates a booking on it). Booking reasons about category capacity; dispatch reasons about people.

### 1.2 How it supersedes the current planner
The current planner already owns the *primitives* — shift patterns, absences, the `dayCapacityMinutes()` calculation (`apps/web/src/pages/WorkshopBoard/types.ts:196`), and the day capacity RPC `diary_available_hours` (`20260625120000_booking_diary.sql`). What's missing is a **decision layer** on top. The Resource Manager:

- **Keeps** `workshop_tech_shifts`, `workshop_tech_absences`, `workshop_columns`, `workshop_board_config`, `vw_diary_bookings`, `diary_available_hours`, `diary_day_summary` — all reused verbatim as the capacity substrate.
- **Adds** a config layer (utilisation ceiling, category quotas), a skills layer (`technician_skills`, `technician_certifications`), and an **availability/recommendation service** that every booking flow calls.
- **Re-homes** the planner UI: the existing Tech/Week/Timeline views in `WorkshopBoard.tsx` stay as the *execution/dispatch* surface; a new **Resource Manager → Capacity** surface (built on the Booking Diary page `apps/web/src/pages/BookingDiary/BookingDiaryPage.tsx`) becomes the *planning/booking* surface.

Nothing in the current planner is deleted. The board remains the day-of dispatch tool; the Resource Manager is the forward-looking booking brain.

### 1.3 Out of scope (v1)
- Full optimisation/MILP solver. We use deterministic, explainable heuristics (the owner asked for "clever", not "opaque").
- Multi-site load balancing (route a job to a *different* site). Single-site capacity only; multi-site is a later phase.
- Parts-availability gating beyond a simple block flag (see §12).

---

## 2. Core Concepts & Definitions

| Term | Definition | Where it lives in VHC today |
|---|---|---|
| **Available hours** | Net working hours a tech is on-shift, minus lunch and absences, for a given date. | `dayCapacityMinutes()` (client, `types.ts:196`); `diary_available_hours()` RPC (server). |
| **Booked / sold hours** | Sum of `estimated_hours` of all bookings consuming a day. Denominated in *sold* (flat-rate/labour) hours. | `vw_diary_bookings.estimated_hours`; aggregated in `diary_day_summary`. |
| **Capacity %** (utilisation) | `booked_hours / available_hours`. RAG bands today: green <85, amber 85–100, red >100. | `BookingDiaryPage.tsx`, `BoardColumn.tsx:49`. |
| **Bookable ceiling** | `available_hours × target_loading_pct` (default 85%). The line we book *to*, not 100%. | **NEW** — config knob. |
| **Category** | A class of work — maps 1:1 to **`repair_types`** (`20260628130000_repair_types.sql`: Service, MOT, Diagnostic, Tyres, Brakes…). | `repair_items.repair_type_id`. |
| **Category quota** | Per-category, per-day target/min/max (in *jobs* and/or *hours*), soft or hard. | **NEW** — `resource_category_quotas`. |
| **Skill** | A tech's capability for a `repair_type`, with primary/secondary weighting. | **NEW** — `technician_skills`. |
| **Certification** | A gating credential with expiry (MOT tester, EV/HV, F-Gas/AC). Hard filter. | **NEW** — `technician_certifications`. |
| **Lead time** | Days from now to the recommended earliest bookable date for a given job. | **NEW** — derived by the recommendation service. |
| **Booking mode** | Per repair-type: **`drop_off`** (default — car left for the day; customer picks a morning *drop-off time* only so the garage knows arrival) or **`timed_slot`** (real appointment time; e.g. MOT, air-con regas — short, bay-bound). | **NEW** — `repair_types.booking_mode`. |
| **Drop-off window** | The morning band (e.g. 08:00–09:30) drop-off times are offered from, per site; extendable. | **NEW** — `resource_site_config`. |
| **Hold-back / protection level** | Hours/jobs reserved for higher-value categories, that lower-value categories may not consume — and that *decays as the day approaches* (airline EMSR nesting + healthcare carve-out release). | **NEW** — the quota algorithm (§4). |

### 2.1 Mapping to the hours hierarchy
VHC already distinguishes the four buckets the theory describes:
- **Available/Attended** → `diary_available_hours`.
- **Productive/Actual** → `technician_time_entries` (job-clocking initiative) → `health_checks.total_tech_time_minutes`.
- **Sold/Flat-rate** → `repair_labour.hours` rolled into `estimated_hours`.

The Resource Manager **books in sold hours, against an available-hours ceiling scaled by a target loading %.** Utilisation/efficiency reporting (§12) reads productive vs sold for calibration.

---

## 3. The Capacity Model

### 3.1 Per-technician available hours (per day)
Reuse the **exact** logic in `diary_available_hours()` and its client twin `dayCapacityMinutes()`. Formal definition for tech *t* on date *d* at site *s*:

```
weekday = isoWeekday(d) mapped to 0=Mon..6=Sun         # types.ts:206 convention
if all-day absence overlapping d:           avail(t,d) = 0
elif shifts exist for t but none for weekday: avail(t,d) = 0   # day off
elif shift row exists:
    avail(t,d) = (shift.end - shift.start)
               - lunch_overlap
               - Σ partial_absence_overlap
else:                                        # no shift pattern at all
    avail(t,d) = bookable_hours_per_tech OR default_tech_hours   # fallback
```

`bookable_hours_per_tech`, `default_tech_hours`, lunch and day-window come from `workshop_board_config` (`20260612090000`, `20260612200000`, `20260625120000`).

### 3.2 Site available hours (per day)
```
site_avail(s,d) = Σ over visible technician columns t of avail(t,d)
```
This is precisely what `diary_available_hours(org, site, d)` returns today. **No change required.**

### 3.3 Skill-segmented available hours — split primary vs eligible (per day, per category) — NEW
Total hours are *not fungible*, and — critically — capacity is **shaped by how you've staffed**. A category's "intended" capacity is the hours of the techs whose **primary** skill is that category; its "maximum reachable" capacity also includes techs who can do it as a **secondary** skill. For category *c* (a repair_type) on date *d*:
```
primary_supply(c,s,d)  = Σ avail(t,d) for techs t whose PRIMARY skill = c
                                         AND hold every cert c requires (valid on d)
eligible_supply(c,s,d) = Σ avail(t,d) for techs t who hold ANY skill for c (primary OR secondary)
                                         AND hold every cert c requires (valid on d)
```
`primary_supply` is what we *protect* (keep diag techs full of diag); `eligible_supply` is the ceiling we can stretch to when a category overflows its specialists (a service tech taking a repair). Implemented as RPC `resource_category_available_hours(org, site, d, repair_type_id, primary_only)` (§7) joining `technician_skills` / `technician_certifications` onto the same shift/absence math.

> **Why this matters (owner's reframing):** value/protection is *not* a fixed global ranking — it is driven by the workforce. If you employ 3 diagnostic techs, their 24h are inventory you *want* sold as diagnostics, so diagnostics is "high value" *on that day because you staffed it*. The algorithm in §4 derives protection from `primary_supply`, not from a hand-set rank.

### 3.4 Booked hours (per day, per category)
```
booked(s,d)      = Σ estimated_hours of bookings in vw_diary_bookings on d
booked(c,s,d)    = Σ estimated_hours of bookings on d whose repair_type_id = c
```
`estimated_hours` resolution ladder (already in the diary view): `hc.estimated_hours → Σ booked_repairs labour.units → service_type.default_hours → org default`. **DMS gap handling: see §10.**

### 3.5 Bookable ceiling & utilisation
```
ceiling(s,d)        = site_avail(s,d) × target_loading_pct          # default 0.85
utilisation(s,d)    = booked(s,d) / site_avail(s,d)
remaining_pool(s,d) = max(0, ceiling(s,d) - booked(s,d))            # soft headroom
hard_remaining(s,d) = max(0, site_avail(s,d) × overbook_factor - booked(s,d))
```
- `target_loading_pct` per site (default 0.85, the 135/160 industry pattern).
- `overbook_factor = 1 / show_rate` (default 1.0 in v1; tuned later from DMS arrival data, §12).

RAG banding keys off `utilisation` vs `target_loading_pct` (amber at target, red at 100%+), and also flags **underloaded** days (green well below target) to drive fill.

### 3.6 Where capacity is computed
All rollups go through **DB RPCs**, never raw multi-row fetches — `MEMORY: PostgREST 1000-row cap` would silently undercount booked hours. New RPCs aggregate in SQL and return pre-computed JSON.

---

## 4. The Clever Quota Algorithm (centrepiece)

> **v1.1 — supply-driven model.** This section was rewritten after owner feedback (2026-06-28). Protection is now derived from **how the workshop is staffed** (a category's `primary_supply`), not a hand-set global value rank. Two capacity dimensions are enforced per technician: **hours** *and* **job count per day** (the "max N diagnostic evaluations per diag tech" throttle). Enforcement is **soft or hard, configurable per category per site** ("both, configurable").

### 4.1 The problem restated
- Don't fill a day entirely with diagnostics or one big repair.
- Keep each **specialist on their specialty** — if you staffed 3 diag techs, keep them full of diag.
- Limit **how many of a category one tech can do per day** (e.g. ≤ 5 diagnostic evaluations per diag tech — a quality/throughput limit, independent of hours).
- Guarantee daily room for bread-and-butter service work.
- **But** never refuse a profitable repair for *tomorrow* when tomorrow's book is light, and never leave a specialist idle when their own demand hasn't materialised.

Static per-category caps fail the last requirement (a flat "max 3 diags" blocks work even on an empty day, and a flat hours cap leaves a specialist idle). The model borrows **airline fare-class nesting** — but the "fare classes" are **skill pools**: a diag tech's hours are *protected inventory* for diagnostics; lower-priority work may buy into them only when that protection is *released* (healthcare carve-out release) because diag demand is weak or the day is too close to keep waiting.

### 4.2 Model: category capacity at booking time (dispatch is separate)
**Scope.** The Resource Manager decides, for a *new booking*, **whether and when** a category of work can be taken — a capacity + lead-time question. It does **not** pin the job to a named technician. Loading the right job onto the right tech is day-of **dispatch** on the existing Workshop Board; §5.2 gives an *advisory* tech suggestion there, but it is **not** part of the booking gate.

So `canBook` works on **aggregated category capacity**, built by summing per-tech inputs:
```
# hours — the "book to %" ceiling
site_ceiling(d)      = Σ_t avail(t,d) × target_loading_pct
free_pool(d)         = site_ceiling(d) − Σ booked estimated_hours on d
cat_hours(c,d)       = Σ_{t can do c} avail(t,d) × target_loading_pct    # hours reachable for category c
cat_booked_hours(c,d), cat_booked_jobs(c,d)                              # from vw_diary_bookings
# job count — per-tech caps SUMMED into a shop-wide category ceiling
cat_job_ceiling(c,d) = Σ_{t can do c} daily_job_cap(t,c)  [∧ site hard_cap_jobs[c] if set]
                       # e.g. ≤5 diag/tech × 3 diag techs = 15 diagnostics/day
```
A category's **protected inventory** = held spare hours of its **primary** techs (`primary_supply`), decaying via §4.4. The per-tech `daily_job_cap` matters at booking time only as this *summed* ceiling; its per-tech granularity is used later at dispatch.

`value_rank` is **demoted** to a tie-break / reporting knob — protection size comes from `primary_supply`, not a hand-set rank.

### 4.3 Config knobs
Two homes, matching the two dimensions:

**Per category, per site — `resource_category_quotas`** (mostly *overrides* + physical caps; protection is auto-derived from staffing):
| Knob | Type | Meaning | Default |
|---|---|---|---|
| `value_rank` | int | Tie-break only (lower = preferred) | by sort_order |
| `protect_primary` | bool | Hold this pool's spare for its own work | true |
| `release_window_days` | int | Days over which the hold decays to 0 | 5 |
| `min_hours` | num | Optional *manual* floor on top of supply-derived protection (service-mix guarantee even if understaffed) | null |
| `hard_cap_jobs` / `hard_cap_hours` | num | Absolute **site** block (MOT bay slots, F-Gas) — usually backed by `resource_assets` | null |
| `enforcement` | enum | `soft` (warn+override) / `hard` (block) — **per category, per site** | soft |
| `allow_override` | bool | Advisors may exceed a soft cap | true |

**Per technician, per category — `technician_skills`** (the throughput throttle):
| Knob | Type | Meaning | Default |
|---|---|---|---|
| `is_primary` | bool | This is the tech's lane (their hours are protected for it) | false |
| `daily_job_cap` | int | Max jobs of this category this tech does/day (hard or soft per category enforcement) | null (∞) |
| `daily_job_target` | int | Soft "keep them at ~N" target for fill suggestions | null |
| `proficiency` | 1–5 | Skill fit for ranking | 3 |

### 4.4 The release (hold) curve
For each specialist pool `k` (techs with `primary = k`):
```
spare(k,d)     = Σ over primary-k techs t of max(0, hrs_ceiling(t,d) - hrs_used(t,d))
days_until     = d - today
time_factor(d) = clamp(days_until / release_window[k], 0, 1)          # 1 far out → 0 on the day
poolfill(k,d)  = clamp(booked_hours_in_pool(k,d) / (primary_supply(k,d) × target_loading_pct), 0, 1)
hold(k,d)      = spare(k,d) × time_factor(d) × poolfill(k,d)          # hours reserved for k's own future work
```
> Intuition: we keep a specialist's spare hours reserved **only if** there is still time for same-specialty demand to arrive (`time_factor` high) **and** that specialty is actually filling up (`poolfill` high). Tomorrow (time_factor→0) the hold collapses → release the diag tech to service so they aren't idle. A light diag book (poolfill→0) also collapses the hold → release. A busy diag book far out keeps the hold high → don't burn diag-tech time on oil changes.

A *manual* `min_hours[k]` (if set) adds a floor: `hold(k,d) = max(min_hours[k] × time_factor(d), spare-based hold)` — so you can still guarantee a service-mix floor even when understaffed in that lane.

### 4.5 Acceptance rule — `canBook(c, hours, d)` (category capacity; no tech pinned)
Order: skilled-hours feasibility → physical hard cap → category count throttle → protection → buffer.

```
1. SKILLED-HOURS FEASIBILITY (hard):
     if cat_hours(c,d) − cat_booked_hours(c,d) < hours:
        return DENY_HARD("not enough skilled capacity for {c} on d")    # e.g. no diag-capable hours left

2. SITE / PHYSICAL HARD CAP:
     if hard_cap_jobs[c]  and cat_booked_jobs(c,d)+1     > hard_cap_jobs[c]:  return DENY_HARD   # MOT bay
     if hard_cap_hours[c] and cat_booked_hours(c,d)+hours > hard_cap_hours[c]: return DENY_HARD

3. CATEGORY COUNT THROTTLE (per-tech caps, summed):
     if cat_job_ceiling(c,d) and cat_booked_jobs(c,d)+1 > cat_job_ceiling(c,d):
        enforcement[c]==hard → return DENY_SOFT("{c} at daily count limit; try another day")
        else                 → return WARN("{c} at daily count limit; override allowed")

4. PROTECTION (supply-driven nesting — the clever bit):
     protected_other = Σ over k ≠ c with protect_primary[k] of hold(k,d)      # §4.4
     allowance = free_pool(d) − protected_other
     if hours > allowance:
        enforcement[c]==hard or not allow_override[c] → return DENY_SOFT("would consume capacity held for {protected lanes}")
        else                                          → return WARN("uses time held for {lanes}; override allowed")

5. OVERBOOK BUFFER (physical):
     if hours > site_avail(d) × overbook_factor − booked(d): return DENY_HARD("day physically full")

6. return OK
```

A category's own lane is never protected against itself (`k ≠ c`), so any category can always fill the capacity you *staffed* for it; protection only stops *other* categories eating a specialist lane's still-held hours. The "book to %" ceiling is baked into `free_pool`/`cat_hours` via `target_loading_pct`.

### 4.6 Worked numeric examples (3 diag techs)

Staffing: **3 diag techs** (primary = Diagnostic, 8h each, `daily_job_cap = 5`), **2 service techs** (primary = Service, 8h each). `target_loading = 0.85` → `site_ceiling = 40×0.85 = 34h`; diag `cat_hours ≈ 24×0.85 = 20.4h`, `cat_job_ceiling[Diag] = 3×5 = 15` diags/day; standalone MOT physically capped at `hard_cap_jobs = 16` (one bay). `release_window = 5`.

**Example A — diagnostics fill the capacity you staffed (busy day, 5 days out).** 12 diags booked. A new **diagnostic** → step 3 count 13 ≤ 15 ✔, skilled hours remain ✔, diag isn't protected against itself → **OK**. You staffed for diag, so diag fills. ✔

**Example B — diagnostic count throttle fires.** 15 diags booked (each diag tech at 5). A 16th **diagnostic** → step 3, `cat_job_ceiling = 15` exceeded. Diag enforcement **hard** → **DENY_SOFT → recommend next day**; **soft** → **WARN**, advisor may override. This is your "≤5 evaluations per diag tech," summed to a shop-wide 15/day. ✔ *(diagram 2, top)*

**Example C — busy day protects the pool from a low-value MOT.** 5 days out, day filling so `free_pool` is small, and the diag lane is filling (`poolfill` high, `time_factor=1`) → `hold(Diag)` high. A new **standalone MOT (1h)**: `allowance = free_pool − hold(Diag) − hold(Service) ≈ 0` → **WARN/throttle** (don't offer this MOT online today, push to a lighter day; advisor override allowed). High-value/specialist capacity is protected. ✔ *(diagram 1, top)*

**Example D — light day tomorrow releases everything.** 1 day out (`time_factor=0.2`), diag book sparse (`poolfill≈0.2`) → `hold(Diag) ≈ 0`. Now `allowance ≈ free_pool` (large):
- A **big repair (8h)** → **OK**. Light book tomorrow accepts the profitable repair. ✔ *(diagram 1 + 2, bottom)*
- A **standalone MOT (1h)** → **OK**. On a light day we turn no one away. ✔

**Example E — MOT bay hard cap.** 16 MOTs booked (the one bay's ~25-min DVSA slots, backed by a `resource_assets` row). 17th MOT → step 2 → **DENY_HARD** regardless of hours/release. Physical reality enforced. ✔

### 4.7 Recommended-day function — `recommendDay(c, hours, skills, fromDate)`
```
for d in operating_days from (fromDate + lead_time_floor) forward, up to horizon:
    r = canBook(c, hours, d)                         # §4.5 (category capacity only)
    if r == OK:        candidates.push({d, grade: gradeSlot(d, ...)})  # §6
    if r == WARN:      softCandidates.push({d, reason})
    if len(candidates) >= N_ALTERNATIVES: break
recommended = candidates[0] (best grade) or softCandidates[0]
return { recommended, alternatives: candidates[1..k], softHints: softCandidates }
```
`gradeSlot` ranks among OK days by ASAP + even-loading (§6). Per-category lead time emerges naturally: a standalone MOT on a busy week keeps sliding to lighter days; a repair sees the earliest slot.

### 4.8 Cross-channel correctness
`free_pool`, `cat_hours`, and the category counters all read `vw_diary_bookings`, which already unions **GMS jobsheets + DMS health_checks**. Manual HC, jobsheet, online estimate booking, and DMS import therefore all decrement the **same category + site ledger** — the Tekmetric cross-channel guarantee (manual and online bookings can't jointly overbook). No double-counting (the view dedupes jobsheet-linked HCs). A booking's category for the counters = its `primary_repair_type_id` (§7.2); DMS bookings whose category can't be inferred count toward the site hours pool but no category quota (§10).

---

## 5. Technician Skills Model

### 5.1 Data model
Two new tables, following the `repair_types` lookup pattern and `users` multi-tenancy.

**`technician_skills`** — (technician × repair_type) capability matrix + per-tech throttle.
- `technician_id → users(id)`, `repair_type_id → repair_types(id)`
- `proficiency SMALLINT` 1–5 (1 apprentice … 5 expert)
- `is_primary BOOLEAN` — the tech's lane; their hours are *protected* for it (§4). A tech may have >1 primary (e.g. a senior who is primary for both diag and repair).
- `daily_job_cap SMALLINT` — **max jobs of this category this tech does per day** (the "≤ 5 diag evaluations per diag tech" throttle; null = no count limit). Soft or hard per the category's `enforcement`.
- `daily_job_target SMALLINT` — soft "keep them at ~N" target, drives fill suggestions/under-utilisation flags.
- `is_active BOOLEAN`
- UNIQUE(`technician_id`, `repair_type_id`)

**`technician_certifications`** — gating credentials with expiry.
- `technician_id → users(id)`
- `cert_type VARCHAR` (`mot_tester` | `ev_hv` | `f_gas` | free text)
- `reference VARCHAR`, `issued_date DATE`, `expires_date DATE` (null = never)
- `is_active BOOLEAN`

**`repair_types` extensions** (additive columns):
- `required_cert VARCHAR` (e.g. `mot_tester` for MOT type, `f_gas` for AC) — hard gate.
- `default_estimated_hours NUMERIC(5,2)` — fallback duration for capacity when no labour estimate (critical for DMS, §10).
- `booking_mode VARCHAR(10) NOT NULL DEFAULT 'drop_off'` — `drop_off` | `timed_slot` (§6.3).
- `slot_minutes INTEGER` — timed-slot length for `timed_slot` types (e.g. MOT 30, AC 60); null → derive from `default_estimated_hours`.

### 5.2 Tech suggestion — `suggestTechnician(repair_type_id, hours, date)` (dispatch advisory, NOT the booking gate)
**Separate from `canBook` (§4.5).** Booking only checks *category* capacity. `suggestTechnician` is used later — when a controller loads a job onto the Workshop Board, or as an optional assignment pre-fill — to propose *who* does it. It never blocks a booking.

```
# Phase 1 — Qualify (hard)
candidates = techs where:
    technician_skills row for repair_type_id (is_active)
    AND if repair_types.required_cert: holds valid (non-expired on date) cert
    AND has hours headroom that day
    AND under daily_job_cap for this category

# Phase 2 — Rank (prefer primary, least-loaded)
for t in candidates:
    primary_bonus = is_primary[t,c] ? 1 : 0
    skill_fit     = proficiency / 5
    qty_headroom  = daily_job_cap ? (cap - jobs_used)/cap : 1
    load_balance  = free_hours(t,date) / avail(t,date)
    score = w_primary*primary_bonus + w_skill*skill_fit + w_qty*qty_headroom + w_load*load_balance
return ranked candidates
```
Default weights `w_primary=0.4, w_skill=0.15, w_qty=0.15, w_load=0.3`: a primary, under-cap, least-loaded tech ranks top; a primary at their daily cap or fully booked yields to a free secondary — the fallback the owner described ("a service tech can repair but should mainly service"). The *overflow preference* (which work a quiet specialist backfills) is a dispatch-time policy and is **deferred** — it has no effect on booking.

Advisory in P1 (suggestion + the "why": primary / cap / load); auto-assign above a confidence threshold is a later phase.

### 5.3 Skill-segmented capacity feeds the quota
`primary_supply(c,s,d)` / `eligible_supply(c,s,d)` in §3.3 sum *only* skilled/certified techs' hours, so category capacity is **self-adjusting to staffing**: if a diag tech is off, that day's diag protection and qty ceiling shrink automatically (fewer protected hours, fewer `daily_job_cap` slots), and the release curve frees the remaining specialists' time sooner. Quotas never need manual day-by-day editing for absences — the rota drives them.

---

## 6. Lead-Time / Next-Available Recommendation

### 6.1 Inputs
`{ organization_id, site_id, repair_type_id, estimated_hours, required_skills?, fromDate?, leadTimeFloorDays? }`.
`estimated_hours` resolution for a *prospective* booking: caller's value → `repair_types.default_estimated_hours` → `service_types.default_hours` → org default 1.0.

### 6.2 Algorithm
```
floor = leadTimeFloorDays ?? org.booking_lead_time_days   # min notice
for d from (today + floor) to (today + horizon):          # horizon = booking_max_days
    if d not in operating_days: continue
    r = canBook(repair_type_id, hours, d)                 # §4.5
    grade = gradeSlot(d):
        asap   = 1 - (d - today)/horizon                  # sooner = higher
        spread = remaining_pool(s,d)/ceiling(s,d)         # emptier = higher (level loading)
        grade  = w_asap*asap + w_spread*spread            # w_asap=0.6, w_spread=0.4
    bucket r into OK / WARN
recommended = best-graded OK day
alternatives = next 2–3 best-graded OK days
fallbacks   = best WARN days (shown as "tight — override")
```
Per-category lead time falls out naturally: cheap MOTs get pushed to lighter days (their `allowance` is small on filling days), while high-value repairs see the earliest slot (rank 1, no protection above them).

### 6.3 Booking mode — drop-off (default) vs timed slot
Most UK garage work is **drop-off**: the car is left for the day and the customer just tells you *when they'll arrive*. A minority of work (MOT, air-con regas — short, bay-bound) is booked to a **timed slot**. The mode is a property of the **repair type** (`repair_types.booking_mode`), so once the day is chosen, the *time* step differs:

- **`drop_off` (default).** Capacity is the **day** (hours + category quota via `canBook` on `d`). After picking the day, the customer/advisor chooses a **drop-off time** from the site's **drop-off window** (`resource_site_config.dropoff_window_start..end`, e.g. 08:00–09:30, in `dropoff_slot_interval_minutes` steps). The drop-off time is an **arrival marker only** — it does *not* consume a timed slot. An optional `dropoff_slot_capacity` caps cars per drop-off time so they don't all arrive at 08:00 (smooths the front desk); null = unlimited.
- **`timed_slot`.** Capacity is the **slot**. After the day, offer concrete times generated from operating hours in `repair_types.slot_minutes` steps (falls back to `default_estimated_hours`), skipping taken/blocked times and respecting any bay `resource_assets` cap. This is the Garage-Hive time-grid behaviour for MOT/AC.

A booking's mode = its `primary_repair_type_id`'s mode. A drop-off job that also contains a timed line (service + MOT) is a drop-off booking; the timed line is handled in-day at dispatch. Both modes still decrement the same day-level hours + category ledger (§4.8) — the mode only changes the *time* UI, not the capacity maths.

### 6.4 Advisor override & recording
- The advisor UI always shows the **recommended** date pre-selected plus alternatives, but the date field is **freely editable**.
- If the advisor picks a date the engine returned WARN/DENY_SOFT for, we save the booking *and* record an override on the booking row.
- New columns on the booking parents:
  - `jobsheets.capacity_override BOOLEAN`, `jobsheets.capacity_override_reason TEXT`
  - `health_checks.capacity_override BOOLEAN`, `health_checks.capacity_override_reason TEXT`
- A nightly/weekly report counts overrides per category → signals a mis-tuned quota (frequent overrides on MOT ⇒ raise the cap).
- **Hard** denials (skill infeasible, MOT bay full, day physically full incl. buffer) cannot be overridden from self-serve online; staff can override skill/soft but never the physical bay/overbook ceiling.

---

## 7. Data Model / Migrations

All migrations are additive, `IF NOT EXISTS`, org-scoped, timestamp-named. New migration: **`20260629120000_resource_manager.sql`** (and follow-ups per phase).

### 7.1 New tables

```sql
-- Per-site capacity & loading config (one row per org+site)
CREATE TABLE IF NOT EXISTS resource_site_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID REFERENCES sites(id),
  target_loading_pct NUMERIC(4,3) NOT NULL DEFAULT 0.850,   -- book to 85%
  overbook_factor NUMERIC(4,3) NOT NULL DEFAULT 1.000,      -- 1/show_rate
  booking_lead_time_days INTEGER NOT NULL DEFAULT 0,        -- advisor min notice
  online_lead_time_hours INTEGER NOT NULL DEFAULT 24,       -- self-serve online min notice
  booking_max_days INTEGER NOT NULL DEFAULT 60,             -- horizon
  release_window_days INTEGER NOT NULL DEFAULT 5,           -- default protection decay window
  dropoff_window_start TIME NOT NULL DEFAULT '08:00',       -- morning drop-off band
  dropoff_window_end   TIME NOT NULL DEFAULT '09:30',
  dropoff_slot_interval_minutes INTEGER NOT NULL DEFAULT 15,
  dropoff_slot_capacity INTEGER,                            -- max cars per drop-off time (null = ∞)
  enable_skill_routing BOOLEAN NOT NULL DEFAULT false,
  enable_category_quotas BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, site_id)
);

-- Per-category (repair_type) quota rules per site. Protection size is auto-derived
-- from staffing (primary_supply); these are overrides + physical caps + enforcement mode.
CREATE TABLE IF NOT EXISTS resource_category_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID REFERENCES sites(id),
  repair_type_id UUID NOT NULL REFERENCES repair_types(id),
  value_rank SMALLINT NOT NULL DEFAULT 100,        -- tie-break only (lower = preferred)
  protect_primary BOOLEAN NOT NULL DEFAULT true,   -- hold this pool's spare for its own work
  release_window_days INTEGER NOT NULL DEFAULT 5,  -- days over which the hold decays to 0
  min_hours NUMERIC(5,2),                          -- optional manual mix-guarantee floor (on top of supply)
  hard_cap_jobs INTEGER, hard_cap_hours NUMERIC(5,2),  -- absolute SITE block (MOT bay / F-Gas)
  enforcement VARCHAR(8) NOT NULL DEFAULT 'soft',  -- 'soft' (warn+override) | 'hard' (block) — per category, per site
  allow_override BOOLEAN NOT NULL DEFAULT true,
  weekday_mask INTEGER NOT NULL DEFAULT 127,       -- which weekdays this rule applies (bitmask Mon..Sun)
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, site_id, repair_type_id)
);

-- Tech capability matrix + per-tech daily throughput throttle
CREATE TABLE IF NOT EXISTS technician_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  technician_id UUID NOT NULL REFERENCES users(id),
  repair_type_id UUID NOT NULL REFERENCES repair_types(id),
  proficiency SMALLINT NOT NULL DEFAULT 3,    -- 1..5
  is_primary BOOLEAN NOT NULL DEFAULT false,  -- the tech's protected lane
  daily_job_cap SMALLINT,                     -- max jobs of this category/tech/day (e.g. 5 diag) — null = ∞
  daily_job_target SMALLINT,                  -- soft "keep at ~N" target for fill suggestions
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(technician_id, repair_type_id)
);

-- Tech certifications (gating, expiry)
CREATE TABLE IF NOT EXISTS technician_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  technician_id UUID NOT NULL REFERENCES users(id),
  cert_type VARCHAR(40) NOT NULL,             -- mot_tester | ev_hv | f_gas | ...
  reference VARCHAR(80),
  issued_date DATE, expires_date DATE,        -- null expiry = never
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(technician_id, cert_type)
);

-- Optional: physical resources (MOT bay, ramps, loan cars) — see §12
CREATE TABLE IF NOT EXISTS resource_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID REFERENCES sites(id),
  asset_type VARCHAR(20) NOT NULL,            -- mot_bay | ramp | loan_car | waiter_seat
  name VARCHAR(60),
  quantity INTEGER NOT NULL DEFAULT 1,        -- e.g. 16 MOT slots, 3 loan cars
  is_active BOOLEAN NOT NULL DEFAULT true
);
```

### 7.2 Additive columns
```sql
ALTER TABLE repair_types
  ADD COLUMN IF NOT EXISTS required_cert VARCHAR(40),
  ADD COLUMN IF NOT EXISTS default_estimated_hours NUMERIC(5,2);

ALTER TABLE jobsheets
  ADD COLUMN IF NOT EXISTS capacity_override BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS capacity_override_reason TEXT;

ALTER TABLE health_checks
  ADD COLUMN IF NOT EXISTS capacity_override BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS capacity_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS primary_repair_type_id UUID REFERENCES repair_types(id);
  -- primary_repair_type_id: the booking's dominant category for quota counting
  -- (derived from main booking requirement / first booked repair group)
```

### 7.3 New RPCs (aggregate in SQL, dodge row cap)
- `resource_category_available_hours(org, site, d, repair_type_id) → NUMERIC` — §3.3.
- `resource_category_booked(org, site, d) → TABLE(repair_type_id, jobs, hours)` — §3.4 grouped.
- `resource_day_capacity(org, site, d) → JSONB` — bundles site_avail, ceiling, booked, per-category booked + quota state, for the diary/planner in one call.
- `resource_quota_state(org, site, from, to) → TABLE(...)` — range version for week/month planner.

Indexes: `idx_tech_skills_org(organization_id, repair_type_id, is_active)`, `idx_tech_certs_tech(technician_id, cert_type, expires_date)`, `idx_cat_quotas_site(organization_id, site_id, is_active)`.

### 7.4 Seeding (lazy, per org — mirror repair_types seeding in `routes/repair-types.ts`)
- On first Resource Manager access, insert a `resource_site_config` default row per site.
- Optionally seed `resource_category_quotas` from existing repair_types with sensible defaults (Service `min_hours` set, MOT `max_jobs`), `value_rank` = repair_type `sort_order`. All `enforcement='soft'`, quotas disabled (`enable_category_quotas=false`) until owner opts in.

---

## 8. API Surface (Hono)

All under `/api/v1/resource-manager`, auth via existing `authorizeMinRole` (`apps/api/src/middleware/auth.js`), org-scoped. New route file: `apps/api/src/routes/resource-manager.ts`, plus a shared service `apps/api/src/services/resource-capacity.ts` (the engine — used by routes *and* by the public estimate booking route).

### 8.1 Config
| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/config` | service_advisor | site config + category quotas (lazy-seed) |
| PUT | `/config` | site_admin | update `resource_site_config` |
| GET | `/quotas` | service_advisor | list category quotas |
| PUT | `/quotas/:repairTypeId` | site_admin | upsert one category quota |

### 8.2 Capacity / planner
| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/capacity/day?siteId&date` | service_advisor | `resource_day_capacity` bundle (load + quota counters) |
| GET | `/capacity/range?siteId&from&to` | service_advisor | week/month rollup |

### 8.3 Availability / recommendation (the engine)
| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/availability` | service_advisor | body `{siteId, repairTypeId, estimatedHours, requiredSkills?, fromDate?}` → `{recommended, alternatives[], softHints[]}` (§6) — booking gate |
| POST | `/can-book` | service_advisor | body `{siteId, repairTypeId, hours, date}` → `{status: OK|WARN|DENY_SOFT|DENY_HARD, reason}` (§4.5) — category capacity only |
| POST | `/suggest-technician` | service_advisor | body `{siteId, repairTypeId, hours, date}` → ranked tech suggestions (§5.2) — **dispatch advisory, does not gate booking** |

### 8.4 Skills admin
| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/technicians/:id/skills` | site_admin | matrix for one tech |
| PUT | `/technicians/:id/skills` | site_admin | replace skill rows (mirror `PUT /shifts/:technicianId` pattern in `workshop-board.ts:646`) |
| GET/POST/DELETE | `/technicians/:id/certifications` | site_admin | cert CRUD |

### 8.5 Public (estimate online booking) — wires into the deferred backend
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/public/estimate/:token/availability` | token | slot grid built from `resource-capacity.getAvailability()` (§10) |
| POST | `/api/public/estimate/:token/book` | token | re-validate via `canBook` then persist; returns confirmation |

Emit `WS_EVENTS.WORKSHOP_BOARD_UPDATED` on any write so the diary/board refresh live (existing pattern, `workshop-board.ts`).

---

## 9. UI

### 9.1 Resource Manager → Capacity & Config (new admin, per site, under Settings or its own nav)
- **Site capacity card** (rows, label-rail per `docs/form-design-guidelines.md`):
  - **Book to target loading** — slider, default 85% (drives `target_loading_pct`).
  - **Online lead-time floor** — preset chips `same day · 1h · 4h · 24h · 48h · 72h` (the Tekmetric menu) + custom; default 24h online. This is the *online* floor (advisor bookings can go same-day regardless).
  - **Drop-off window** — start/end time + interval (default 08:00–09:30, 15-min), with an optional "max cars per drop-off time" to smooth arrivals. This is the morning band offered for `drop_off` repair types (§6.3).
  - **Protection release window** — days (default 5).
  - **Booking horizon** — days (default 60).
  - **Overbook factor** — advanced; default 1.0, tuned later from DMS show-rate (§12).
  - Toggles: **skill-based capacity** (segment hours by skill) and **category quotas** (master switch; off = pure hours ceiling). Quotas default off until the owner opts in.
- **Category quota grid**: one row per `repair_type` (reuse the colour pills from `Settings/RepairTypes.tsx`). Columns: **booking mode** (drop-off / timed-slot toggle; timed reveals a slot-length field — set on the repair type), **protect** (toggle), **release** (days), **min hrs** (optional manual floor), **hard cap** (jobs/hours, site/physical), **enforcement** (soft/hard pill), and a read-only **staffed** column showing today's derived `primary_supply` h · summed `daily_job_cap` jobs — so the owner literally sees what their rota protects (a category with no primary tech reads "no primary tech"). `value_rank` reorder by drag. Inline edit.
- **"Test setup" validator** (Garage Hive pattern): flags categories with **no primary tech** (nothing staffed/protected), a `required_cert` no active tech holds, MOT type with no `required_cert`, hard caps below current bookings, `min_hours` exceeding staffed supply, etc. — each with jump-to-fix. Must pass before online booking can be enabled.

### 9.2 The planner / diary view (extend `BookingDiaryPage.tsx`)
- Keep the month/agenda/table/week views. Add per day:
  - **Load bar** keyed to `target_loading_pct` (green/amber/red) — reuse `BoardColumn.tsx:91` styling.
  - **Quota counters** chips: `MOT 4/16 · Diag 9/15 · Service 18/24h` (count and/or hours) coloured by headroom. Red when at hard cap, amber at soft, grey when protection is released.
  - **Underloaded flag** to drive fill.
- Tech sub-bars (the diary gap #3): per-tech booked vs available — a *visibility* aid for dispatch, fed by `resource_category_booked` broken down by assigned tech (booking itself stays category-level).
- Drag-to-book on the existing Timeline/Week views calls `can-book` and shows the WARN/DENY banner inline before committing (reuse dnd-kit + `firstFreeSlot` in `scheduling.ts`).

### 9.3 Booking flow integration

**(a) Advisor panel** — a `BookingDatePicker` component dropped into `NewHealthCheck.tsx` and `NewJobsheet.tsx` (and reused on Estimate convert-to-jobsheet). On category/hours change it calls `POST /availability` and renders:
- **Job summary row** — category colour pill + estimated hours + site.
- **Recommended date hero** (green tint): the date, a "next available" badge, a one-line reason (`9 of 15 diag slots · 62% loaded · diag tech free`), and a neutral-dark "Use this date" primary action (per `docs/form-design-guidelines.md` — `#16191f`, not `bg-primary`).
- **"Other good days"** — 2–3 alternative day chips with load %, click to select.
- **WARN/override row** (amber, only when the advisor picks a tight day): "tighter than recommended — {reason}", with an "Override" button that reveals a required reason field and stamps `capacity_override` + `capacity_override_reason`.
- **Manual date field** — a plain date input ("or pick any date"); choosing a date re-runs `can-book` and shows OK/WARN/DENY inline. Hard DENY (skill-infeasible, physical full) blocks save with the reason; soft is overridable.
- **Time control follows the mode** (§6.3): for `drop_off` types, a small **drop-off time** dropdown (defaulting into the drop-off window, but advisors may pick any time — they're not bound by it); for `timed_slot` types, an appointment-time picker. The advisor flow is day-first; the time is secondary.

**(b) Online customer picker** (`EstimatePortal/BookingFlow.tsx`, currently inert): swap `PREVIEW_AVAILABILITY` for live `GET /api/public/estimate/:token/availability`. The **time step adapts to the repair-type's `booking_mode`** (§6.3):
- **Day strip** (both modes) — each day shows remaining headroom or "full"/"closed"; full and out-of-lead-time days are disabled, not hidden-with-no-explanation.
- **Drop-off mode (default)** — after the day, a compact **"What time will you drop off?"** picker limited to the site drop-off window (e.g. 08:00–09:30 in 15-min steps); copy makes clear the car is left for the day. No full-day slot grid. A drop-off time at capacity (if `dropoff_slot_capacity` set) is disabled.
- **Timed-slot mode (MOT, AC regas, …)** — after the day, the **AM/PM time grid** of only-OK appointment times sized to `slot_minutes`; taken/blocked greyed.
- **Drop-off vs wait** toggle + **courtesy car** toggle (shows remaining count; disabled when the `loan_car` resource is exhausted — §12).
- **Confirm** names the chosen day + drop-off time / slot; a footnote states the online lead-time floor ("earliest is tomorrow — 24h notice online"). Strict self-serve: WARN/DENY days are never offered; `POST /book` **re-validates** with `canBook` before persisting (capacity can change between load and confirm).

**(c) Suggested-tech** (optional, *dispatch-side only*): when assigning on the board/job card, pre-fill the assignment dropdown from `suggest-technician` with a "why" tooltip (primary / cap / load), always overridable. Convenience at dispatch — not part of taking the booking.

### 9.4 Tech skills admin (new page or tab on user detail)
- Skills matrix editor: per tech, toggle each repair_type, set proficiency 1–5, mark **primary** (their protected lane), and set the per-day **job cap** + soft **target** inline (e.g. diag tech → Diagnostic primary, cap 5/day). Reuse `RepairTypes.tsx` colour pills. Certifications sub-section with expiry date + an "expiring soon" badge.
- A small **"staffed mix" preview** rolls the matrix up: "Diag 24h / 12 jobs · Service 16h" so the owner can see the day-shape their staffing implies before any quota tuning.

---

## 10. Integration Points

### 10.1 Estimates online booking (deferred availability backend)
This is the natural first consumer. `apps/api/src/services/resource-capacity.ts::getAvailability()` wraps the engine; `routes/public-estimate.ts` exposes the two endpoints `BookingFlow.tsx` already expects. The slot grid = forward scan of OK days/slots sized to the estimate's repair-type duration, honouring quotas + skill capacity + lead time. POST `/book` **re-validates** with `canBook` (capacity can change between load and confirm).

### 10.2 Jobsheets
`jobsheets.ts POST /:id/commit` calls `canBook` for `due_in_date`; if WARN and advisor proceeded, set `capacity_override`. The committed jobsheet's HC counts toward the ledger automatically via `vw_diary_bookings`.

### 10.3 Manual HC creation
`health-checks/crud.ts POST /` accepts an optional `dueDate`; the form's availability call feeds it. Stamp `primary_repair_type_id` (for quota counting) from the chosen main booking requirement / first booked group.

### 10.4 DMS import (Gemini) — graceful degradation
Two known gaps from `MEMORY/dms-import` and the codebase map:
- **Duration dropped / NULL.** When `estimated_hours` is NULL, capacity math must not silently undercount. Resolution ladder: `estimated_hours → repair_types.default_estimated_hours (mapped from booked_service_type) → service_types.default_hours → resource_site_config implicit default 1.0`. Backfill is *not* destructive — compute on read in `vw_diary_bookings` (already partly does this).
- **No MOT flag.** Reuse the existing `is_mot_booking` inference (the `MOT Labour` line heuristic + `service_types.is_mot`) to map a DMS booking to the MOT category for quota counting. Where category can't be inferred, treat as "Unassigned" (counts toward total hours, not toward any per-category quota) — never block a DMS import on capacity (imports are *facts*, not requests). DMS bookings consume capacity but are **never rejected**; they can push a day red, which the diary surfaces for manual rebalancing.

### 10.5 Workshop board (dispatch)
The board (`WorkshopBoard.tsx`) stays the day-of execution view. Its load bars now read the same `resource_day_capacity` bundle, so planning and dispatch agree. Card moves still emit `WORKSHOP_BOARD_UPDATED`.

---

## 11. Phased Delivery Plan

**P0 — Capacity ceiling + diary banding — ✅ BUILT 2026-06-28 (uncommitted; type-clean).**
`resource_site_config` (migration `20260629120000_resource_manager_p0.sql`); `services/resource-config.ts` (`loadSiteConfig` + `computeBand`); `routes/resource-manager.ts` (GET/PUT `/config`); Booking-Diary endpoints enriched with `band` + `ceilingHours` keyed to `target_loading_pct` (+ a `low` "underloaded" band); diary day cells/bars colour by the server band; new `Settings/ResourceManager.tsx` admin (loading target, lead times, drop-off window) wired into router + SettingsHub. No quotas, no skills. Degrades gracefully pre-deploy (missing table → defaults; missing band → legacy 85% tone). Goes live on push to dev (migration runs in the pipeline).

**P1 — Skills model + suggest-technician (advisory) — ✅ BUILT 2026-06-28 (uncommitted; type-clean).**
Migration `20260629130000_resource_manager_p1.sql`: `technician_skills` (proficiency, is_primary, daily_job_cap, daily_job_target), `technician_certifications` (cert_type + expiry), repair_types `required_cert` + `default_estimated_hours`. API (`routes/resource-manager.ts`): `GET /skills` (whole matrix in one call), `PUT /technicians/:id/skills`, `POST /technicians/:id/certifications`, `DELETE /certifications/:id`, `POST /suggest-technician` (advisory: qualify by skill+valid cert, rank by primary+proficiency). Web: new `Settings/TechnicianSkills.tsx` (master-detail matrix + certs) wired into router + SettingsHub. **Suggest-technician pre-fill wired into the Workshop Board `JobDetailModal`** — `suggest-technician` also accepts a `healthCheckId` and resolves the job's repair type server-side (first priced `repair_items.repair_type_id`); the modal shows clickable suggested-tech chips (★ primary, "why" tooltip) that assign via the existing column move. Chips appear only for jobs with a priced repair type. *Remaining for later:* live load-balancing in the ranker (arrives with the P2 capacity RPCs); HC/jobsheet creation-time pre-fill (no category at creation).

**P2 — The quota engine (centrepiece) — ✅ ENGINE + CONFIG BUILT 2026-06-28 (uncommitted; type-clean).**
Migration `20260629140000_resource_manager_p2.sql`: `resource_category_quotas`; `health_checks`/`jobsheets` `primary_repair_type_id` + `capacity_override` + reason; RPC `resource_skill_capacity` (per-repair-type primary/eligible hours + summed job cap, mirrors `diary_available_hours`). Engine `services/resource-capacity.ts`: `getDayCapacity` (per-category supply + quota + booked + decaying `hold`), `canBookOnDay`/`canBook` (§4.5 — guarded: quotas off → P0 hours ceiling), `recommendDay` (§6). Category-booked resolved via `primary_repair_type_id` → first priced repair item → MOT inference → uncategorised. API: GET/PUT `/quotas`, GET `/capacity/day`, POST `/can-book`, POST `/availability`. Web: editable category-quota grid + enable toggle + staffed readout in `Settings/ResourceManager.tsx`. Quotas default **off**; opt in per site.

**P2.1 — ✅ PARTLY BUILT 2026-06-28 (uncommitted; type-clean):**
- ✅ **Diary category-counter chips** — `GET /capacity/day` enriched with per-category meta (label/colour/`hoursCeiling`/`jobCeiling`/`hardCapJobs`); the diary day drill-in (`BookingDiary/shared.tsx`) renders `MOT 4/16 · Diag 9/15` chips coloured by headroom.
- ✅ **`primary_repair_type_id` stamping at pricing** — when a top-level work group's repair type is set (`repair-items/repair-items.ts` PATCH), the parent HC/jobsheet's `primary_repair_type_id` is stamped first-category-wins (best-effort). Combined with the `getCategoryBooked` ladder (which already reads priced repair items + MOT inference), category-booked is now accurate for priced + MOT jobs.

**Still remaining:** booking-form `availability`/`canBook` integration + override capture (blocked for HC *creation* — no category is chosen there; lands naturally with P3 online booking, where the customer's service implies a category; a hard MOT-bay cap already bites via `quota.hardCapJobs` wherever `canBook` is called); WARN banners on the booking forms; create-time stamping for the few non-PATCH type paths (`apply-service-package`, auto-create); `resource_assets` for loan-car/waiter-seat resources; live load-balancing in `suggestTechnician`.

**P3 — Online booking go-live + lead time.**
Wire `getAvailability` into `public-estimate.ts`; flip `BookingFlow.tsx` from preview to live; lead-time floor + horizon enforced; strict self-serve, advisor override on internal forms.

**P4 — Physical resources + overbooking + reporting.**
`resource_assets` (MOT bay, loan cars, waiter seats as separate per-day caps); `overbook_factor` tuned from DMS show-rate; utilisation/efficiency/override reports; what-if simulation.

Each phase is independently deployable and reversible (additive migrations, feature-flagged via `resource_site_config` toggles and `organization_settings.features_enabled`).

---

## 12. Additional Ideas (prioritised beyond the 3 asks)

**High value, cheap:**
1. **MOT bay / loan car / waiter seat as separate per-slot resources** (`resource_assets`). MOT bay = the real hard cap; loan cars cap concurrent courtesy bookings (`health_checks.loan_car_required`); waiter seats cap concurrent waiters (`customer_waiting`). All layered on the hours model as independent counters.
2. **Override analytics** — count `capacity_override` per category to auto-suggest quota retuning. Falls out of P2 for free.
3. **Utilisation / productivity / efficiency reporting** — wire the job-clocking actuals (`technician_time_entries`) against sold hours per tech/site. Calibrates `target_loading_pct` from real proficiency (NADA 125% pattern) instead of guessing. Reuse the repair-type report service pattern.

**Medium:**
4. **Overbooking buffer from show-rate** — compute per-site show-rate from DMS `arrivalStatus` / no-show transitions; set `overbook_factor` to recover empty-bay loss (~5% pad to start).
5. **No-show → waitlist / fill** — when a day frees up (cancel/no-show), surface released capacity and offer it to deferred Follow-Up cases (`follow_up_cases`) or pending estimate bookings (in-day re-optimisation).
6. **Parts-availability gating** — a soft block: jobs with `awaiting_parts` repair items can't be auto-recommended a date earlier than expected parts arrival (needs a parts ETA field — defer until Parts module).
7. **Courtesy reschedule** — when capacity drops (tech absence added), list affected bookings and one-click rebalance via `recommendDay`.

**Lower / later:**
8. **What-if capacity simulation** — a read-only sandbox over `workshop_tech_shifts` ("if we hire 1 diag tech, +X bookable diag hours/day").
9. **Per-time-window quotas** (quick work AM, big work mid-morning) — extend quotas with a time-block dimension. Only if owners ask.
10. **Multi-site routing** — recommend a sibling site when the home site is full.

---

## 13. Open Questions / Decisions for the Owner

1. ~~**Category value ranking**~~ **RESOLVED (2026-06-28): supply-driven, not a hand-set rank.** Protection is sized from staffing (`primary_supply`) — keep specialists on their specialty — and category count is throttled by per-tech `daily_job_cap` summed (e.g. ≤ N diag evaluations per diag tech/day → shop-wide ceiling). `value_rank` is a tie-break/reporting knob only. **Booking decides category capacity only; it does not pick a tech** — tech assignment ("overflow preference", who-does-what) is a *dispatch-time* concern on the Workshop Board and is deferred (§5.2).
2. ~~**Hard vs soft category cap**~~ **RESOLVED (2026-06-28): both, configurable per category per site** (`resource_category_quotas.enforcement = soft|hard`). Per-tech `daily_job_cap` inherits the same mode. *Follow-up:* what should the house default be — soft (warn+override) for all, with hard reserved for MOT-bay/physical only?
3. **Default `target_loading_pct`** — 85% is the industry sweet spot; some workshops run hotter. Per-site, but what's your house default?
4. **`min_hours` service guarantee** — how many hours/day must always be reserved for bread-and-butter service? This is the single most important "protect the mix" number.
5. **Release window** — is 5 days the right horizon over which protection decays? Garages with longer lead times may want 10–14.
6. **Skill granularity** — is per-`repair_type` capability enough, or do you need finer (e.g. "diagnostics on hybrids" vs "diagnostics on diesel")? Per-repair-type is far simpler and matches your existing data.
7. **Auto-assign vs advisory** — start advisory (advisor confirms the recommended tech) or auto-assign above a confidence threshold? Recommend advisory for P1.
8. **DMS bookings and quotas** — confirm DMS imports should *never* be rejected (only surfaced when over capacity). We assume yes (imports are facts).
9. **Lead-time floor for online vs internal** — should self-serve online have a longer min-notice (e.g. 24h) than advisor bookings (same-day)? Common pattern; needs your call.

---

*Key files this builds on:* capacity math `apps/web/src/pages/WorkshopBoard/types.ts:196` + `supabase/migrations/20260625120000_booking_diary.sql` (`diary_available_hours`, `vw_diary_bookings`); categories `supabase/migrations/20260628130000_repair_types.sql` + `apps/api/src/routes/repair-types.ts`; shifts `supabase/migrations/20260624130000_workshop_tech_shifts.sql` + `apps/api/src/routes/workshop-board.ts:646`; diary UI `apps/web/src/pages/BookingDiary/BookingDiaryPage.tsx`; booking flows `apps/web/src/pages/HealthChecks/NewHealthCheck.tsx`, `apps/web/src/pages/Jobsheets/NewJobsheet.tsx`, `apps/web/src/pages/EstimatePortal/BookingFlow.tsx` + `apps/api/src/routes/public-estimate.ts`.