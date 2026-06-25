# GMS — Jobsheet Module (Plan)

> Branch: `GMS` · Status: **Phase 1 built (uncommitted)** · Author: Leo + Claude · Date: 2026-06-23

## ✅ Build status — Phase 1 (implemented 2026-06-23, uncommitted, migration not yet deployed)

**Database** — `supabase/migrations/20260623120000_gms_jobsheets.sql`: tables `jobsheets`,
`booking_codes` (+ `jobsheet_booking_codes` join), `service_types`; `health_checks.jobsheet_id`;
`customers.phone` + `customers.contact_name`; `organization_settings.next_jobsheet_number`;
`JS00001` reference trigger; `updated_at` triggers; RLS; `subscription_plans.features.jobsheets=false`;
seeded default service types + booking codes for existing orgs.

**Module** — `jobsheets` registered in `apps/api/src/lib/modules.ts` + `apps/web/src/lib/modules.ts`
(**off by default**). API routes gated by `requireModule('jobsheets')`; web nav/routes gated.

**API** — `apps/api/src/routes/jobsheets.ts` (list/detail/create-kicks-off-VHC/update/soft-delete),
`booking-codes.ts` + `service-types.ts` (CRUD + lazy-seed), all mounted in `index.ts`. `customers.ts`
POST/PATCH extended for `phone` + `contactName`.

**Web** — `pages/Jobsheets/{JobsheetList,NewJobsheet,JobsheetDetail}.tsx`,
`pages/Settings/{BookingCodes,ServiceTypes}.tsx`; routes in `App.tsx` (jobsheet routes wrapped in
`RequireModule`); nav item in `DashboardLayout.tsx`; cards + "Jobsheets (GMS)" group in `SettingsHub.tsx`.

**Verified** — `tsc --noEmit` passes for API + web; web production build (`tsc && vite build`) succeeds.

### Phase 1.1 — Due-In date/time (added 2026-06-23, supersedes the "deferred booking date" decision)

Migration `20260623140000_jobsheet_due_in.sql`: `jobsheets.due_in_date` (DATE, **NOT NULL**, mandatory)
+ `jobsheets.due_in_time` (TIME, nullable — NULL = flexible/TBC). The linked `health_checks.due_date`
is now **derived** from these (date + time, default **08:00** when flexible), so the VHC flows into the
Upcoming view and the workshop "Due In" column on the right day. Enforced mandatory at DB (NOT NULL),
API (400), and the form (required field). Wired through jobsheets create/update/list/detail.

> This brings the booking date **into the jobsheet now** rather than a later Booking module — it's
> required for the health-check process. A separate Booking module is no longer needed for the date;
> only the calendar/diary view + DMS-booking unification remain future work.

### Phase 1.2 — Future Bookings tile + Vehicle Status on jobsheet (2026-06-23)

Migration `20260623160000_future_bookings_tile.sql`: the Tile Status RPCs (`workshop_status_tiles`,
`workshop_status_tile_jobs`) now **exclude `due_in`**; a synthesised **"Future Bookings"** tile (count of
`due_in` jobs, sorts first) is added in the API (`/tiles` + a `status=future` drill-in branch). The
drill-in gained a **"Due in"** column. The jobsheet detail now **states the Vehicle Status** explicitly
(labelled field + header badge). So JS00001 (Due In) shows under **Future Bookings**, not "No job status".

### Phase 2 + 3 — Work Details + jobsheet-aware Tile page — BUILT (uncommitted, 2026-06-23)

Plan + build status in [`WORK_DETAILS.md`](./WORK_DETAILS.md). Migration `20260623180000_jobsheet_work_details.sql`
(pending deploy). Phase 2: booked work lines on the jobsheet (labour + parts + Packages + booking notes,
pre-authorised), VHC opt-out toggle, jobsheet carries Vehicle Status. Phase 3: Future Bookings tile + drill-in
now include VHC-less jobsheets (open the jobsheet, not a VHC). tsc + web build pass. Locked decisions (Leo, 2026-06-23):
**(1) reuse the VHC repair engine** (a jobsheet work line *is* a `repair_item`, not parallel tables);
**(2) booked work belongs to the jobsheet** (`repair_items.jobsheet_id`; `health_check_id` made nullable) —
structurally separate from VHC inspection findings; **(3) the VHC is optional, default-ON, opt-out at
booking** ("Requires VHC" toggle / `jobsheets.vhc_required`); **(4) the jobsheet is the visit/workshop
entity** (Option 2; `jobsheets.job_state`) with the board/tile migration **staged to Phase 3**;
**(5) booked work is pre-authorised**. Net new schema = 5 additive columns; rest is a thin `work-lines`
API router + a Work Details panel reusing existing labour/parts/package/margin UIs.

