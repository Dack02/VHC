# Metrics Glossary

One definition per KPI. The canonical implementations live in
`apps/api/src/lib/metrics.ts` — if a number on screen disagrees with this
document, one of the two is a bug.

## Item-level building blocks

| Term | Definition |
|---|---|
| **Identified** | A live (non-deleted), top-level repair item. Children of groups roll up into their parent — they are never counted separately. Value is inc-VAT, preferring the selected price option's totals, falling back to labour + parts + 20% VAT when `total_inc_vat` is 0. |
| **Authorised** | An identified item the customer said yes to: `customer_approved = true` OR `outcome_status = 'authorised'`. A group whose children are approved counts as authorised for the sum of its approved children's values. Deleted items are never authorised. |
| **Declined / Deferred** | Identified items with `outcome_status` of `declined` / `deferred`. |
| **Decision** | Any recorded customer response on a live item: authorised, declined or deferred (or `customer_approved = true`). |
| **RAG status** | Red > amber > green, from two sources (matching `reports.ts`): the item's own `rag_status` column (set for **MRI** and manually-added items) takes priority, falling back to the worst linked check-result status (inspection-checklist items). Omitting the direct column silently drops every MRI item from red/amber sold % — they are mutually exclusive per item in practice. |

## Health-check-level metrics

| Metric | Definition | Where |
|---|---|---|
| **Presented** | An HC with ≥1 identified item that reached the customer — digitally (`sent_at` set) or via a recorded decision (phone authorisation). | Dashboard, Reports |
| **Conversion** | Of the HCs *presented* in the period, the share with ≥1 authorised item. Numerator ⊆ denominator, so always 0–100%. | Dashboard "Conversion", Reports summary, advisor leaderboards |
| **Conversion (site comparison)** | Status-level proxy (that report doesn't fetch items): HCs with status `authorized`/`completed` ÷ HCs that reached a customer-facing status. | Operational Efficiency report |
| **HC Completion Rate** | HCs performed ÷ eligible jobs (jobs minus no-shows). A *throughput* metric — unrelated to sales conversion. | Daily Overview report ("conversionRate" in that payload), daily SMS summary |
| **Value Sold %** | Authorised £ ÷ identified £ for the period. | Today page (formerly mislabelled "Conversion Rate") |
| **Red / Amber Sold %** | Authorised red/amber *inspection items* ÷ identified red/amber inspection items (counts, not values). **Inspection only — excludes MRI** (`source = 'mri_scan'`), which is its own sales motion. Today-scoped on the dashboard's flow strip; month-scoped in Monthly Performance. | Dashboard, Reports daily overview |
| **MRI Sold %** | Authorised manufacturer-recommended items ÷ identified MRI items (counts, all RAG levels combined). Tracked separately from inspection red/amber because it is a distinct sales motion. The daily SMS instead *blends* MRI into its red/amber % and shows a separate MRI £ line — the dashboard chooses to split the conversion % instead. | Dashboard (Today flow + Monthly) |
| **MRI Identified / Sold £** | Inc-VAT value of MRI items identified / authorised. Included in the combined £ totals (Avg Identified/Sold, Authorized £), and broken out as its own line in the daily SMS. | Daily SMS, Reports daily overview |
| **Completed** | HCs with status `completed`, `authorized` or `declined` — i.e. the customer has actioned it. | Dashboard "Completed" |
| **Avg Time to Open** | Mean of `first_opened_at − sent_at` for HCs in the period with both timestamps. This is time-to-*open*, not time-to-decision. | Dashboard (formerly mislabelled "Avg Response") |
| **Avg Identified / Avg Sold** | Identified £ (or authorised £) ÷ HC count for the month. | Monthly Performance |
| **HCs / Day** | Inspections completed (post-`tech_completed` statuses) ÷ days elapsed in the month (full month for previous-month comparisons). | Monthly Performance |
| **Technician "completed today"** | HCs with `tech_completed_at` today. (Not `updated_at` — that re-counted old jobs whenever any field changed.) | Dashboard team panel |
| **Advisor of the Month** | Highest score among advisors with ≥5 HCs: `0.6 × red sold % + 0.4 × normalised total sold`. | Monthly Performance |

## Item Performance report (per inspection item)

Keyed by **inspection item** (`template_items`, e.g. "ABS Warning Light"), grouped
across all templates by **normalised name** (`trim → collapse whitespace → lowercase`;
displayed with the most common original casing). Implementation:
`apps/api/src/services/item-report-service.ts`.

| Metric | Definition |
|---|---|
| **Inspected** | Count of `check_results` for the item with a real RAG (`red`/`amber`/`green`). Excludes `not_checked`/null. Counts findings, so `instance_number` duplicates each count. |
| **Red / Amber** | Count of `check_results` for the item with that `rag_status`. |
| **Flagged** | Red + Amber — the "how often raised as a concern" headline. |
| **Flag rate** | Flagged ÷ inspected. |
| **Identified £ (per item)** | [Identified](#item-level-building-blocks) £ of `source = 'inspection'` repair items whose linked findings include this item, attributed **once per distinct linked item name** per repair (via `repair_item_check_results → check_results → template_items`). A repair spanning two *different* items adds to both; two findings of the *same* item add once. |
| **Sold £ (per item)** | The identified set restricted to [authorised](#item-level-building-blocks) (incl. the group-children fallback). |
| **Conversion / Approval** | Sold £ ÷ identified £ (value); sold item count ÷ identified item count (approval %). |
| **Missed** | Declined £ + deferred £ for the item. |

**Reconciliation (important).** Because per-item revenue can overlap (one repair, two
items), the **sum of item rows is not the true total**. The report's `summary.totals`
are therefore independent, **de-duplicated** scalars (each repair counted once), and
`summary.unmapped` carries revenue that can't be attributed to an inspection item
(`source` of `mri_scan`/`manual`/`dms_prebooked`, or no junction link). Item rows are for
*per-item attribution*; the summary is the honest grand total. This report's universe is
the **dual-date set** (below), so it reconciles with the dashboard; `/financial` uses
`repair_items.created_at` and raw `total_inc_vat`, so small differences there are expected.

## Period scoping

Dashboard, Today, Monthly KPIs and Reports all use the same **dual-date set**:
HCs with `due_date` in range, plus HCs with no due date `created_at` in range,
**plus** HCs whose items were actioned (`outcome_set_at`) in range — so sales
actioned today on yesterday's booking land in today's numbers.

## Alert rules

- **Overdue**: `promised_at` in the past, excluding terminal states
  (`completed`, `cancelled`, `expired`) and vehicles that never arrived
  (`awaiting_arrival`, `no_show`).
- **Expiring link**: `token_expires_at` within 24h while the HC is in a
  customer-facing status (`sent`, `delivered`, `opened`, `partial_response`).
