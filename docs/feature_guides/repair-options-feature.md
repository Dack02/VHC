# Repair Options Feature

## Overview

The **Repair Options** feature lets an advisor price up **more than one way of fixing the same concern** and present those alternatives to the customer as a choice.

A classic example: a single concern — *"Front brake pads worn"* — can be quoted two ways:

- **Genuine Parts** — manufacturer (OEM) pads, longer warranty, higher price
- **OE Quality Parts** — equivalent-quality aftermarket pads, lower price

Both options sit under the **same repair item**. Each carries its own labour and parts, so each has its own independently-calculated total. The advisor can flag one as **recommended**, the customer picks the one they want, and the quote total updates to reflect their choice.

This is the "good / better / best" pattern common in automotive aftersales, applied at the level of an individual concern rather than the whole job.

---

## Key Concepts

| Term | Meaning |
|------|---------|
| **Repair Item** | A single concern/job on a health check (e.g. "Front brake pads worn"). The *parent*. |
| **Repair Option** | One priced alternative for that concern (e.g. "Genuine Parts"). A repair item can have many. |
| **Selected Option** | The option currently chosen — either pre-set by the advisor, or chosen by the customer in the portal. Drives the quote total. |
| **Recommended** | A flag the advisor sets to highlight one option as the suggested choice. Shown with a badge. |
| **Direct pricing** | When a repair item has **no options**, labour and parts attach straight to the item itself. Options and direct pricing are mutually exclusive on any given line of labour/parts. |

The core rule: **labour and parts belong to *either* the repair item directly *or* to one specific option — never both.** This is enforced in the database, so an option's price is always self-contained.

---

## How It Works (Advisor Side)

### 1. Open the options manager

From a repair item on the health check, the advisor opens the **Manage Options** modal. With no options yet, it prompts:

> *"No options yet. Add repair options to offer choices like Standard vs Premium parts."*

### 2. Create an option

Each option needs:

- **Name** (required) — e.g. `Genuine Parts`, `OE Quality`, `Standard`, `Premium`, `Budget`
- **Description** (optional) — customer-facing detail, e.g. *"OEM pads with 12-month warranty"*
- **Mark as recommended** (optional) — highlights this option to the customer

The advisor repeats this to add as many alternatives as the concern needs.

### 3. Add labour and parts to each option

Labour and parts are **not** entered in the options modal itself — they are added **inline in the Parts tab**, where each option appears as its own collapsible sub-section. For the brake example:

```
Repair Item: "Front brake pads worn"
  ├─ Option: OE Quality              £162.50 + VAT
  │    ├─ Labour:  Brake pads R&R   1.5 hrs @ £85.00 = £127.50
  │    └─ Parts:   Aftermarket pads  1 × £35.00       = £35.00
  └─ Option: Genuine Parts  ★RECOMMENDED   £182.50 + VAT
       ├─ Labour:  Brake pads R&R   1.5 hrs @ £85.00 = £127.50
       └─ Parts:   OEM pads          1 × £55.00       = £55.00
```

The same labour operation can be priced identically in both options; only the parts differ. (Labour and parts are fully independent per option — they can differ too, e.g. if one route needs more fitting time.)

### 4. Totals calculate automatically

As soon as labour or parts are added, edited or removed, the option's totals **recalculate in the database** — there is nothing to "save" or recompute by hand. Each option tracks:

- **Labour total** — sum of its labour lines (after any labour discount)
- **Parts total** — sum of its parts lines (quantity × sell price)
- **Subtotal** — labour + parts, excluding VAT
- **VAT amount** — calculated on the VAT-able portion only (VAT-exempt labour codes such as MOT are excluded)
- **Total inc VAT** — the headline figure the customer sees

### 5. Mark a recommendation (optional)

The advisor can toggle **Recommended** on any one option. This adds a `RECOMMENDED` badge in both the advisor view and the customer portal, and makes that option the customer's default selection.

### 6. Select an option

"Selecting" an option sets it as the active choice for that repair item. This can be done by the advisor (e.g. when taking the decision over the phone) or by the customer in the portal. Whichever option is selected is the one that feeds the quote total.

---

## How It Works (Customer Side)

When the quote is sent to the customer portal, any concern that has options renders as a **choice** rather than a single price.

- Each option is shown as a **radio button** with its **name**, **description**, and **total inc VAT**.
- The **recommended** option (or, if none is flagged, the first option) is **pre-selected** when the page loads.
- The customer selects the option they want.
- They can **approve or decline** only the option they have selected.
- Once approved, the choice is **locked in** and shown as e.g. *"Selected: Genuine Parts"* — it can no longer be changed.

The customer's choice is sent back with their approval, so the advisor's dashboard and the final quote reflect exactly what the customer picked.

---

## How Options Affect the Quote Total

The summary/quote total is built per repair item using this rule:

```
For each repair item:
  IF the item has a selected option:
      use the SELECTED OPTION's totals
  ELSE:
      use the item's own (direct) totals

Grand total = sum of every item's contribution
```

So an unselected concern with options contributes nothing misleading — the total always reflects the chosen alternative. If the customer switches from "Genuine Parts" to "OE Quality", the grand total drops accordingly.

---

## Data Model

All tables were introduced in `supabase/migrations/20260118300001_repair_groups_pricing_phase1.sql`.

### `repair_options`

One row per alternative. Belongs to exactly one repair item.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `repair_item_id` | UUID | FK → `repair_items.id`, `ON DELETE CASCADE` |
| `name` | VARCHAR(255) | e.g. "Genuine Parts", "OE Quality" |
| `description` | TEXT | Customer-facing detail |
| `labour_total` | DECIMAL(10,2) | Auto-calculated |
| `parts_total` | DECIMAL(10,2) | Auto-calculated |
| `subtotal` | DECIMAL(10,2) | Auto-calculated (ex VAT) |
| `vat_amount` | DECIMAL(10,2) | Auto-calculated |
| `total_inc_vat` | DECIMAL(10,2) | Auto-calculated |
| `is_recommended` | BOOLEAN | Highlight to customer |
| `sort_order` | INTEGER | Display order |