> This **revises §7 below**: the linked VHC is now created **unless** `vhc_required=false` (opt-out at
> booking), instead of always. Booked work survives a cancelled VHC because it lives on the jobsheet.

### Phase 2.1 — One-screen booking + work via drafts (BUILT uncommitted, 2026-06-23)

The New Jobsheet page now builds the booking **and** the priced work (labour/parts/packages) on a
**single screen** (booking form left, live `WorkDetailsPanel` right) instead of "create → land on detail
→ add work". Because a work line is a `repair_item` that needs a parent jobsheet id, the jobsheet is
created as a **draft** the moment a vehicle + customer are chosen. Migration
`20260623200000_jobsheet_drafts.sql` adds `jobsheets.is_draft` and makes the reference trigger fire on
`INSERT OR UPDATE`, assigning `JS0000N` only when `reference IS NULL AND is_draft = false`.

- **A draft is invisible + cheap:** no JS reference, no linked VHC, excluded from the jobsheets list and
  the Future Bookings tile/drill-in. Abandoned drafts never burn a number or hit the workshop board.
- **Commit** (`POST /jobsheets/:id/commit`, on "Create Jobsheet"): sets the booking fields, flips
  `is_draft=false` (trigger assigns the reference), attaches booking codes, and kicks off the VHC
  (shared `kickOffJobsheetVhc` helper). **Create** (`POST /jobsheets/draft`) takes just a vehicle.
- **Discard** (`POST /jobsheets/:id/discard`, service-advisor accessible): hard-deletes a draft, cascading
  to its work lines. Fired on **Cancel** and on in-app navigate-away. **Decision (Leo, 2026-06-23):
  Cancel-discards only — no background sweep** (a closed tab may leave a draft, but it's invisible and
  number-free). The old `POST /jobsheets` (create active directly) stays for back-compat.
- Booking Notes + packages now live in the Work Details panel (removed from the New form). The form keeps
  the "Requires VHC" toggle. `due_in_date` (NOT NULL) gets a `today()` placeholder on draft; the real
  due-in is set at commit.

> **Deploy dependency:** the new endpoints need the `is_draft` column, so browser testing is blocked until
> `20260623200000` deploys to dev (via the pipeline push — **not** out-of-band MCP SQL).

---

## 1. Purpose & vision

Introduce a **Jobsheet** as the new top-level booking document, modelled on the Garage Hive
GMS jobsheet. A Jobsheet represents a forward booking (can be days, weeks or months ahead) and
becomes the **parent** of the Vehicle Health Check (VHC).

Core principles agreed:

1. **Jobsheets are a toggleable module** — off by default; not every customer needs them.
2. **Jobsheet = top-level document.** A health check (VHC) is attached to a jobsheet.
3. **Creating a jobsheet also creates the start of the VHC** (a linked `health_checks` row).
4. **Jobsheets are the forward calendar** (all future bookings). The **VHC / "Upcoming" view stays
   day-of** — relevant on the day or in the existing Upcoming tab. The far-future calendar lives on
   the Jobsheets list; we don't surface months-out bookings in the day-of VHC views.
5. **"Work Status Code" = the existing "Vehicle Status"** (`health_checks.job_state`) already in the
   app — we reuse it, we do **not** invent a new status concept.
6. **"Extended Status Code" → renamed "Booking Codes"** — a new org-configurable, **multi-select**
   lookup. Managed in Settings, but also addable inline from the booking UI.

---

## 2. Key architectural decision — ✅ DECIDED

**Decided: a new `jobsheets` table as the parent, with `health_checks.jobsheet_id` linking
the child VHC.** This matches the "top-level document" framing and the long-term GMS direction
(where a jobsheet will eventually own multiple children: VHCs, estimates, parts orders, invoices,
courtesy-vehicle bookings, collection/delivery legs).

