# Online VHC Performance — Report Spec

**Goal:** Of health checks **sent online**, how does **red/amber** work convert, split by *who actually
authorised it* — the customer themselves online, or offline (they called / we called)? Plus the funnel
(open/response rates, time-to-open, time-to-authorise) and a per-advisor breakdown.

Built to mirror the **Overview Report** (`/reports/daily-overview`): daily/weekly/monthly table, date/site
filters, CSV export, same RAG/£ math via `lib/metrics.ts` so figures never drift.

## Definitions (decided with owner 2026-06-29)

- **Sent online** = `health_checks.sent_at IS NOT NULL` (a public portal link went out by SMS/email).
- **Three cohorts** (classified per red/amber line item):
  - ① **self-serve online** — `repair_items.outcome_source = 'online'` (customer tapped approve/decline in the portal).
  - ② **sent online → authorised offline** — `sent_at` set but `outcome_source <> 'online'` (phone / in-person; `authorization_method` = `phone`|`in_person`).
  - ③ **never sent online** — `sent_at IS NULL` (pure offline workflow).
- **Auth Rate = £-value, three-way split.** For red and amber separately, each cohort shows
  `Authorised £%` / `Declined £%` / `Deferred £%` of **responded value** (authorised+declined+deferred).
  `pending £` (no decision) is tracked but excluded from the % base. Item £ via `calcItemTotal`; group
  authorisation rolls up to approved children (canonical rule).
- **Red/amber = inspection items only** (`source <> 'mri_scan'`), matching the Overview Report; RAG via
  `deriveRagStatus` (direct `rag_status`, else `check_results` junction). MRI is a separate stream, excluded.
- **Funnel** (sent subset): opened (`first_opened_at`), responded (`first_response_at`); rates over `sent`.
- **Avg time to open** = mean(`first_opened_at − sent_at`). **Avg time to authorise** = mean(`first_response_at −
  sent_at`), all responders (auth or decline). Guarded `>= sent_at` for clock skew. `delivered_at` /
  `fully_responded_at` are NOT populated (no delivery webhook) — avoided.
- **Bucketing**: `due_date ?? created_at` → `periodKeyForDay()` (day / Mon-week / month), Overview parity.
- **Advisor**: attributed by `health_checks.advisor_id`. Per advisor: funnel + online red/amber auth£% +
  self-serve £ vs offline-authorised £ (i.e. did the customer authorise themselves, or did we chase?).

## API

`GET /api/v1/reports/online-vhc` — params `date_from, date_to, site_id, group_by`. Returns:
```
{ period, groupBy,
  periods: [{ date, sent, opened, responded, openRate, responseRate, avgHrsToOpen, avgHrsToAuthorise,
              redAuthPct, amberAuthPct, redAuthValue, amberAuthValue }],
  totals: { …same… },
  cohorts: { red:{online,sentOffline,neverSent}, amber:{…} },  // each = {identified,authorised,declined,
                                                               //   deferred,pending,respondedValue,authPct,declinedPct,deferredPct}
  advisors: [{ id,name, sent,opened,responded,openRate,responseRate,avgHrsToOpen,avgHrsToAuthorise,
               redAuthPct,amberAuthPct, onlineAuthValue, offlineAuthValue, selfServeSharePct }] }
```
`GET /api/v1/reports/online-vhc/export` — CSV of the periods table.

## Web

`apps/web/src/pages/Reports/OnlineVhcPerformance.tsx` — route `/reports/online-vhc`, card in ReportsHub
("Sales & Conversion" group). Sections: cohort comparison matrix (the core answer) → per-period table
(day/week/month, like Overview) → advisor table. Uses shared `useReportFilters` / `useReportData` /
`ReportFiltersBar` / formatters.

## Data note (dev)

Only **Central Garage** has online-send data (220 sent, Feb–Jun 2026; 138 opened, 56 responded). Self-serve
online converts red ~63% vs ~35% when chased offline — the contrast this report surfaces. No migration needed.