### `repair_items.selected_option_id`

The parent repair item carries a nullable FK back to the chosen option:

```sql
ALTER TABLE repair_items
  ADD CONSTRAINT fk_repair_items_selected_option
  FOREIGN KEY (selected_option_id) REFERENCES repair_options(id) ON DELETE SET NULL;
```

If the selected option is deleted, the field resets to `NULL` (the item falls back to direct pricing) rather than breaking.

### `repair_labour` and `repair_parts`

Both tables can attach to **either** a repair item **or** a repair option, guarded by a check constraint:

```sql
-- Same pattern on both repair_labour and repair_parts
CONSTRAINT check_labour_parent CHECK (
  (repair_item_id IS NOT NULL AND repair_option_id IS NULL) OR
  (repair_item_id IS NULL  AND repair_option_id IS NOT NULL)
)
```

This is what guarantees each option's price is self-contained and never double-counted against the parent.

### Automatic pricing

Database triggers keep totals current with no application-side maths:

- `trigger_labour_recalc` — fires on insert/update/delete of `repair_labour`
- `trigger_parts_recalc` — fires on insert/update/delete of `repair_parts`

Each trigger calls `calculate_repair_option_totals()` (or `calculate_repair_item_totals()` for direct pricing), which re-sums labour and parts, applies VAT correctly around VAT-exempt codes, and writes the totals back to the option/item.

### Relationship summary

```
health_checks
   └── repair_items                 (the concern)
         ├── selected_option_id ──┐  (which alternative was chosen)
         ├── repair_labour        │  (direct pricing — when no options)
         ├── repair_parts         │
         └── repair_options ◀─────┘  (the alternatives)
               ├── repair_labour     (labour for THIS option)
               └── repair_parts      (parts for THIS option)
```

---

## API Reference

All routes are under `/api/v1`. Mutating routes require `service_advisor` or above.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/repair-items/:id/options` | List all options for a repair item (with their labour & parts) |
| `POST` | `/repair-items/:id/options` | Create an option (`name`, `description`, `is_recommended`) |
| `PATCH` | `/repair-options/:id` | Update name / description / recommended / sort order |
| `DELETE` | `/repair-options/:id` | Delete an option (cascades to its labour & parts) |
| `POST` | `/repair-items/:id/select-option` | Set `selected_option_id` (pass `option_id`, or `null` to clear) |
| `GET` · `POST` | `/repair-options/:id/labour` | List / add labour on an option |
| `GET` · `POST` | `/repair-options/:id/parts` | List / add parts on an option |

The customer-facing portal reads options through the public health-check endpoint, which returns each repair item's `options[]` array and `selectedOptionId`.

### Source locations

| Layer | Path |
|-------|------|
| DB schema & triggers | `supabase/migrations/20260118300001_repair_groups_pricing_phase1.sql` |
| Options API | `apps/api/src/routes/repair-items/options.ts` |
| Labour on options | `apps/api/src/routes/repair-items/labour.ts` |
| Parts on options | `apps/api/src/routes/repair-items/parts.ts` |
| Public/portal API | `apps/api/src/routes/public.ts` |
| Options modal | `apps/web/src/pages/HealthChecks/components/RepairOptionsModal.tsx` |
| Parts tab (per-option editing) | `apps/web/src/pages/HealthChecks/tabs/PartsTab.tsx` |
| Repair item row (badges/pricing) | `apps/web/src/pages/HealthChecks/components/RepairItemRow.tsx` |
| Summary/quote totals | `apps/web/src/pages/HealthChecks/tabs/SummaryTab.tsx` |
| Customer portal | `apps/web/src/pages/CustomerPortal/CustomerPortalContent.tsx` |

---

## Worked Example: Genuine vs OE Quality Brake Pads

1. **Concern raised** — Technician flags *"Front brake pads worn"* (RAG red). It becomes a repair item.
2. **Advisor opens Manage Options** and adds two:
   - **OE Quality** — *"Equivalent-quality aftermarket pads, 12-month warranty"*
   - **Genuine Parts** — *"Manufacturer OEM pads, 2-year warranty"* — marked **Recommended**
3. **Advisor prices each** in the Parts tab:
   - OE Quality → 1.5 hrs labour (£127.50) + aftermarket pads (£35.00) → **£162.50 + VAT = £195.00**
   - Genuine Parts → 1.5 hrs labour (£127.50) + OEM pads (£55.00) → **£182.50 + VAT = £219.00**
4. **Quote sent.** In the portal the customer sees two radio options; **Genuine Parts** is pre-selected because it's recommended.
5. **Customer chooses OE Quality** to save money, and approves.
6. **Quote total updates** to use the OE Quality pricing (£195.00). The advisor's dashboard shows the customer picked *OE Quality*, and the line is locked as approved.

---

## Summary

The Repair Options feature lets a dealership:

1. **Offer choice on a single concern** — price the same fix multiple ways (e.g. Genuine vs OE Quality parts).
2. **Keep each price self-contained** — labour and parts attach to one option, enforced at the database level.
3. **Cost nothing to maintain** — option totals recalculate automatically via triggers, with VAT handled correctly.
4. **Guide the customer** — flag a recommended option that becomes their default.
5. **Let the customer decide** — they pick an option in the portal, approve it, and it locks in.
6. **Stay accurate** — the quote total always reflects the selected option, updating instantly if the choice changes.