**Why not just extend `health_checks`?** Today, DMS bookings already *are* `health_checks` rows
(`status = awaiting_arrival`). We could add the new booking fields straight onto `health_checks` and
skip a new table. That's less migration work, but it permanently fuses "the booking document" with
"the inspection," which fights the GMS vision (one jobsheet → many documents) and makes the eventual
multi-child model painful. The separate-table approach keeps the inspection self-contained while
giving us a clean parent to grow GMS onto.

**Coexistence / backward-compat:** `health_checks.jobsheet_id` is **nullable**. Existing health
checks and DMS imports keep working untouched (no jobsheet). Only manually-created jobsheets (Phase 1)
populate it. DMS-import-creates-jobsheets is a later phase (§10), not Phase 1.

---

## 3. The module

Register a new module so Jobsheets can be switched on/off per organisation, reusing the existing
module-enablement system.

| Concern | Detail |
|---|---|
| Module key | `jobsheets` |
| Label / description | "Jobsheets (GMS)" / "Top-level booking document with attached health checks" |
| Default | **OFF** (`defaultOn: false`; plan default `false`) — opt-in per org |
| Core? | No (always disableable) |

**Files to touch (existing pattern):**
- `apps/api/src/lib/modules.ts` — add `'jobsheets'` to `ModuleKey` + a `MODULES` registry entry.
- `apps/web/src/lib/modules.ts` — mirror the same (intentionally duplicated copy).
- Migration — `UPDATE subscription_plans SET features = features || '{"jobsheets": false}'` so it shows
  in the admin Modules tab and resolves predictably.
- Enforcement — `apps/api/src/routes/jobsheets.ts` does `use('*', requireModule('jobsheets'))`.
- Web gating — nav item + settings cards gated by `useModules().isEnabled('jobsheets')`; routes wrapped
  in `<RequireModule module="jobsheets">`.

No admin-UI changes needed — the Modules tab auto-detects new keys from the registry.

---

## 4. Data model

