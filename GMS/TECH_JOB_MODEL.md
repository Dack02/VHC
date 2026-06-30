# VHC — Technician ↔ Job Model & Operating Mode

> Status: **Draft v2 (verified).** Author: Principal Eng + Product. Date: 2026-06-29.
> Decision brief approved by owner 2026-06-29 (3 forks resolved — §2). v2 revised after an adversarial verification pass (6 reviewers vs the real codebase) — see §0 changelog.
> Builds on: [`GMS/JOBSHEET.md`](JOBSHEET.md), the technician job-clocking initiative (`supabase/migrations/20260614000000_technician_job_clocking.sql`), [`GMS/RESOURCE_MANAGER.md`](RESOURCE_MANAGER.md), [`GMS/ESTIMATES.md`](ESTIMATES.md), and the `parts_mode` module/setting precedent (`supabase/migrations/20260630100000_parts_module_settings.sql` + `apps/api/src/routes/organizations.ts`).

---

## 0. What verification changed (v1 → v2)

A 6-agent review checked every concrete codebase claim. **Confirmed correct:** all core schema claims, all clocking claims, all UI/kickoff claims (see inline citations). **Corrected in v2:**

- **C1 (blocker) — module/mode direction was inverted.** v1 said `operating_mode` *drives* the jobsheets module "like `parts_mode`." Reality: the **module gates the mode** (the parts coercion lives in `organizations.ts`, not `modules.ts`; `modules.ts` never reads a `*_mode` column). §4 now follows the real direction.
- **C2 (major) — board / suggest-technician / efficiency are health-check-only.** VHC-less jobsheets don't appear on them. v2 adds **§7 (re-anchoring)** as a first-class workstream.
- **C3 (major) — backfill hazards.** `organization_settings` rows are lazily created (column DEFAULT won't reach row-less orgs); shell-jobsheet inserts fire the reference trigger (burns JS numbers). §5/§12 fixed.
- **C4 (major) — gaps added:** tech-assignment permissions (§10), open-timer cutover (§8.4), billing/shell visibility (§11), inspection-line `jobsheet_id` stamping for the completion gate (§9).
- **C5 — internal contradictions closed:** line grain = `repair_items` (decided, §6.2), shell flag = `is_shell` (decided, §5), double-count rule = "one active productive segment per tech" (decided, §8.3).

---

## 1. Problem & Vision

Today the **health check (VHC) is the de-facto unit of work**: a technician is assigned to it (`health_checks.technician_id`), clocks onto it (`technician_time_entries.health_check_id`), and completes it (`status = tech_completed`). But the **jobsheet** is meant to be the job; the VHC is one component.

This mismatch causes: a tech can't clock a whole job; a jobsheet with no VHC (estimate conversions, "Requires VHC" unticked) has nowhere to hang a tech and is invisible to the workshop floor; labour lines have no completion state.

**Target:** the **jobsheet is the unit of work**. A technician links to and clocks onto the *jobsheet*; the health check is a contained child that generates sellable work lines. This matches the universal GMS/DMS model (§16) and the owner's framing:

> *"Techs need to be linked to job sheets… clock on to a job sheet and their whole time will be checked on a job sheet… tech will mark labour lines as complete in the job sheet, and the health check is just something that goes within the job."*

The change is **additive** — the jobsheet already is the parent, work lines already point at it (`repair_items.jobsheet_id`, verified), and the VHC is already a nullable child (`health_checks.jobsheet_id`, verified nullable). What it is *not* is small: the board/suggestion/efficiency surfaces and the mobile app are health-check-anchored and need real work (§7, §14).

**Two directions, both first-class:**
- *Every health check has a jobsheet* (the new invariant — §3). A VHC-only org's standalone check gets a hidden shell jobsheet.
- *A jobsheet may have no health check* (already true today — estimate conversions, VHC-unticked bookings). These must get techs, clocks, board presence, and completion just like VHC-backed jobs.

---

## 2. Resolved decisions (owner, 2026-06-29)

| # | Fork | Decision | Implication |
|---|---|---|---|
| **A** | Tech grain | **Jobsheet + per labour line** | Primary tech on the jobsheet **and** an optional per-line tech. Per-line completion core. Line grain = `repair_items` (§6.2). |
| **B** | VHC-only model | **Hidden shell jobsheet — one model** | Every check lives in a jobsheet. VHC-only hides the GMS chrome; not a separate code path. One-time backfill (§5). |
| **C** | Mode control | **Super-admin gate, admin-visible** | The **`jobsheets` module is the super-admin master gate**; `operating_mode` is coerced *by* it and shown read-only (corrected direction — §4). |

---

## 3. Target entity model

```
jobsheets                         ← THE JOB (unit of work)  — may or may not have a child VHC
  ├─ advisor_id          → users          (exists)
  ├─ assigned_technician_id → users        (NEW — primary tech, fork A)
  ├─ customer_id, vehicle_id, site_id      (exists)
  ├─ is_shell            BOOLEAN           (NEW — hidden VHC-only shell; §5)
  ├─ health_checks  (0..1 child VHC via health_checks.jobsheet_id)   (exists, nullable)
  └─ repair_items   (work lines / operations, already jobsheet_id-polymorphic)
        ├─ assigned_technician_id → users   (NEW — per-line tech, fork A)
        ├─ work_completed_at / work_completed_by  (EXISTS, tech-permitted — verified)
        ├─ repair_labour (hours, rate, total)     (exists; no status today — verified)
        └─ repair_parts                            (exists)

technician_time_entries           ← THE CLOCK (per tech, per category)
  ├─ technician_id      → users            (exists)
  ├─ health_check_id    → health_checks    (exists, ALREADY NULLABLE — verified)
  └─ jobsheet_id        → jobsheets        (NEW — clock keys off the job)
```

**Invariant (fork B):** every `health_checks` row has a non-null `jobsheet_id`. Downstream (clock, completion, board, reporting) therefore reasons about the **jobsheet** — and must also handle the jobsheet-with-no-VHC case.

---

## 4. Operating mode (VHC-only vs full GMS) — *corrected direction*

### 4.1 How the codebase actually works (verified)
There is **no** "setting drives module" precedent. The real `parts` pattern is **module → mode**:
- `apps/api/src/services/modules.ts` resolves the module set **only** from `subscription_plans.features` + `organization_settings.module_overrides` + registry `defaultOn` (3-tier fallback). It never reads a `*_mode` column.
- `apps/api/src/routes/organizations.ts:308-312` then **coerces the mode down** to the safe value when the module is off: `parts_mode = (stored==='full' && mods.parts_stock) ? 'full' : 'simple'`.

So the **module is master, the mode is a coerced reflection**. We follow that exact direction (it honours decision C's UX — super-admin controls it, client sees one read-only mode — with near-zero new resolver code).

### 4.2 The setting
```sql
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS operating_mode TEXT NOT NULL DEFAULT 'vhc_only'
    CHECK (operating_mode IN ('vhc_only','gms'));
```
- **Master gate (super-admin):** the existing `jobsheets` module key (registry `defaultOn:false`, `apps/api/src/lib/modules.ts:54`; set via `PATCH /admin/organizations/:id/modules`). Note: `jobsheets` is **not** in `subscription_plans.features` today (the `20260616120000` backfill seeded only 9 keys), so it resolves via `module_overrides` ?? registry default-off — confirm a plan/override path before relying on it.
- **Coercion (mirrors parts, in the org-settings write/read path — NOT `modules.ts`):** `operating_mode = (stored==='gms' && mods.jobsheets) ? 'gms' : 'vhc_only'`. Turning the module off auto-reverts the org to `vhc_only`.
- **Read-time safety (C3):** `organization_settings` rows are created **lazily** (`org-admin.ts:40-58` get-or-create; same pattern in onboarding + 6 other settings routes), so a column `DEFAULT` does **not** reach orgs with no row. The app must **COALESCE a missing `operating_mode` to `'vhc_only'` at read time**, and the P0 migration should UPSERT a settings row per org (don't rely on the DEFAULT alone).
- **App use:** read the (coerced) `operating_mode` to decide which chrome to render. The client sees it read-only ("Operating mode: VHC-only / Full GMS"); super-admin flips the underlying module.

### 4.3 What the mode changes
| | `vhc_only` | `gms` |
|---|---|---|
| Top-level artefact (to the user) | the **VHC** | the **jobsheet** |
| Under the hood | VHC in a **hidden shell jobsheet** (`is_shell=true`) | VHC is a child of a **visible** jobsheet |
| Default create surface | New Health Check | New Jobsheet (booking → optional VHC) |
| GMS nav / jobsheet & invoice lists | hidden; **shells excluded** (§11) | shown |
| Tech + clock | on the (hidden) jobsheet | on the jobsheet |

Both modes produce a jobsheet + a tech + a clock; only the chrome differs.

---

## 5. The hidden shell jobsheet (fork B mechanics)

When a VHC is created with no jobsheet (today's standalone path, `health-checks/crud.ts`), the API **spawns-or-attaches a lightweight shell jobsheet** and sets `health_checks.jobsheet_id`:

```sql
ALTER TABLE jobsheets ADD COLUMN IF NOT EXISTS is_shell BOOLEAN NOT NULL DEFAULT false;
```

- Carries org/site/customer/vehicle copied from the VHC; `is_shell=true`. No booking/service-type ceremony.
- **Reference-trigger hazard (C3, verified `20260623200000:25-61`):** `trg_generate_jobsheet_reference` fires on *every* jobsheet insert and only checks `is_draft` — a non-draft shell would **burn a jobsheet number per legacy VHC** and mutate `next_jobsheet_number`. **Fix: teach the trigger to skip `is_shell` rows** (preferred — keeps draft semantics clean), so shells get no JS reference.
- **Consumers that must exclude shells (C3):** every surface currently filtering `is_draft=false` must *also* exclude `is_shell=true` — `GET /jobsheets`, `/jobsheets/stats` tiles (`jobsheets.ts:350`), `vw_diary_bookings`, booking-attribution views, and the invoice path/lists (§11). Do this **atomically with the backfill** so shells never leak.
- **Backfill (idempotent, non-destructive):** for existing `health_checks WHERE jobsheet_id IS NULL`, insert a shell + set `jobsheet_id`, guarded by `WHERE jobsheet_id IS NULL` / `WHERE NOT EXISTS` (**not** `ON CONFLICT` — there's no unique VHC↔shell key). Only `jobsheets.organization_id` is NOT-NULL-without-default and it's always present on the source VHC (verified) — no FK/NOT-NULL blocker. Per repo DB rules this is a one-way data event: land the trigger fix + every consumer filter *before* running it.

---

## 6. Technician linkage (fork A — jobsheet + per-line)

### 6.1 Primary tech on the jobsheet
```sql
ALTER TABLE jobsheets
  ADD COLUMN IF NOT EXISTS assigned_technician_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS tech_assigned_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_jobsheets_assigned_technician ON jobsheets(assigned_technician_id);
```
The job's owner — the "whole time on a job sheet" tech. Mirrors the existing `advisor_id`.

### 6.2 Per-line tech — grain = `repair_items` (decided)
The "line" a tech owns and completes = the **`repair_items`** work line/operation (labour+parts hang under it; it already carries `work_completed_*`). Finer `repair_labour`-level tech is a future option, not v1.
```sql
ALTER TABLE repair_items ADD COLUMN IF NOT EXISTS assigned_technician_id UUID REFERENCES users(id);
```

### 6.3 Reconcile, don't duplicate
- Keep `health_checks.technician_id` **mirrored** with `jobsheets.assigned_technician_id` during P1–P3 (so existing VHC/board/mobile reads keep working), then retire the mirror at P5 when the jobsheet is sole truth.
- The Workshop Board tech columns and `suggest-technician` advisory ([`RESOURCE_MANAGER.md`](RESOURCE_MANAGER.md) §5.2) drive day-of assignment — but they are **health-check-anchored today** and need the §7 re-anchoring, not a field swap.

---

## 7. Board, suggestion & efficiency re-anchoring (the big one — C2)

> **This is a first-class workstream, not a footnote.** The workshop board, `suggest-technician`, and the efficiency report read **exclusively** from `health_checks`. VHC-less jobsheets (estimate→jobsheet conversion — `estimate-convert.ts:137` creates a jobsheet with no VHC; or "Requires VHC" unticked — `jobsheets.ts:565`) have **no `health_checks` row** and therefore today never appear on the board, get no tech suggestion, and have no computable efficiency. The plan's core value (techs/clocks/completion on *any* job) depends on fixing this.

- **Workshop board jobsheet-inclusive.** The board (`workshop-board.ts` `HC_CARD_SELECT`; `clockedOnByHc` keyed by `health_check_id`) must surface **VHC-backed *and* VHC-less jobsheets** — either union `health_checks` + shell-less jobsheets, or re-base the board card source on `jobsheets` with the VHC as an optional join. Also fix the multi-tech live indicator (`clockedOnByHc` is last-writer-wins → make it a list keyed by job). Touches `WeekView`, tiles, day-sheet.
- **`suggest-technician` jobsheet branch.** Today it takes `healthCheckId` and resolves the repair type via `repair_items.health_check_id` (`resource-manager.ts:339-345`). Add a `jobsheetId` branch resolving via `repair_items.jobsheet_id` so VHC-less jobs get suggestions.
- **Efficiency report sold-side.** `report_technician_efficiency` (`20260624125000`) computes **sold** hours by joining `workshop_cards.health_check_id = hc.id` and grouping by `hc.technician_id`. VHC-less jobsheets have no `health_checks`/`workshop_cards` row, so sold-hours/efficiency is uncomputable. §8 only re-anchors the *clocked* side — the **sold side must also be re-anchored to the jobsheet** for this to work end-to-end.

---

## 8. Time-clocking re-home

### 8.1 In our favour (verified)
- `technician_time_entries.health_check_id` is **already nullable** (`20260614000000:40`).
- Multi-tech storage + summation already work (each segment carries its own `technician_id`).
- `technician_time_entries.jobsheet_id` does **not** exist yet (correctly new).

### 8.2 The change
```sql
ALTER TABLE technician_time_entries ADD COLUMN IF NOT EXISTS jobsheet_id UUID REFERENCES jobsheets(id);
CREATE INDEX IF NOT EXISTS idx_tte_jobsheet ON technician_time_entries(jobsheet_id);
```
- New `POST /jobsheets/:id/clock-in|out|indirect` mirroring the HC endpoints (`status.ts:845`).
- Aggregation (board + efficiency) groups by `COALESCE(jobsheet_id, jobsheet_via_hc(health_check_id))`.
- Backfill `jobsheet_id` on existing entries from `health_checks.jobsheet_id`.
- HC clock endpoints stay live (delegating) during transition.

### 8.3 Double-count rule (decided)
When a jobsheet contains a VHC, a tech must not separately clock the jobsheet *and* the VHC as productive time. Rules:
- **HC inspection time rolls up into the jobsheet total as a labelled "inspection" slice.** (Verified nuance: `healthCheckMinutes` is a *subset* of `jobMinutes` — `status.ts:1385-1386` adds every productive segment to `jobMinutes` and additionally to `healthCheckMinutes` when `is_health_check`. So it's already "total + labelled slice," exactly what we want.)
- **Enforce one active productive segment per technician** (no concurrent jobsheet + VHC productive timers). *This is the actual double-count guard — committed, not optional.*

### 8.4 Open-timer cutover (C4)
At the P3 switch, entries may be **open** (`clock_out_at IS NULL`, `health_checks.active_time_entry_id` set). Procedure: backfill `jobsheet_id` on **open** entries too (from `health_checks.jobsheet_id`); ensure `COALESCE` aggregation counts each open segment once; do not retire legacy fns (§8.5) until all pre-cutover open segments are closed. A reconciliation check (sum-by-HC vs sum-by-jobsheet) must match before P5.

### 8.5 Legacy retirement (P5)
Once jobsheet-keyed summation is sole truth, deprecate `clock_technician_in/out`, `health_checks.total_tech_time_minutes`, `health_checks.active_time_entry_id` (stop reading/writing; leave columns — additive-safe).

---

## 9. Labour-line completion (fork A — core)

### 9.1 What exists (verified)
- `repair_items.work_completed_at` + `work_completed_by` — **tech-permitted** work-done flag (`repair-items-hc.ts:9-36`, role list includes `technician`), wired on web (`RepairItemRow.tsx`, HC-scoped). **The foundation.**
- `repair_items.labour_status` + `labour_completed_*` = advisor **pricing** signal (`repair-items/labour.ts:613-636`, technician **excluded**). **Not** completion — don't conflate.
- `repair_labour` has **no** status today.

### 9.2 The build
1. **Generalise "work done" to the jobsheet:** `POST /jobsheets/:id/repair-items/:itemId/work-done` (the HC-scoped version breaks for VHC-less jobsheets; the invariant guarantees a jobsheet to scope to).
2. **Per-line tech** via `repair_items.assigned_technician_id` (§6.2); optional `repair_items.line_status ('pending'|'in_progress'|'complete')` if finer than done/not-done is wanted.
3. **Inspection-line reconciliation (C4):** inspection-generated `repair_items` carry `health_check_id`, not `jobsheet_id`. The jobsheet-scoped completion gate would miss them. **Stamp `jobsheet_id` on inspection lines** (the OR-based `repair_items_parent_chk` permits both parents — verified) going forward + backfill existing, OR have the gate union via the child HC. Recommend stamping `jobsheet_id`.
4. **Job completion = derived:** all **non-declined** work lines on the jobsheet completed → drives the board `work_complete` job_state (auto vs manual is §17-5).

### 9.3 The real cost: mobile (§14)
The mobile tech app has **no** per-line completion UI today (all-or-nothing `authorized → completed` — verified). Per-line tick + per-line claim are **net-new mobile screens** on top of the endpoints. Largest single cost.

---

## 10. Permissions (C4)

Today `PATCH /jobsheets/:id` is `authorize(['super_admin','org_admin','site_admin','service_advisor'])` — **technicians excluded** (`jobsheets.ts:972`). But the work-done tick already allows technicians (`repair-items-hc.ts`). So:
- **Primary tech assignment** (set `jobsheets.assigned_technician_id`): advisor+ (existing PATCH role set). A tech does not assign the job owner.
- **Claim / complete a line** (set `repair_items.assigned_technician_id` to self, set `work_completed_*`): **technician-permitted**, via a dedicated tech-allowed endpoint (e.g. `POST /jobsheets/:id/repair-items/:itemId/claim` + the generalised `work-done`), **not** the advisor-only `PATCH /jobsheets/:id`. Define the self-assign rule (claim only unassigned/own lines).

---

## 11. Billing & visibility (C4)

Universal shell jobsheets must not leak into commercial surfaces:
- **Shells are never invoiceable and never listed.** `invoiceJobsheet` (`jobsheets.ts:1445`) and all jobsheet/invoice lists must exclude `is_shell=true` (§5). A VHC-only org must not see invoice/jobsheet nav even though every VHC now has a (hidden) jobsheet — gate the nav on `operating_mode='vhc_only'` *and* exclude shells from lists.
- **Completion ≠ billing.** Line completion is operational; it does not gate invoicing (clock≠billing — §16-4). Keep them independent.
- **Commercial coherence:** confirm a VHC-only org (which may lack the `jobsheets` module commercially) cannot reach the invoice path via its hidden shells.

---

## 12. Migrations (additive, `IF NOT EXISTS`, safe)

Timestamps illustrative; each must clear the latest applied (≈ `20260630160000` → use `20260701…`+; MEMORY ordering gotcha).

| Migration | Adds |
|---|---|
| `20260701141000_operating_mode.sql` | `organization_settings.operating_mode` + **UPSERT a settings row per org** + module→mode coercion in the settings route (mirror `organizations.ts` parts pattern); read-time COALESCE→`vhc_only` |
| `20260701142000_jobsheet_tech.sql` | `jobsheets.assigned_technician_id`, `tech_assigned_at`, index |
| `20260701143000_jobsheet_shell.sql` | `jobsheets.is_shell`; **teach `trg_generate_jobsheet_reference` to skip `is_shell`**; backfill standalone VHCs → shell jobsheets (guarded `WHERE jobsheet_id IS NULL`); update all `is_draft`-filtered consumers to also exclude `is_shell` |
| `20260701144000_clock_jobsheet.sql` | `technician_time_entries.jobsheet_id`, index, backfill (incl. open entries); board/efficiency aggregation → `COALESCE` |
| `20260701145000_tech_efficiency_jobsheet.sql` | jobsheet-level tech efficiency aggregation |
| `20260701150000_line_completion.sql` | `repair_items.assigned_technician_id` (+ optional `line_status`); stamp `jobsheet_id` on inspection lines + backfill |
| (code) board / suggest-technician / efficiency **re-anchoring** (§7) — RPC + route changes, no destructive DDL |

No destructive ops (repo rule). Verify target-env columns first (prod schema can lag the repo — MEMORY).

---

## 13. API surface

| Method | Path | Notes |
|---|---|---|
| GET/PUT | `/admin/organizations/:id/operating-mode` | super-admin gate (via module); org-admin read-only |
| PATCH | `/jobsheets/:id` (extend) | set/clear `assigned_technician_id` — advisor+ |
| POST | `/jobsheets/:id/repair-items/:itemId/claim` | **technician-permitted** self-assign (§10) |
| POST | `/jobsheets/:id/clock-in\|out\|indirect` | mirror HC clock, key off jobsheet |
| GET | `/jobsheets/:id/time-entries` | jobsheet-grouped (job / inspection / indirect, multi-tech) |
| POST | `/jobsheets/:id/repair-items/:itemId/work-done` | generalised, tech-permitted |
| POST | `/resource-manager/suggest-technician` (extend) | add `jobsheetId` branch (§7) |

Existing HC endpoints stay live (delegating) until cutover. Emit `WORKSHOP_BOARD_UPDATED` on writes.

---

## 14. UI

**Web**
- Jobsheet detail (`JobsheetDetail.tsx`; tabs Overview · Check-In* · MRI* · Work · Timeline, *check-in-conditional — verified): add a **Technician tab** (Work ↔ Timeline) — primary tech (assign / `suggest-technician` chips), per-line tech + completion grid, job time breakdown (job / inspection / indirect, multi-tech).
- Admin: read-only "Operating mode" panel (super-admin sets via module).
- Board: jobsheet-inclusive cards + multi-tech indicator fix (§7).

**Mobile (the critical path — §9.3)**
- **Data contract:** "My Jobs" reads **jobsheet-first** (`jobsheets.assigned_technician_id` + lines where the tech is the per-line owner); VHC-only orgs reach work via the VHC's hidden jobsheet. Define the query explicitly (jobsheet-first, HC as optional child).
- Clock-on/off the **jobsheet**; inspection timer is a category within it.
- **New screens:** per-line completion (tick each work line, claim a line) + jobsheet clock controls. No tech-PATCH on `/jobsheets/:id` — use the claim/work-done endpoints (§10).

---

## 15. Phased delivery

- **P0 — Mode plumbing.** `operating_mode` + per-org settings UPSERT + module→mode coercion + read-time COALESCE. *Zero behaviour change.*
- **P1 — Jobsheet tech linkage.** Columns + advisor PATCH + web Technician tab (primary tech, suggest-technician). Mirror ↔ `health_checks.technician_id`.
- **P2 — One-jobsheet invariant.** `is_shell` + trigger skip + spawn-or-attach on VHC create + **backfill** standalone VHCs + **teach every shell consumer** (lists/stats/diary/invoice) to exclude shells (atomic with backfill).
- **P3 — Board / suggest / efficiency re-anchoring + clocking (§7, §8).** Jobsheet-inclusive board + multi-tech fix; `suggest-technician` jobsheet branch; efficiency sold+clocked re-anchored; `jobsheet_id` on the ledger + `/jobsheets/:id/clock-*` + open-timer cutover + double-count enforcement. Mobile clock-on-jobsheet.
- **P4 — Line completion + per-line tech (§9, §10).** `repair_items.assigned_technician_id` + inspection-line stamping + jobsheet-scoped work-done + claim endpoint + web grid + **mobile completion screens**. Derived job completion → board `work_complete`.
- **P5 — Legacy retirement (§8.5).** After reconciliation passes.

VHC-only tenants never break: they transparently gain a hidden jobsheet (P2) before anything depends on one (P3+). The board re-anchoring (P3) is what makes VHC-less jobsheets (estimate conversions) operational.

---

## 16. Industry justification (web-verified, adversarially checked)

1. **Unit of work = the job/RO, never the inspection.** Garage Hive *Jobsheet*; US SMS *Repair Order*; UK/dealer DMS *Job Card → operations*. Hierarchy always **Job → labour line → tech time** (Shopmonkey published schema; Tekmetric/Keyloop/Pinewood/CDK/Gemini).
2. **Inspection is a *child* of the job**, converting RAG findings into labour+parts lines on the same job. Exactly VHC's `repair_items` model.
3. **Tech + clock attach at the job/operation level; multi-tech per job supported** (CDK verbatim: "Add multiple Technicians to work on a service line"). **Gemini's tech app lets techs "clock onto jobsheets *and* VHCs"** — direct validation.
4. **The clock is an efficiency tool, not payroll;** clocked (actual) vs sold (flat-rate) hours coexist (Tekmetric verbatim). VHC already separates clocking from billing.
5. **Inspection-only vs full-shop is a real commercial tier** (standalone DVI pushing findings into someone else's RO, vs DVI bundled in a full SMS; UK eVHC as a per-job-card add-on). `operating_mode` is a legitimate revenue axis.
6. **Honest caveat:** verifiers **refuted** "Garage Hive assigns techs per labour line" — it's job/allocation-level. So **per-line tech (fork A) is a deliberate product choice with no universal precedent** — owner-driven, acceptable, flagged. The core thesis (job is the unit; inspection is a child; clock at job level) has primary-source confirmation (CDK, Keyloop).

---

## 17. Open sub-decisions (contradicted ones now closed)

Closed in v2: line grain = `repair_items` (§6.2); shell flag = `is_shell` (§5); double-count = "one active productive segment per tech" (§8.3); mode direction = module-gates-mode (§4). Still genuinely open:
1. **Tech-mirror duration** — keep `health_checks.technician_id` ↔ `jobsheets.assigned_technician_id` in sync through P3, retire at P5 (recommend).
2. **Completion-gate automation** — does "all non-declined lines complete" auto-advance board `work_complete`, or stay a manual tech action?
3. **`repair_items_parent_chk` tightening** — leave OR-based (allows dual parent, which we now *rely on* for inspection-line stamping) vs tighten. Recommend: leave OR-based; dual-parent is intentional here.
4. **Board re-base strategy** (§7) — union `health_checks`+jobsheets vs re-base the board on `jobsheets`. Affects P3 size; decide at P3 design.

---

## 18. Risks

- **Board re-anchoring (§7) is the biggest hidden cost after mobile.** Until the board/WeekView/tiles are jobsheet-inclusive, estimate-converted and VHC-unticked jobsheets have techs/clocks/completion data with **no operational surface**.
- **Mode direction (§4):** copying the parts pattern naively coerces *mode from module* (correct) — do **not** accidentally implement *module from mode* (net-new, wrong). The coercion lives in the settings route, not `modules.ts`; the registry is hand-duplicated web+API.
- **Dual-source window (P1–P3):** two tech anchors + two clock keys coexist; the mirror + `COALESCE` + open-timer cutover (§8.4) must be airtight (reconciliation check before P5) or time double-counts/orphans. Efficiency for VHC-less work is uncomputable until the sold side is re-anchored (§7).
- **Shell backfill (§5):** must land the trigger fix + every `is_draft`-filtered consumer exclusion **atomically**, or shells flood lists/diary/capacity/invoice. One-way data event.
- **Mobile (§9.3, §14):** the plan's core deliverable lives in the least-specified, net-new mobile half; technicians can't PATCH `/jobsheets/:id`, so claim/work-done endpoints (§10) are prerequisites.

---

*Key codebase anchors:* jobsheets + `health_checks.jobsheet_id` (`supabase/migrations/20260623120000_gms_jobsheets.sql`); polymorphic work lines + `repair_items_parent_chk` (`supabase/migrations/20260623180000_jobsheet_work_details.sql`); jobsheet drafts + reference trigger (`supabase/migrations/20260623200000_jobsheet_drafts.sql`); clocking ledger + categories (`supabase/migrations/20260614000000_technician_job_clocking.sql`); efficiency RPC (`supabase/migrations/20260624125000…`); clock endpoints (`apps/api/src/routes/health-checks/status.ts:845`); per-item work-done (`apps/api/src/routes/health-checks/repair-items-hc.ts`); pricing/labour-complete (`apps/api/src/routes/repair-items/labour.ts:613`); parts mode/module precedent (`apps/api/src/routes/organizations.ts:308`, `apps/api/src/services/modules.ts`); module registry (`apps/api/src/lib/modules.ts:54`); estimate→jobsheet (no VHC) (`apps/api/src/services/estimate-convert.ts:137`); board (`apps/api/src/routes/workshop-board.ts`); suggest-technician (`apps/api/src/routes/resource-manager.ts:339`); lazy settings rows (`apps/api/src/routes/org-admin.ts:40`).
