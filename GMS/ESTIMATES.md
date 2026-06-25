# GMS — Estimates module (design / plan)

Status: **P0–P4 BUILT — the initiative is feature-complete (uncommitted on `dev`, 2026-06-26).**
P1+P2 migrations DEPLOYED to cloud dev (verified live). P3 + P4 add NO migration. Companion to
`GMS/JOBSHEET.md`. Ships **off by default**.

## Build status
- **P0 (Documents nav) — DONE.** Expandable "Documents" nav group (Jobsheets + Estimates,
  net-new `NavGroup` in `DashboardLayout.tsx` with per-child module gating + localStorage
  expand state); `/documents` hub (`pages/Documents/DocumentsHub.tsx`, card grid with counts +
  New/View-all); `estimates` module key added to both `lib/modules.ts`; routes in `App.tsx`.
- **P1 (Estimate core) — DONE.** Migration `20260626140000_estimates.sql` (estimates table +
  `repair_items.estimate_id` + 3-way parent CHECK + EST reference trigger + draft flow + RLS +
  module-off default). API `apps/api/src/routes/estimates.ts` (list/detail/draft/commit/discard/
  patch/delete + work-lines GET/POST/from-package), mounted in `index.ts`. **`WorkDetailsPanel`
  generalised** to `parent={type,id}` + optional `notes` config (both jobsheet callers updated).
  Pages `pages/Estimates/{EstimatesList,NewEstimate,EstimateDetail}.tsx`.
- **P2 (Send & accept + Settings) — DONE.** Migration `20260626160000_estimates_send.sql`
  (4 estimate settings cols on `organization_settings`; `communication_logs.estimate_id` +
  `customer_activities.estimate_id`, both with `health_check_id` relaxed to NULLable).
  **Send:** `default-templates.ts` gains `estimate_ready` (+ `estimateNumber` in TemplateContext);
  `services/estimate-send.ts` renders+dispatches **inline** (reuses getOrganizationTemplate /
  renderEmailHtml / sendEmail / sendSms / getOrganizationBranding) and logs to communication_logs;
  `POST /estimates/:id/send` mints the token (expiry from settings) → status `sent` → dispatch.
  **Portal:** `routes/public-estimate.ts` (`GET /api/public/estimate/:token` + per-line
  approve/decline + approve-all/decline-all + sign; reuses repair_items decision columns +
  customer_activities; status recompute → opened/accepted/partial/declined); web
  `pages/EstimatePortal/EstimatePortal.tsx` (public, `/estimate/:token`, inline signature pad).
  **Settings:** `services/estimate-settings.ts` + `routes/estimate-settings.ts`
  (`/organizations/:orgId/estimate-settings/settings` GET/PATCH) + `pages/Settings/EstimateSettings.tsx`
  (link-expiry days, auto-expire, require-signature, terms) + SettingsHub card/group + route.
  **EstimateDetail:** Send-to-customer/Resend modal (email/SMS/message) + customer-response
  timeline (sent/opened/responded).
- **Verification:** `tsc --noEmit` green on API **and** web; web `vite build` green (now incl.
  EstimatePortal + EstimateSettings chunks). Live browser verify BLOCKED until migrations deploy
  to cloud dev + module is force-enabled (same pattern as the rest of GMS — see [[dev-migration-drift]]).
- **Go-live:** push `dev` → pipeline runs `supabase db push` (NOT out-of-band MCP) → super-admin
  enables `estimates` for the org (Admin → org → Modules → Force On). Outbound SMS/email also need
  Railway TWILIO_*/RESEND_* env (see [[dev-outbound-comms-blocked]]); send is INLINE so no worker dep.
- **Deliberately deferred:** estimate send is inline (no BullMQ worker dependency); no acceptance
  *confirmation* email yet; estimate message template not yet customizable in the Customer Messages
  hub (uses the built-in default); auto-expire scheduler not built (flag + valid_until stored).
- **P3 (Make Jobsheet) — DONE. No migration.** `POST /estimates/:id/make-jobsheet`
  (gated `requireModule('jobsheets')` too) deep-copies the chosen lines (approved-only default,
  or all) onto a NEW jobsheet as pre-authorised booked work (`copyLineToJobsheet` copies the
  repair_item + its repair_labour + repair_parts; pricing triggers recompute), creates a
  **VHC-less** jobsheet (vhc_required=false; the work is already agreed), links
  `estimates.converted_to_jobsheet_id` + `converted_at` → status `converted`. Web: a "Make
  Jobsheet" button + modal on EstimateDetail (line selection, due-in date/time, service type,
  advisor, booking notes; defaults approved-only when accepted/partial) → navigates to the new
  jobsheet. Garage-Hive "Make Jobsheet" / "Copy Authorised Lines" pattern. tsc(api+web)+web build green.