### 4.1 New table: `jobsheets` (parent)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `organization_id` | UUID FK → organizations | **Multi-tenant scope (always filter).** |
| `site_id` | UUID FK → sites | Defaults to creator's site. |
| `reference` | TEXT | Auto human ref per org (e.g. `JS00001`) via a sequence trigger, mirroring the existing `vhc_reference` trigger. **Unique per org.** (Distinct from the DMS-derived `health_checks.jobsheet_number` text field — different concept, don't conflate.) |
| `customer_id` | UUID FK → customers | The booking's customer. |
| `vehicle_id` | UUID FK → vehicles | Resolved from registration. |
| `service_type_id` | UUID FK → service_types | NULL allowed (see §4.4). |
| `advisor_id` | UUID FK → users | **Service Advisor.** |
| `due_in_date` | DATE **NOT NULL** | **Due In Date** — mandatory (customer due in). Drives the VHC `due_date`. (Phase 1.1) |
| `due_in_time` | TIME | **Due In Time** — optional; NULL = flexible/TBC. Defaults to 08:00 when deriving the VHC `due_date`. (Phase 1.1) |
| `mileage` | INTEGER | Booking mileage — **fully optional, never required at any stage**. |
| `requested_delivery_at` | TIMESTAMPTZ | Requested delivery date/time. |
| `courtesy_vehicle_required` | BOOLEAN | Default `false`. |
| `collection_and_delivery` | BOOLEAN | Default `false`. |
| `vehicle_on_site` | BOOLEAN | Default `false` (GH "Vehicle on Site"). |
| `customer_contact_notes` | TEXT | Per-booking note (≠ inspection notes). |
| `jobsheet_complete` | BOOLEAN | Default `false` (GH "Jobsheet Complete"; minimal lifecycle for now). |
| `created_by` | UUID FK → users | |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | **Document creation date/time** — set automatically by the backend (DB default); surfaced on the jobsheet as the "Document Date". |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() | Last-modified audit. |
| `deleted_at` / `deleted_by` | TIMESTAMPTZ / UUID | Soft delete, matching health-checks convention. |

**Not stored here:** "Work Status Code" / **Vehicle Status** is **read from the linked
`health_checks.job_state`** — it is literally the same field that already exists, not a copy.

### 4.2 Link column on `health_checks`

```sql
ALTER TABLE health_checks ADD COLUMN IF NOT EXISTS jobsheet_id UUID
  REFERENCES jobsheets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_health_checks_jobsheet_id ON health_checks(jobsheet_id);
```

Cardinality: **1 jobsheet → 1 health check** for Phase 1 (the column supports 1→many later without
schema change). The jobsheet detail page surfaces its VHC.

### 4.3 New table: `booking_codes` (+ join) — the renamed "Extended Status Code"

Modelled on the proven `workshop_statuses` lookup pattern (org-scoped, Settings-managed, inline-addable).

```sql
CREATE TABLE IF NOT EXISTS booking_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  label TEXT,
  colour VARCHAR(7) DEFAULT '#6366F1',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, code)
);

-- multi-select attach to a jobsheet
CREATE TABLE IF NOT EXISTS jobsheet_booking_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jobsheet_id UUID NOT NULL REFERENCES jobsheets(id) ON DELETE CASCADE,
  booking_code_id UUID NOT NULL REFERENCES booking_codes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (jobsheet_id, booking_code_id)
);
```

### 4.4 New table: `service_types` (the "Service Type" dropdown)

Same shape/pattern as `booking_codes` but **single-select** (FK on the jobsheet). Configurable in
Settings, inline-addable. ✅ Decided (configurable lookup, not a fixed enum/free text).

```sql
CREATE TABLE IF NOT EXISTS service_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  label TEXT,
  colour VARCHAR(7) DEFAULT '#6366F1',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (organization_id, code)
);
```

### 4.5 Minor additive columns on `customers`

GH separates Mobile (required), Phone (landline), a named Contact, and notes. We already have
`customers.mobile` and `customers.email`. To cover the rest cheaply and additively:

- `customers.phone TEXT` — landline ("Phone No.").
- `customers.contact_name TEXT` — named contact ("Contact"), useful for fleet/business customers.
- `customer_contact_notes` stays on the **jobsheet** (it's a per-booking note, not a customer attribute).

All `ADD COLUMN IF NOT EXISTS` — no destructive changes.

---

## 5. Field reference — screenshot → Ollo mapping

Every boxed field from the Garage Hive jobsheet, where it lives, and whether it's new.

| GH field (screenshot) | Ollo field | Stored in | New? |
|---|---|---|---|
| Jobsheet no. (DS006029) | `jobsheets.reference` (e.g. JS00001) | jobsheets | **New** (seq trigger) |
| Document Date/Time | `jobsheets.created_at` | jobsheets | **New** — automated backend (DB default `NOW()`) |
| Due In Date (mandatory) + Time (optional) | `jobsheets.due_in_date` (NOT NULL) + `due_in_time` → derives `health_checks.due_date` | jobsheets + health_checks | **New (Phase 1.1)** |
| **Service Type** (MOT) | `jobsheets.service_type_id` → `service_types` | jobsheets + lookup | **New** |
| **Vehicle Registration No.** (H3XOL) | `vehicles.registration` | vehicles | Reuse (+ reg lookup) |
| Vehicle No. (VN0042984) | — (DMS external id) | n/a | Skip (DMS-only) |
| Vehicle Description | `vehicles.make` + `model` | vehicles | Reuse (derived) |
| Mileage (GH marks required ✱) | `jobsheets.mileage` → copied to `health_checks.mileage_in` | both | Reuse field — **optional in Ollo, never required** |
| **Customer** | `jobsheets.customer_id` → `customers` | customers | Reuse |
| **Contact** | `customers.contact_name` | customers | **New** (small) |
| **Mobile Phone No.** (required ✱) | `customers.mobile` | customers | Reuse |
| **Phone No.** | `customers.phone` | customers | **New** (small) |
| **Email** | `customers.email` | customers | Reuse |
| **Customer Contact Notes** | `jobsheets.customer_contact_notes` | jobsheets | **New** |
| **Courtesy Vehicle Required** | `jobsheets.courtesy_vehicle_required` | jobsheets | **New** |
| **Collection and Delivery** | `jobsheets.collection_and_delivery` | jobsheets | **New** |
| Requested Delivery Date/Time | `jobsheets.requested_delivery_at` | jobsheets | **New** |
| **Work Status Code** (PENDING) | `health_checks.job_state` — relabelled **"Vehicle Status"** | health_checks | Reuse (read from linked VHC) |
| **Extended Status Code** (MOT) | `jobsheet_booking_codes` → `booking_codes` — relabelled **"Booking Codes"** (multi) | join + lookup | **New** |
| **Service Advisor** (HOLLY) | `jobsheets.advisor_id` → `users` | jobsheets | Reuse |
| Vehicle on Site (toggle) | `jobsheets.vehicle_on_site` | jobsheets | **New** |

> Note: `health_checks` already has `loan_car_required` (from DMS). We keep `courtesy_vehicle_required`
> as a **separate** jobsheet field — they're distinct concepts and we don't want to overload the DMS flag.

---

## 6. API design

New route file `apps/api/src/routes/jobsheets.ts`, registered in `apps/api/src/index.ts`, gated by
`authMiddleware` + `requireModule('jobsheets')`.

| Method | Path | Purpose | Min role |
|---|---|---|---|
| GET | `/api/v1/jobsheets` | List (filter: date range, status, site, search). Forward calendar. | service_advisor |
| GET | `/api/v1/jobsheets/:id` | Detail incl. linked VHC + booking codes. | service_advisor |
| POST | `/api/v1/jobsheets` | **Create jobsheet + kick off VHC** (§7). | service_advisor |
| PATCH | `/api/v1/jobsheets/:id` | Update booking fields + booking-code attachments. | service_advisor |
| DELETE | `/api/v1/jobsheets/:id` | Soft delete. | site_admin |

Lookup CRUD (Settings + inline add), mirroring `tyres.ts` / workshop-statuses routes:
- `apps/api/src/routes/booking-codes.ts` — GET / POST / PATCH / DELETE.
- `apps/api/src/routes/service-types.ts` — GET / POST / PATCH / DELETE.

All queries filter by `organization_id` from the auth context.

---

## 7. Creation flow — jobsheet kicks off the VHC

`POST /api/v1/jobsheets` (single transaction where possible), reusing the DMS import's
find-or-create logic and the existing health-check creation path:

1. **Resolve customer** — by `customerId` (existing) or create from the contact fields
   (first/last name, mobile, email, phone, contact_name).
2. **Resolve vehicle** — by registration (normalised); reuse the existing **reg lookup** (vehicle_lookup
   module / MOT-history) to populate make/model; link `customer_id`.
3. **Insert `jobsheets`** row — `reference` auto-assigned by trigger; set service_type, advisor, mileage,
   booking_at, requested_delivery_at, courtesy/collection toggles, contact notes, site.
4. **Attach booking codes** — insert `jobsheet_booking_codes` rows for selected codes.
5. **Create the linked VHC** — insert `health_checks` with:
   - `jobsheet_id` = new jobsheet,
   - `status = 'awaiting_arrival'`, `job_state = 'due_in'` (correct for a future booking),
   - `customer_id`, `vehicle_id`, `site_id`, `advisor_id`, `mileage_in = mileage`,
   - `template_id` = org default template (see Q6).
   - Existing triggers handle `vhc_reference` + status history.
6. **Return** the jobsheet with its `healthCheckId`.

This is consistent with how DMS bookings already create `awaiting_arrival` health checks — we're just
adding the jobsheet parent in front of it.

> **Due-in date drives the VHC `due_date` (Phase 1.1).** The mandatory **Due In Date** (+ optional time)
> is combined into the VHC's `due_date` (default 08:00 when the time is flexible), so the inspection flows
> into the day-of "Upcoming" view and the workshop "Due In" column on the right day. The jobsheet's own
> **Document Date** (`created_at`) is still set automatically and is separate from the due-in date.

---

## 8. Web UI

New pages under `apps/web/src/pages/Jobsheets/` (state via `useState`, calls via `api<T>()`, toasts via
`useToast()`, styling per the rounded-xl/indigo conventions):

- **`JobsheetList.tsx`** (`/jobsheets`) — forward calendar of bookings; filters by date range/status/site;
  "New Jobsheet" button. This is the new home for far-future bookings.
- **`NewJobsheet.tsx`** (`/jobsheets/new`) — capture form for the §5 fields. Reg lookup, customer
  search-or-create, multi-select Booking Codes (with inline "add code"), Service Type dropdown (inline
  add), advisor picker, toggles, dates.
- **`JobsheetDetail.tsx`** (`/jobsheets/:id`) — view/edit; shows **Vehicle Status** (from linked VHC),
  Booking Codes, and a link through to the VHC.

Settings (gated by module + role), mirroring `WorkshopStatuses.tsx`:
- **`Settings/BookingCodes.tsx`** (`/settings/booking-codes`).
- **`Settings/ServiceTypes.tsx`** (`/settings/service-types`).

Wiring:
- `apps/web/src/App.tsx` — add the four routes (jobsheet routes wrapped in `<RequireModule module="jobsheets">`).
- `apps/web/src/layouts/DashboardLayout.tsx` — add a "Jobsheets" nav item with `module: 'jobsheets'`.
- `apps/web/src/pages/Settings/SettingsHub.tsx` — add Booking Codes + Service Types cards, gated via
  `CARD_MODULE` → `jobsheets`.
- Shared types in `packages/shared/src/types` — `Jobsheet`, `BookingCode`, `ServiceType`.

---

## 9. Migrations

One new timestamped migration (`YYYYMMDDHHMMSS_gms_jobsheets.sql`), all `IF NOT EXISTS` per the safety
rules (never `db reset`):

1. `CREATE TABLE jobsheets …` + `reference` sequence/trigger (clone the `vhc_reference` trigger).
2. `CREATE TABLE booking_codes` + `jobsheet_booking_codes`.
3. `CREATE TABLE service_types`.
4. `ALTER TABLE health_checks ADD COLUMN jobsheet_id …` + index.
5. `ALTER TABLE customers ADD COLUMN phone …, ADD COLUMN contact_name …`.
6. `UPDATE subscription_plans SET features = features || '{"jobsheets": false}'`.
7. Indexes: `jobsheets(organization_id, created_at)`, `jobsheets(organization_id, deleted_at)`.

Apply to dev via `supabase db push` (deploy pipeline) — **not** raw MCP SQL — to avoid the migration-drift
issue we've hit before.

---

## 10. Scope

**Phase 1 (this branch):**
- `jobsheets` module toggle (off by default).
- `jobsheets`, `booking_codes` (+ join), `service_types` tables; `health_checks.jobsheet_id`; customer fields.
- API: jobsheets CRUD + create-kicks-off-VHC; booking-codes & service-types CRUD.
- Web: List / New / Detail + Settings (Booking Codes, Service Types); nav + module gating.
- Capture the §5 boxed fields. Vehicle Status read from the linked VHC.

**Explicitly out of scope for Phase 1 (future GMS phases):**
- ~~Booking Date ("customer due in")~~ — **done in Phase 1.1** (mandatory due-in date + optional time on the jobsheet, drives the VHC `due_date`). A **calendar/diary view** of forward bookings remains future.
- DMS import creating jobsheets (instead of bare health checks).
- Jobsheet → multiple children (estimates, parts orders, invoices).
- Courtesy-vehicle booking records & collection/delivery scheduling (we store the *flags* now, not the legos).
- Key Tag, Parking Location, SERMI, QC, GDPR consent, marketing channel.
- Full jobsheet lifecycle/posting, calendar/diary view.

---

## 11. Decisions & open questions

**Decided:**
1. ✅ **Architecture (§2):** new `jobsheets` parent table with `health_checks.jobsheet_id`.
3. ✅ **Mileage:** **non-mandatory at any stage** — optional on the jobsheet form, at check-in, and on the VHC.
4. ✅ **Service Type:** org-configurable lookup table (`service_types`), inline-addable.

**Still open (have a recommendation; not blocking the first build):**
2. **Module default:** OFF by default (recommended) — confirm.
5. **Jobsheet ↔ VHC cardinality:** 1:1 for Phase 1 (recommended) — confirm we're not doing 1:many yet.
6. **VHC template on creation:** use the org default template? Or let the user pick during jobsheet creation?
7. **Customer extras:** add `phone` + `contact_name` to `customers` (recommended) vs. store on the jobsheet only?
8. **Numbering:** jobsheet `reference` format — `JS00001` (suggested) or a different prefix?
