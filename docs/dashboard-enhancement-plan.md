# Dashboard Enhancement Plan & KPI Audit

**Date:** 2026-06-12 · **Status: IMPLEMENTED** (same day — all 3 phases; see `docs/metrics-glossary.md` for the resulting KPI definitions)
**Scope:** `apps/web/src/pages/Dashboard.tsx`, `apps/api/src/routes/dashboard.ts`, `apps/api/src/routes/dashboard-today.ts`, related report endpoints.

---

## Part 1 — KPI Wiring Audit

### 🔴 Bug 1: Conversion Rate is mathematically broken (the 350%)

**Where:** `apps/api/src/routes/dashboard.ts:249-252`

```typescript
const sentCount = healthChecks?.filter(hc => hc.sent_at).length || 0
const authorizedCount = Object.keys(authorizedTotals).length
const conversionRate = sentCount > 0 ? (authorizedCount / sentCount) * 100 : 0
```

- **Numerator:** HCs in the period with ≥1 authorized item (`customer_approved = true` OR `outcome_status = 'authorised'`).
- **Denominator:** HCs in the period with `sent_at` set.
- The numerator is **not a subset** of the denominator. Items are routinely authorized without the HC ever being "sent" (advisor marks the outcome after a phone authorization). Each such HC adds to the numerator but not the denominator.