- **P4 (Smart banners) — DONE. No migration.** Shared `apps/web/src/components/CustomerInsightsBanner.tsx`
  (conditional badge strip — Salesforce "Dynamic Highlights"; severity-ordered safety→commercial→lifecycle;
  icon+text, RAG tints; renders nothing when no trigger fires; staff-only — not on the customer portal/PDF)
  rendered on **EstimateDetail + JobsheetDetail + HealthCheckDetail**. Backed by one endpoint
  `GET /api/v1/customers/:id/insights?vehicle_id=&exclude_hc=` → `services/customer-insights.ts`
  (`getCustomerInsights`), reusing the user's `loadJobsheetExtras` query patterns. 4 build-first badges:
  **New customer** (0 prior visits), **Lapsed/At-risk** (tiered 9/12/18mo, shows last-visit date; "Regular
  customer" wording when ≥3 prior visits), **£X advised work outstanding** (deferred repair_items + follow_up
  case deep-link), **MOT due/expired** (vehicles.mot_expiry_date/status). VIP/spend + service-due + recall
  deferred (need new compute). Thresholds are constants in the service (easy to make org-configurable later).
  Verified vs dev data: MOT-expired ×2, deferred ×577, new-customer all fire; lapsed=0 on dev only because
  all dev visits are recent (<9mo) — logic sound, fires on prod historical data. tsc(api+web)+web build green.
- **Go-live (whole feature P1–P4):** super-admin Force-On `estimates` (+ `jobsheets` for conversion) for the
  org; real SMS/email needs Railway TWILIO_*/RESEND_* env. No further migrations pending.

---

---

## 1. What an Estimate is (locked with Leo, 2026-06-25)