**Verified against dev data** (Central Garage, replaying the endpoint's exact logic per day): on 2026-03-23 → `sent = 2`, `authorized = 8` (6 of which were never sent) → **400%**. Most days at this org have `sent = 0` and several authorizations, i.e. the org operates primarily on phone authorizations, making a sent-based denominator meaningless.

**Same broken formula** in `apps/api/src/routes/reports.ts:177` (`authorizedCount / sent`).

**Recommended definition** (pick one, use everywhere):
- **HC-level (recommended for the dashboard card):**
  `HCs with ≥1 authorized item ÷ HCs with ≥1 presented item` where "presented" = `sent_at IS NOT NULL` **OR** any item has `outcome_set_at` (covers phone authorizations). Numerator is then guaranteed ⊆ denominator.
- **Value-level (already exists):** `Authorized £ ÷ Identified £` — this is what `dashboard-today.ts:597-599` calls `financial.conversionRate`. Could be surfaced as a separate "Sold £ %" card.

### 🔴 Bug 2: "Today" badges inside "Monthly Performance"

**Where:** `apps/web/src/pages/Dashboard.tsx:600-626`

The first two cards under the **"Monthly Performance — June 2026"** header (Red Sold %, Amber Sold %) are deliberately wired to **today's** item counts from `GET /api/v1/dashboard/today` (`todaySoldPcts`, Dashboard.tsx:367-379) with hardcoded "Today" pills — while the other four cards in the same row are month-scoped. Mixed scopes under one heading is the confusion you spotted.

Compounding it:
- `GET /api/v1/dashboard/monthly-kpis` **already computes** monthly `redSoldPct` (dashboard.ts:1343) and `deltas.redSoldPct` (dashboard.ts:1436) — **both are unused by the frontend**.
- The monthly endpoint computes **no amber sold %** at all (only red is aggregated, dashboard.ts:1308-1320).

**Fix:** add `amberSoldPct`/`amber_identified`/`amber_authorised` to monthly-kpis; render monthly Red/Amber Sold % with vs-last-month delta chips in this section. Today's red/amber sold % move to a clearly-labelled "Today" strip (or are dropped — they already exist on the Today page).

### 🔴 Bug 3: "Conversion Rate" means 4 different things across the app

| Location | Definition |
|---|---|
| `dashboard.ts:252` (dashboard card) | HCs with authorized item ÷ HCs sent *(broken)* |
| `reports.ts:177` (performance report) | same broken formula |
| `dashboard-today.ts:597` (Today page) | Authorized £ ÷ Identified £ |
| `reports.ts:3307,3362` (daily overview) | HCs performed ÷ eligible jobs (a *completion* rate vs bookings) |

Same label, different math → users can't reconcile numbers between pages. Needs one glossary + one shared calculation module (see Phase 1).

### 🟠 Bug 4: Technician "completed today" counts re-touched old jobs

**Where:** `dashboard.ts:890-897` (`/dashboard/technicians`)

`completedToday` counts HCs in any post-tech status with **`updated_at >= today`**. Any update to an old HC (customer authorizes overnight, SMS read-flag, status flip to `completed`) re-counts it as "completed today" for that technician. Should filter on **`tech_completed_at >= today`** instead — the field exists and is used elsewhere.

### 🟠 Bug 5: Latent — authorized counts include deleted items; monthly misses group children

- `dashboard-today.ts:361-392` and monthly-kpis (`dashboard.ts:1313-1320`): "identified" requires `!isDeleted`, but the "authorized" branch doesn't check `isDeleted`. A deleted-but-approved item inflates sold % (can push >100%). Currently 0 rows in dev data, but it's one soft-delete away.
- monthly-kpis has **no group-children authorization fallback** (a group whose children are approved but whose parent isn't flagged counts as unsold) — `dashboard.ts` board endpoint and `dashboard-today.ts` both have this logic (`childrenByParent`); monthly doesn't. Monthly sold figures understate grouped work.

### 🟠 Bug 6: "Avg Response" isn't response time

`dashboard.ts:183-187` computes `sent_at → first_opened_at` = time-to-**open**. A customer who opens in 8 minutes but authorizes 3 hours later shows "8m". Either relabel ("Avg Time to Open") or compute `sent_at → outcome_set_at`/decision timestamp.

### 🟡 Bug 7: Scope inconsistencies & alert noise

- **Monthly KPIs use `created_at` only** (`dashboard.ts:1187-1197`); the main dashboard set uses due_date-or-created_at + outcome-date pulls. The two sections won't reconcile for DMS-imported bookings.
- **Overdue alerts** (`dashboard.ts:256-263` and `/queues` needsAttention): only exclude `completed/cancelled/expired`. `no_show` and `awaiting_arrival` HCs with past promise times, and already-`authorized`/`declined` HCs, stay "overdue" forever. Should exclude terminal + pre-arrival states.

### 🟡 Bug 8: Cosmetic wiring

- `Dashboard.tsx:964` & `:325` — `status.replace('_', ' ')` only replaces the **first** underscore → "ready to_send", "partial response" vs "awaiting_parts" inconsistencies. Use `replace(/_/g, ' ')`.
- Header has **two "Today" buttons** (date-range toggle + black quick-link to the Today page) — visible in the screenshot, genuinely confusing. Rename the link (e.g. "Today View") or merge.
- The date-range toggle (Today / 7 / 30 days) only re-scopes the top 6 cards. Queues, technician workload, monthly section ignore it — but nothing tells the user that.

---

## Part 2 — Enhancement Plan

### Phase 1: Restore trust (KPI correctness) — do first

1. **Shared metrics module** `apps/api/src/lib/metrics.ts`:
   - `calcItemTotal(item, optionMap)` (option-aware + VAT fallback — currently copy-pasted 3×)
   - `isItemAuthorised(item, childrenByParent)` (incl. group-children fallback, deleted-item guard)
   - `deriveRagStatus(item)` (currently copy-pasted 3×)
   - `computeConversion(hcs, items)` — the single definition
   - Reuse from `dashboard.ts`, `dashboard-today.ts`, monthly-kpis, `reports.ts`.
2. **Fix Conversion Rate** (Bug 1) in dashboard + reports with the HC-level definition; clamp to 0–100; sub-text on the card showing the fraction ("7/9 HCs"), tooltip with the formula.
3. **Fix Monthly section** (Bug 2): add monthly `amberSoldPct` to API; wire monthly red/amber sold % + delta chips; move today's pair into the today strip with item-count subtext.
4. **Fix technician completedToday** (Bug 4) → `tech_completed_at`.
5. **Fix deleted/group-children accounting** (Bug 5) via the shared module.
6. **Relabel/rewire Avg Response** (Bug 6); fix underscore labels, overdue-alert status filters (Bugs 7/8).
7. **Metrics glossary** `docs/metrics-glossary.md`: one definition per KPI, linked from card tooltips.

### Phase 2: Dashboard redesign

Design intent — a service manager should answer three questions in one glance:
1. **What needs me right now?** 2. **How is today flowing?** 3. **Are we on track this month?**

**Zone layout (top → bottom):**

1. **Header / global scope bar** — title + Live dot; date-range pills; site selector (multi-site orgs); actions (DMS Import, Kanban, Reports). One "Today" control only. Scope bar visually contains the widgets it affects.
2. **Action Center (only renders when non-empty)** — consolidates Needs Attention + Check-In Required + Awaiting Arrival into one prioritized list with urgency badges (WAITING / OVERDUE / EXPIRING / CHECK-IN), each row with its one-click action (Arrived, No Show, Check In). Red accent reserved for this zone so urgency color isn't diluted.
3. **Today's Flow** —
   - **Pipeline strip:** the 5 column counts (Technician → Tech Done → Ready to Send → With Customer → Actioned) rendered as a connected funnel with click-through to the filtered kanban; deep-link each card to its column filter rather than all pointing at `/health-checks`.
   - **KPI cards:** Total, Completed, Conversion % (fixed), Sold £ (Authorized), Declined £, Avg Time to Open. Each card: label + info tooltip, big value (`tabular-nums`), context subtext (e.g. "7/9 HCs"), drill-through link.
4. **Monthly Performance** — all cards month-scoped: Red Sold %, Amber Sold % (new), Avg Identified, Avg Sold, HCs/Day, Advisor of the Month; delta chips vs last month (incl. the already-computed-but-unused `deltas.redSoldPct`); optional 30-day sparklines later.
5. **Team strip** — Technician workload (live timers, queue, done-today via `tech_completed_at`); status breakdown collapses into an expandable footer (raw status counts are diagnostic, not glanceable).

**Component/styling work:**
- Extract a reusable `<KpiCard>` (label, value, delta, subtext, tooltip, link, loading-skeleton) — Dashboard.tsx is 1,100 lines of hand-rolled cards; this also fixes inconsistent value font sizes (`text-3xl` vs `text-2xl` vs `text-xl`).
- Skeleton loaders per zone instead of the single page spinner; explanatory empty states ("No red work identified yet today") instead of bare "--".
- Mobile: Action Center first, KPI grid 2-col, pipeline strip horizontal-scroll.

**Component split:** `Dashboard/` folder — `ActionCenter.tsx`, `PipelineStrip.tsx`, `TodayKpis.tsx`, `MonthlyKpis.tsx`, `KpiCard.tsx` (TechnicianWorkload.tsx already exists).

### Phase 3: Performance & data layer

1. `/dashboard/technicians` runs **4 queries per technician** (N+1, `dashboard.ts:856-920`) — batch into 4 org-wide queries grouped in code.
2. Dashboard mounts with ~6 parallel fetches (`/dashboard`, `/queues`, `/technicians`, `/monthly-kpis`, `/today`, `/dms-settings/unactioned`, `/health-checks?status=awaiting_checkin`) — consolidate into `GET /api/v1/dashboard/overview` (one round-trip, one consistent HC set, shared metrics module) with WebSocket-debounced refresh as today.
3. The `/dashboard/activity` endpoint fetches **all org HC ids** then filters history (`dashboard.ts:944-950`) — join directly on organization via the FK instead.

### Verification checklist

- Seed a day with: phone-authorized HC (never sent), sent+authorized HC, sent+declined HC, group with approved children, deleted-but-approved item → conversion must stay 0–100% and reconcile with Reports.
- Red/Amber Sold % in Monthly section must match Reports daily-overview month totals.
- `npm run build` (web + api) before commit.