An **Estimate is a standalone, pre-booking priced quote** — a first-class document that
**mirrors the Jobsheet** rather than the VHC. The customer rings up ("how much for a
clutch?"); an advisor builds a few priced lines from **reg + customer with NO inspection
required**, sends it to the customer to accept, and on acceptance it **converts into a
Jobsheet** (the committed booking that runs the workshop pipeline).

Document model (Garage Hive lineage): **Estimate → (accept) → Jobsheet → (work) → Invoice.**

| Document | Role |
|---|---|
| **Estimate** (this module) | Pre-sale quote. No commitment, no slot booked. |
| **Jobsheet** | The booking / work-order. Runs the workshop kanban (`job_state`). |
| **VHC** | The inspection. Can attach to a jobsheet; itself produces advisory estimates. |
| **Invoice** (future) | The bill. |

### Why not "Estimate = a published VHC"
VHC already *is* an inspection-derived estimate (priced `repair_items` sent via the public
portal with per-line approve/decline/sign). But forcing a template + technician inspection on
every quote kills the phone-quote use case. So Estimates is the **standalone** document; it
**reuses the VHC's send/accept machinery** without being inspection-bound.

### Locked decisions
1. **Identity:** standalone document, own table, mirrors Jobsheets. *(not "published VHC")*
2. **Conversion:** advisor clicks **"Make Jobsheet"** — authorised lines copy into a NEW
   jobsheet; advisor sets the booking date/slot. *(not auto-create on acceptance)*
3. **Smart banners v1:** the **4 build-first badges** (New customer · Lapsed/At-risk ·
   £X advised work outstanding · MOT due/expired/recall), as ONE shared component rendered on
   **Estimate + Jobsheet + VHC**.
4. **Module:** new **`estimates`** module key, `defaultOn: false` (own per-tenant gate,
   sibling to `jobsheets`).
5. **Per-line authorisation** internally (customer action stays simple: Approve / Approve
   selected / Decline). Only authorised lines copy to the jobsheet.

### Minor decisions taken (non-blocking, sensible defaults)
- Estimate type = single **"Estimate"** concept for v1 (defer the legal Estimate-vs-fixed-Quote
  split + T&Cs typing to a later phase).
- Lapsed thresholds default **9mo (amber) / 12mo / 18mo (red)**, org-configurable.
- Banner privacy: **staff-only by default**; only the factual **MOT** cue is eligible for the
  customer-facing/PDF render (opt-in). Sensitive cues (lapsed, value) never printed.
- "Last visit" signal = most-recent non-deleted `health_checks` for the customer
  (DMS-imported + VHC-native); refine later if needed.

---

## 2. Data model

### 2.1 `estimates` table (mirrors `jobsheets`)
Additive migration. Mirror the jobsheets shape minus VHC-specific fields, plus the
customer-document lifecycle fields borrowed from health_checks.

```
estimates(
  id uuid pk,
  organization_id uuid not null -> organizations,
  site_id uuid -> sites,
  reference varchar(20),                 -- auto 'EST00001' via trigger (mirror generate_jobsheet_reference)
  customer_id uuid -> customers,
  vehicle_id uuid -> vehicles,
  advisor_id uuid -> users,
  mileage integer,                       -- optional
  -- lifecycle
  status varchar not null default 'draft',   -- see 2.3
  valid_until date,                          -- "valid until" / auto-expire
  public_token text,                         -- tokenised customer portal (mirror health_checks)
  token_expires_at timestamptz,
  sent_at timestamptz,
  first_opened_at timestamptz,
  responded_at timestamptz,
  -- conversion
  converted_to_jobsheet_id uuid -> jobsheets,
  converted_at timestamptz,
  -- content
  customer_notes text,                   -- customer-visible
  internal_notes text,                   -- staff-only
  is_draft boolean not null default true,-- mirror jobsheet drafts (work lines attach pre-commit)
  created_by uuid -> users,
  created_at timestamptz default now(),  -- Document Date
  updated_at timestamptz default now(),
  deleted_at timestamptz, deleted_by uuid -> users,
  unique (organization_id, reference)
)
```
+ `organization_settings.next_estimate_number integer default 1` (per-org counter, mirror jobsheets).

### 2.2 `repair_items.estimate_id` (THE reuse hinge)
Add **`repair_items.estimate_id uuid` (nullable FK → estimates)** — exactly the pattern that
added `jobsheet_id` (migration `20260623180000`). Update the parent CHECK to
`health_check_id IS NOT NULL OR jobsheet_id IS NOT NULL OR estimate_id IS NOT NULL`.
Estimate lines: `source='estimate'`. The **entire pricing/labour/parts/VAT engine + service
packages work unchanged** (the pricing trigger is parent-agnostic — reads
`repair_item.organization_id`). Same `repair_labour` / `repair_parts` / `repair_options`,
same `/repair-items/:id/*` labour+parts routes.

### 2.3 Status model (borrowed from the VHC send/response machine)
`draft → sent → opened → accepted | partial | declined → expired`; terminal: `converted`,
`cancelled`. Reuse the `validTransitions` style guard (a small estimate-specific map in the
new route, mirroring `health-checks/helpers.ts`). Per-line decision recorded on the line via
the existing `repair_items.customer_approved / outcome_status / outcome_source` columns.

---

## 3. API (`apps/api/src/routes/estimates.ts`, mirrors `jobsheets.ts`)

Gated by `requireModule('estimates')`. Reuse `formatRepairItem` / `shapeWorkLine`.

- `GET /` list · `GET /:id` detail (`shapeEstimate`, mirror `shapeJobsheet`)
- `POST /draft` · `POST /:id/commit` · `POST /:id/discard` — draft lifecycle (copy jobsheets)
- `PATCH /:id` · `DELETE /:id` (soft)
- `GET /:id/work-lines` · `POST /:id/work-lines` · `POST /:id/work-lines/from-package`
  — copy from jobsheets; lines `source='estimate'`, pre-priced but **NOT** pre-authorised
  (customer authorises them).
- **`POST /:id/send`** — generalise the VHC publish: mint `public_token` + `token_expires_at`,
  set `valid_until`, `status→sent`, queue `estimate_ready` comms (SMS/email), schedule chases.
- **`POST /:id/make-jobsheet`** — copy **authorised** lines into a NEW jobsheet
  (reuse jobsheet create + work-lines), stamp `converted_to_jobsheet_id`, `status→converted`.
  Mirror Garage Hive "Make Jobsheet" / "Copy Authorised Lines".

### Public portal (the one substantial NEW piece)
Generalise `apps/api/src/routes/public.ts` so the token resolves an **estimate** as well as a
health_check (or add `/api/public/estimate/:token` reusing the same approve/decline/sign
handlers — they operate on `repair_items` by id, which now carry `estimate_id`). Reuse the
expiry 410 check, `customer_activities` tracking, signature storage, and confirmation comms.

### Comms / PDF
- Add `estimate_ready` template type to `DEFAULT_TEMPLATES` (`template-renderer.ts`) with
  `{{estimateTotalIncVat}}`, `{{validUntil}}`. Reuse the org-credential + `communication_logs`
  pipeline. (Log estimate sends: add nullable `estimate_id` to `communication_logs`, or
  polymorphic `document_id`+`document_type`.)
- PDF: add `generateEstimatePDF()` variant of `pdf-generator` (work lines + pricing + valid-
  until; **no** technician/inspection section). Suppress staff-only banners on the PDF.

---

## 4. Web UI (`apps/web/src/pages/Estimates/*`, mirrors `pages/Jobsheets/*`)

- `EstimatesList.tsx` ← copy `JobsheetList.tsx` (status pills instead of vehicle-status).
- `NewEstimate.tsx` ← copy `NewJobsheet.tsx` (two-column: booking-lite form + live work panel;
  draft lifecycle). Drop due-in/check-in; add `valid_until`.
- `EstimateDetail.tsx` ← copy `JobsheetDetail.tsx` tab scaffold → **Overview + Work** only
  (no Check-In/MRI). Add Send + Make-Jobsheet actions + customer-response timeline.
- **Refactor `WorkDetailsPanel`** to accept `parent={type:'jobsheet'|'estimate', id}` + base
  path instead of hard-coded `jobsheetId`. Same component then serves both (and can back the
  VHC later). `PackagePickerModal`, `CustomerCardModal` reused as-is.

### Documents nav restructure
- Extend `NavItem` (DashboardLayout) to support an **expandable group** (net-new; no nested nav
  exists today). Replace the flat "Jobsheets" item with a **"Documents"** group → Jobsheets,
  Estimates (auto-expand on `/jobsheets/*` | `/estimates/*`; tooltip when collapsed).
- New **`/documents` hub** (card grid like `SettingsHub`) with **+ Jobsheet / + Estimate** and
  recent lists — future-proof for an Invoices card.
- Routes in `App.tsx`: `/documents`, `/estimates`, `/estimates/new`, `/estimates/:id`
  (RequireModule `estimates`). Add `estimates` to BOTH `lib/modules.ts` registries.

---

## 5. Smart banners — shared `<CustomerInsightsBanner customerId vehicleId staffOnly>`

Rendered on Estimate + Jobsheet + VHC. Backed by ONE endpoint
**`GET /api/v1/customers/:id/insights?vehicle_id=`** returning all badge data in one call.

Presentation = **Salesforce "Dynamic Highlights"**: each badge renders **only when its trigger
fires**, hard-cap **~3–4 visible** (overflow → "Customer insights" popover), ordered
**safety/MOT > commercial > lifecycle**. Reuse `bg-rag-*` tokens; **icon+text, never colour-only**.
**Staff-only by default**; suppress on PDF/portal except opt-in MOT.

### v1 badges (data already in VHC)
| Badge | Trigger | Source |
|---|---|---|
| **New customer** (info) | no prior non-deleted health_checks for customer | `health_checks` count |
| **Lapsed / At-risk** (amber/red, shows last-visit date) | months since last visit ≥ 9/12/18 (org-configurable); "At-risk" = recency × prior frequency | `MAX(health_checks.created_at)` per customer |
| **£X advised work outstanding** (amber) + one-click add | open Follow-Up case(s) / deferred RED-AMBER lines | `follow_up_cases.deferred_value_snapshot`; `repair_items.outcome_status='deferred'` |
| **MOT due / expired / open recall** (amber/red) | `mot_expiry_date` within N days / past; recall on DVSA history | `vehicles.mot_expiry_date/mot_status`, `vehicle_mot_tests` |

### Deferred to phase 2 (need new compute)
- **VIP / high-value** — lifetime spend (`customers/:id/stats.totalAuthorisedValue` is currently
  hardcoded `0` → needs an RPC summing authorised `repair_items`).
- **Service due** — needs a per-org service-interval setting (`organization_settings`).

---

## 6. Phasing

- **P0 — Documents nav:** expandable group + `/documents` hub + `estimates` module key.
  Ships invisibly (module off).
- **P1 — Estimate core:** `estimates` table + `repair_items.estimate_id` + `estimates.ts` API
  (draft/commit/work-lines) + generalise `WorkDetailsPanel` + List/New/Detail pages.
- **P2 — Send & accept:** generalise public portal + `estimate_ready` comms + PDF variant +
  status machine + `valid_until`/expiry.
- **P3 — Make Jobsheet:** copy authorised lines → new jobsheet conversion.
- **P4 — Smart banners:** shared `CustomerInsightsBanner` + insights endpoint (4 badges),
  rendered on Estimate + Jobsheet + VHC.
- **Future:** Invoices document; VIP + Service-due badges; auto-chase unaccepted estimates
  (scheduler + SMS/email — assets exist); deposits / e-signature; legal Estimate-vs-Quote split.

## 7. Reuse summary (~70% reuse / 20% mirror / 10% new)
- **Reuse as-is:** repair_items pricing/labour/parts/VAT engine, service packages + apply-RPC,
  `/repair-items/*` routes, public portal approve/decline/sign, comms + templates pipeline,
  PDF generator skeleton, draft lifecycle, customer/vehicle lookup, Follow-Up + DVSA MOT data,
  RAG tokens, module-enablement + org-settings infra.
- **Mirror (copy + adapt):** `jobsheets.ts` → `estimates.ts`; Jobsheets pages → Estimates pages;
  `generate_jobsheet_reference` → `generate_estimate_reference`.
- **Net-new:** `estimates` table + `repair_items.estimate_id`; expandable Documents nav + hub;
  generalise public portal to non-VHC docs; shared `CustomerInsightsBanner` + insights endpoint;
  Make-Jobsheet conversion.
