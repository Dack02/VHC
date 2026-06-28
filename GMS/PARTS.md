# GMS — Parts & Stock (Accounting-Grade Plan)

> Branch: work on `dev` · Status: **PLAN — awaiting Leo's review before P0 build (2026-06-28)** · Author: Leo + Claude
> Locked (Leo, 2026-06-28): **two modes — Simple (no stock, parts→P&L cost) + Full (stock); VHC-only plans = Simple only**
> (decision 0) · **close = customer invoice** · **Xero = first accounts package**. Remaining decisions in §1/§13.
> Companion to [`REPAIR_TYPES.md`](./REPAIR_TYPES.md) (this module closes its deferred **Parts-module
> margin** piece — §4.4/§8), [`JOBSHEET.md`](./JOBSHEET.md), [`ESTIMATES.md`](./ESTIMATES.md),
> [`WORK_DETAILS.md`](./WORK_DETAILS.md), [`RESOURCE_MANAGER.md`](./RESOURCE_MANAGER.md).
> **Additive only. Multi-tenant. No `supabase db reset` — ever (see `rules.md`).**

## 0. TL;DR

Evolve the "lite" parts module (a flat autocomplete dictionary + priced quote lines) into a **full,
accounting-grade Parts & Stock module** designed from the **double-entry ledger outward**.

- **Two modes, plan-gated (NEW — Leo, 2026-06-28).** **Simple mode** (the default, and the *only* option for
  VHC-only tenants): **no stock tracking** — parts are priced job lines whose cost is sent to accounting as a
  **direct P&L cost** at the invoice. **Full mode** (GMS-tier opt-in): everything below — perpetual stock on the
  balance sheet, goods-in, valuation, returns. Same `repair_parts` line, same close→invoice trigger; Full mode
  only *adds* the balance-sheet machinery. **The bullets below describe Full mode** unless noted (see §2 "Two
  modes" and §6 "Simple-mode journals").
- **A part IN is a balance-sheet asset (or a deferred cost).** Receiving *stock* books **Dr Inventory / Cr
  GRNI** — it is *not* an expense; it sits on the balance sheet until sold. An *order-in (non-stock)* part's
  supplier invoice is parked on a balance-sheet **WIP / uninvoiced-parts clearing** account, **not** expensed
  on arrival — so its cost is still held back until the sale (§6 Event 4A).
- **A part OUT is a P&L cost, recognised against its revenue.** When the part is invoiced out, an automatic
  journal moves the cost **off the balance sheet → COGS** (Dr COGS / Cr Inventory for stock; Dr COGS / Cr
  WIP-clearing for non-stock) **and** the sale books **Dr AR / Cr Parts Sales / Cr VAT Output**. Matching
  principle: **cost and revenue land in the same event, on the same date** — for *both* forks.
- **The UK independent reality is order-in-per-job, not warehouse stock.** Most garages hold almost nothing;
  they order parts from a factor per job and **return the unused ones for credit**. So **"non-stock /
  order-in" is the DEFAULT path**, and held stock is the minority. The two load-bearing features are
  (1) **PO-from-job → goods-in/GRN**, and (2) the **"parts to return" loop with supplier credit**.
- **One movements ledger is the source of truth.** `stock_movements` (append-only) gives both
  **quantity-on-hand** (sum of `qty_delta`) and **valuation** (sum of stored `total_cost`). `qty_on_hand` is a
  derived cache; **SOH may only change by inserting a movement** — the single invariant of the whole module.
- **Journal-ready, not a GL.** We do **not** build a general ledger now. We capture **immutable, balanced
  Dr/Cr ledger rows** (`inventory_journal`) with nominal/tax codes + source refs, plus a per-tenant
  **code-mapping layer**, so a future Xero/QuickBooks/Sage integration is "map codes + push documents", not a
  schema rewrite.
- **Costing = weighted-average (WAVCO), perpetual.** Two fields per SKU (`qty_on_hand`, `average_cost`),
  FRS-102 compliant, no FIFO layer table. WAVCO at receipt is **provisional** (rolled from the PO/expected
  cost); the supplier invoice trues it up on the residual on-hand qty only (§6 Event 2). Designed so FIFO can
  be added later without breaking callers.
- **COGS recognised at the real "invoiced out" event — at the BILLING DOCUMENT, not just the VHC.** The seam
  is the document's close/invoice event: VHC `POST /:id/close` (`status='completed'`, `closed_at` set) **and**
  jobsheet close (`jobsheets.closed_at`, a first-class P2 trigger, §13 Q4), since many billed parts sit on a
  jobsheet or estimate that never spawns a VHC. We **snapshot** unit cost immutably at that event (mirroring
  `estimates.authorised_total`), and **extended COGS = `quantity × cogs_snapshot`**.
- **Reuse, don't replace.** Extend `parts_catalog` (→ item master) and `repair_parts` (the priced job line
  stays the single consumption point across VHC/Jobsheet/Estimate). New tables hang off `repair_parts.id`.
  Parts margin by `repair_items.repair_type_id` closes the deferred Repair Types reporting loop.

---

## 1. Locked / recommended decisions

> **CONFIRMED by Leo (2026-06-28):** (a) **Close = the customer VAT invoice** — a closed billing document IS
> the invoice; close stamps `invoice_number` + `tax_point_date` and fires the COGS *and* sale journals together
> (decision 3/4, §13 Q3). (b) **Xero is the first/target accounts package** — the mapping layer, default
> code seed, and the P4 push target all orient to Xero's UK chart + tax types (§13 Q7/Q8). (c) Remaining
> items below stay **RECOMMEND** pending Leo's full read-through of this doc before any P0 build.

Each remaining item marked **RECOMMEND** for Leo to confirm in §13. Bias: accounting-correctness + UK-independent reality.

0. **CONFIRMED (Leo, 2026-06-28) — Two parts modes, plan-gated: `simple` (default) and `full`.**
   - **Simple — no stock tracking.** Parts are priced `repair_parts` lines; their **cost is sent to accounting
     as a direct P&L cost** (`Dr Parts COGS / Cr Accounts Payable`) at the billing-document close, alongside the
     sale. **No** inventory asset, GRNI, WIP, PO/GRN, `stock_movements`, or stock-based returns. This is the
     default for every tenant and the **only** option on **VHC-only plans**.
   - **Full — everything in this doc.** Perpetual stock on the balance sheet (Events 1–6), goods-in, valuation,
     the returns loop. Requires the `parts_stock` module, which is **off on VHC-only plans** (mirrors how
     `jobsheets` is GMS-tier-only).
   - One setting `organization_settings.parts_mode ENUM('simple','full')` defaults `'simple'`; it may be set
     `'full'` **only** when the `parts_stock` module entitlement is on. Both modes share the same `repair_parts`
     line and the same close→invoice trigger; Full mode only *adds* the inventory legs. **Cost-timing in Simple
     mode (expense at close vs at purchase) — see §13 Q12; RECOMMEND at close (matched to the sale).**

1. **RECOMMEND — Costing method: weighted-average cost (WAVCO), perpetual.** Per SKU keep only
   `qty_on_hand` + `average_cost`; each receipt rolls the average
   (`new_avg = (qoh·old_avg + qty_in·cost_in)/(qoh+qty_in)`); issues leave at current average. FRS-102 compliant,
   no cost-layer table, robust to partial returns, and near-identical to FIFO for order-in parts received-then-issued
   same-day. **The receipt re-roll uses the PO/expected cost and is explicitly *provisional*** — the supplier
   invoice trues it up against on-hand qty only (§6 Event 2). **WAVCO behaviour when `qty_on_hand ≤ 0` is
   defined in §5.4** (a negative-SOH average is meaningless; the catch-up receipt is valued at receipt cost and
   the issue-time vs receipt-cost difference posts to Purchase Price Variance). **LIFO is prohibited under
   FRS 102 — not offered.** Field design stays generic so a `cost_layers` table (FIFO) can be added later; ship
   WAVCO as the only method initially.

2. **RECOMMEND — "Order-in / non-stock" is the DEFAULT; held stock is opt-in.** Every item carries
   `is_stocked BOOLEAN` (default `false`). `false` = ordered per job, never holds SOH, never touches the
   Inventory asset — **but its cost is still deferred to a balance-sheet WIP-clearing account at supplier
   invoice and only expensed at the sale (Event 4A)**, so non-stock matches stocked behaviour on the matching
   principle. `true` = perpetual stock item with SOH + valuation (Events 1→2→3). A tech must be able to add a
   part to a job **without** first creating a master record (ad-hoc sundry line). This single flag forks the
   inventory mechanics, **but not** the timing of cost recognition.

3. **RECOMMEND — COGS recognised at the BILLING-DOCUMENT close/invoice event, not at the VHC alone.** The
   trigger is the document's terminal "sold + delivered + billed" seam — VHC `POST /:id/close` (gated on
   `PENDING_OUTCOMES`/`INCOMPLETE_WORK`, verified at `apps/api/src/routes/health-checks/status.ts:1482,1504,1516`;
   `closableStatuses = ['authorized','declined','expired']` at `status.ts:1438`) **and** jobsheet close
   (`jobsheets.closed_at`, added as a first-class P2 trigger — see §13 Q4). Because `repair_parts` reaches a
   document **only** via `repair_items.health_check_id` (NOT NULL — there is no direct estimate/jobsheet FK on
   the part), parts billed off a jobsheet-direct or estimate line that never spawns a VHC would otherwise
   **never recognise COGS**; defining the event at the billing-document level closes that gap. At the event,
   exactly the **authorised** basket is the sold set — authorised `repair_items` **plus their selected
   `repair_option`** (§7.3) — and its `repair_parts` rows are the COGS to recognise. We **snapshot** unit
   cost/sell/VAT immutably (mirroring `estimates.authorised_total`, `20260626200000`); a `declined`/`expired`
   close with an empty authorised basket emits **no journal**.

4. **CONFIRMED (Leo, 2026-06-28) — "Close" is the invoice issuance: it stamps an invoice number + tax-point date.** A closed
   billing document **is** the customer VAT invoice for output-VAT purposes. The COGS-and-sale journal header
   carries an `invoice_number` + `tax_point_date` so Output VAT has a document behind it and reconciles to the
   real invoice (§6 Event 3b). VHC, jobsheet, and estimate-accepted paths each resolve their own invoice-number
   source. This lets `cogs_recognised_at`, `cogs_snapshot`, and the sale journal share one trigger.

5. **RECOMMEND — Build journal-ready movement + ledger rows now; NO internal general ledger.** We persist
   immutable balanced Dr/Cr rows (`inventory_journal` + `inventory_journal_lines`) with `internal_account_key`,
   `tax_code`, `source_event`, source-doc refs, and a `posting_status`. We do **not** compute trial balances,
   run a chart of accounts, or post to AP/AR sub-ledgers internally. A thin **mapping layer**
   (`account_code_map`, `tax_code_map`) resolves internal keys → provider codes when a GL is connected.
   Corrections = reversing rows, never edits (immutability = clean audit + clean future export).

6. **RECOMMEND — VAT depth for v1: a single per-line `tax_code` enum + isolated VAT lines; no MTD, no
   reverse-charge UI.** Parts are standard-rated 20% (reuse `organization_settings.vat_rate`). Store a
   `tax_code` (`STD_20` / `ZERO` / `EXEMPT` / `NO_VAT`) on every journal line so VAT sits on its own control
   line (never baked into inventory/COGS). The sale-side Output VAT line **reads the already-computed
   `repair_items.vat_amount`** rather than re-deriving it (so the journal ties to the customer's document,
   §6 Event 3b); we add **input VAT** capture on purchases. Full MTD/return filing is the future GL's job.

7. **RECOMMEND — Matrix (banded markup) pricing is the default sell-price engine.** Ordered cost-bands →
   markup% / multiplier, higher markup on cheap parts. One default matrix per org, optional per-category,
   override precedence: **job-line override → item `sell_price_override` → matrix → flat fallback**. This is
   the single highest-leverage margin feature (research: +8–10% blended margin vs flat markup). `pricing_matrix`
   + `pricing_matrix_bands` are **P0 tables fully specified in §5.12** (they were under-specified previously).

8. **RECOMMEND — Negative stock: allow-with-warning by default, per-org toggle to block.** Techs routinely
   book a part before the GRN is keyed; hard-blocking kills adoption. Allow the issue, drive SOH negative, flag
   it, surface a **Negative-Stock Exceptions** report to reconcile at receipt. The **valuation** correction
   path for issuing into / receiving out of negative SOH is defined in §5.4 (not just the quantity).

9. **RECOMMEND — Cores/surcharge: NICE (P3), not v1.** A core charge is a **refundable customer deposit
   (liability), not revenue**, with a parallel sub-state. Real but secondary for independents — model the
   fields from day one (`has_core`, `core_charge_amount`, `core_status`) but ship the workflow later. **The VAT
   treatment on forfeit is unresolved and must be confirmed with the accountant before build** (§6 cores).

10. **RECOMMEND — Module gating: new `'parts_stock'` key, `defaultOn: false`.** The existing lite catalog,
    suppliers, and `repair-items/parts` routes stay **ungated** (always-on). Only the new stock/goods-in/PO/
    returns/journal surfaces gate behind `parts_stock`. Parts reports sit behind the existing `reports` gate.

---

## 2. The mental model (the heart of this doc)

### Two modes (read this first)

The module ships in **two modes** (decision 0). They share the same priced job line and the same close→invoice
money event; they differ only in whether stock touches the balance sheet:

| | **Simple mode** (default; only option for VHC-only plans) | **Full mode** (GMS-tier opt-in via `parts_stock`) |
|---|---|---|
| Stock tracking | **None** — no qty-on-hand, no valuation | Perpetual (`stock_movements`, WAVCO) |
| Balance sheet | Parts **never** touch it | Inventory asset + GRNI / WIP / PPV |
| Part cost → P&L | **Direct cost at invoice** (`Dr Parts COGS / Cr AP`) | Relieved from Inventory/WIP at invoice |
| PO / goods-in / returns | Not required (optional supplier ref only) | Full PO → GRN → return loop |
| Tables used | (a) catalog + (d) line + (e) journal only | all of §5 |
| Journals (when GL connected) | sale invoice + a direct parts-cost bill | the full event set (§6) |

The five-layer model below is **Full mode**. **Simple mode collapses to three layers** — (a) catalog, (d) the
priced job line, (e) the journal — skipping (b) stock-on-hand and (c) the order-in stock buffer entirely.
Everything from §5.4 (`stock_movements`) onward is **Full-mode-only**; Simple mode needs only `parts_catalog` +
`repair_parts` + the journal/mapping tables. See §6's **Simple-mode journals** for the (much smaller) money trail.

### The five layers (Full mode)

A single physical part can occupy up to **five distinct conceptual layers**. Keeping them separate is the
whole design. UK-independent reality: **most parts skip layer (b) entirely** — they are ordered-in, fitted or
returned, and never become "stock".

```
 (a) CATALOG / ITEM MASTER        the SKU dictionary: part_number, description, category, cost, sell,
     parts_catalog (extended)     is_stocked, min/max, bin, preferred_supplier. KNOWLEDGE, not quantity.
            │
            │  is_stocked = true ──────────────┐         is_stocked = false (DEFAULT) ───────────┐
            ▼                                    ▼                                                 │
 (b) STOCK ON HAND                  (c) ORDER-IN (non-stock)                                       │
     qty_on_hand + average_cost         ordered per job from a factor;                            │
     valued on the BALANCE SHEET        NEVER an inventory asset;                                 │
     (Inventory asset).                 cost PARKED in WIP-clearing on                            │
     Movements = stock_movements        supplier invoice → COGS at sale;                         │
            │                           unused → RETURNED for credit.                             │
            │                                    │                                                 │
            └──────────────┬─────────────────────┘                                                 │
                           ▼                                                                        │
 (d) PRICED JOB LINE        repair_parts (UNCHANGED parent) — the part on a VHC / Jobsheet /        │
     the customer-facing     Estimate via repair_item_id|repair_option_id. cost_price, sell_price,  │
     line item.              margin, quantity. THE SINGLE CONSUMPTION POINT. New: stock_item_id +   │
                             purchase_order_line_id links, qty_fitted/qty_to_return, line status    │
                             (state machine §5.6).                                                  │
                           │                                                                        │
                           ▼                                                                        │
 (e) ACCOUNTING JOURNAL    inventory_journal (+ lines) — immutable, balanced Dr/Cr rows emitted at  │
     the money trail.       each event: goods-in, supplier invoice, COGS-on-close, return,          │
                            adjustment, core. Journal-ready for Xero/QBO/Sage. ◄────────────────────┘
```

### How one physical part flows (the order-in default — the common case)

1. Advisor adds "Front brake pads, £42 cost / £78 sell, qty 1" to a VHC repair group → a **(d) `repair_parts`**
   row. No master record needed (ad-hoc). Line status `requested`.
2. Advisor raises a **PO** to the factor from the job line (or it auto-consolidates onto a pending PO for that
   supplier). Line status `ordered`. **No journal yet** (nothing received).
3. Van delivers; advisor books **goods-in / GRN** against the PO. Because the item is **non-stock**, it does
   **not** enter SOH. Line status `received`.
4. The part is fitted. The supplier's invoice arrives → **Event 4A (invoice leg)**:
   `Dr WIP-clearing / Dr VAT Input / Cr AP`. The cost is **parked on the balance sheet**, *not yet* expensed —
   so it can match the sale whenever that lands (possibly a different VAT period).
5. Customer authorises + work completes; the billing document closes/invoices → **Event 4A (sale leg)**:
   `Dr COGS / Cr WIP-clearing` (cost expensed now) **and** the sale `Dr AR / Cr Parts Sales / Cr VAT Output`.
   Gross profit = sell − cost, both recognised in the same event. Line status `invoiced`.
6. **If the part was NOT used** (ordered 2 calipers, fitted 1, or the customer declined the line): the unused
   quantity (`qty_to_return`) forks to `to_return` → `returned` → `credited`. It appears on the
   **Parts-to-Return** report until the supplier credit lands. This is the money UK garages most often leak.

### How one physical part flows (the held-stock minority case)

1. Item is `is_stocked = true` (e.g. screenwash, common oil filter). Stock arrives on a PO → **goods-in**
   writes a `receipt` **(b)** movement (`+qty`, provisional `unit_cost`) and **Event 1**: `Dr Inventory /
   Cr GRNI`. `qty_on_hand` ↑, `average_cost` provisionally re-rolled.
2. Supplier invoice → **Event 2**: `Dr GRNI / Dr VAT Input / Cr AP`, clearing GRNI at the *received* value and
   posting any price variance to **Inventory** (on-hand) or **PPV** (already issued) — never COGS for unsold
   stock.
3. Advisor books the item onto a job → **(d) `repair_parts`** line links to the **(a/b) stock item**; an
   `issue` movement (`−qty × average_cost`) is written; SOH ↓.
4. The billing document closes → **Event 3a** cost: `Dr COGS / Cr Inventory` (asset leaves the balance sheet)
   **and Event 3b** sale: `Dr AR / Cr Parts Sales / Cr VAT Output`. Inventory → COGS → matched against revenue.

The flag `is_stocked` is the inventory fork: **non-stock = Event 4A (WIP-clearing buffer)**; **stocked =
Events 1→2→3a→3b (inventory asset then relieve)**. **Both defer the cost to the sale** and recognise COGS in
the same event as the revenue. Both forks live in one engine.

---

## 3. Current state (verified)

**EXISTS (the "lite" module):**

| Object | What it is | Reuse posture |
|---|---|---|
| `parts_catalog` (`20260202000002`) | Per-org part dictionary: `part_number`, `description`, `cost_price`, `is_active`. **No qty, no valuation, no supplier link.** UNIQUE(org, part_number). | **EXTEND** into the item master (§5.2). |
| `repair_parts` (`20260118300001` + `20260121000001`) | Priced line on a concern/option: `cost_price`, `sell_price`, `line_total`, `margin_percent`, `markup_percent`, `quantity DECIMAL(10,2) NOT NULL DEFAULT 1` (verified `20260118300001:229`), `allocation_type` (DEFAULT `'direct'`, `20260121000001:6`), `supplier_id`. XOR parent `repair_item_id`/`repair_option_id`. Reaches a document only via `repair_items.health_check_id` (NOT NULL) — **no direct estimate/jobsheet FK**. | **EXTEND** (add stock/PO links, qty split, line status §5.3). The single consumption point across VHC/Jobsheet/Estimate — do **not** fork it. |
| `suppliers` + `supplier_types` (`20260118300001`, `20260124000001`) | Supplier master + Dealer/Factor/Tyres/Other types. `seed_default_supplier_types()` is **backfill-loop only** (param `target_org_id`), **NOT** wired into `seedDefaultLibraries()`. | **REUSE** as-is (the PO supplier + the "Tyres" type for tyre parts). |
| DB pricing triggers (`calculate_repair_item_totals` / `_option_totals`) | Roll `Σ repair_parts.line_total` (sell) into `repair_items.parts_total` → subtotal → `vat_amount` → `total_inc_vat`. `calculate_repair_item_totals` sums by `repair_item_id` (`20260118300001:320`); `calculate_repair_option_totals` sums by `repair_option_id` (`:343`). **Neither reads `allocation_type`.** | **REUSE UNCHANGED.** New stock logic hangs *beside* these triggers, never inside them. |
| Pricing settings | `organization_settings.default_margin_percent` (40), `vat_rate` (20). | **REUSE** (matrix pricing + VAT). |

**CONFIRMED ABSENT (grep clean across `apps/ packages/ supabase/ docs/`):** stock-on-hand / qty tracking,
stock locations/bins, goods-in/receiving, purchase orders, stock-movement ledger, COGS/valuation, **any
invoice entity** (grep clean — `close` is the only "invoiced out" moment that exists), any
journal/ledger/nominal/tax-code/Xero/QuickBooks/Sage construct, returns/credits, catalog↔line FK,
reservation, supplier price lists, reorder logic, parts-margin-by-repair-type reporting. `repair_parts.cost_price`
is a free-typed, nullable snapshot (`20260203210001`) — **COGS will be understated until cost capture is
enforced** (gotcha §12; hard-gate in P2). `repair_items.repair_type_id` exists (`20260628130000`) but no RPC
aggregates parts margin by it — **this module builds that** (§8).

**NET:** everything below is **new tables + extensions + new routers**. The pricing engine, the three-document
polymorphism, suppliers, and the priced-line UI (`PartsTab.tsx`) are reused intact.

---

## 4. House conventions every new object obeys

Copied verbatim from the gold-standard `20260124000001_supplier_types.sql`. Non-negotiable:

1. **Tenancy:** every table `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`;
   `id UUID PRIMARY KEY DEFAULT uuid_generate_v4()`; `created_by UUID REFERENCES users(id)`;
   `created_at/updated_at TIMESTAMPTZ DEFAULT NOW()`; `UNIQUE (organization_id, <natural key>)`.
2. **Indexes (`IF NOT EXISTS`):** `idx_<t>_org ON (organization_id)`; partial active index
   `ON (organization_id, is_active) WHERE is_active = true` for lookups; plus report-supporting partials.
3. **RLS:** `ENABLE ROW LEVEL SECURITY` + four `DROP POLICY IF EXISTS / CREATE POLICY` (select/insert/update/
   delete), each `USING/WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid)`.
   App queries **also** filter `organization_id` explicitly (defense in depth).
4. **`updated_at` trigger:** `update_<t>_timestamp()` + `BEFORE UPDATE` trigger.
5. **Seeder + backfill** (lookups only): `seed_*_for_org(p_organization_id UUID)` with
   `INSERT … ON CONFLICT (organization_id, name) DO NOTHING`, called from
   `services/provisioning.ts:seedDefaultLibraries()` + a `DO $$ … FOR org IN SELECT id FROM organizations`
   backfill loop at migration bottom. **Verified** `seedDefaultLibraries()` (`provisioning.ts:335`) calls
   `seed_follow_up_config_for_org`, `seed_outcome_reasons_for_org`, `seed_hc_deletion_reasons_for_org`,
   `seed_tyre_reference_for_org` — all via the `rpc(fn, { p_organization_id: orgId })` shape. **New seeders must
   use the `p_organization_id` param name** to match that call shape (suppliers are *not* the precedent — they
   seed via the backfill loop only).
6. **Report RPCs:** `LANGUAGE sql STABLE`, `CREATE OR REPLACE`, `p_org_id` is a **parameter** (service-role
   only, never reads `current_setting`); footer `REVOKE ALL … FROM public, anon, authenticated; GRANT EXECUTE
   … TO service_role;`. **Aggregate in DB** — never fetch raw movement rows (PostgREST ~1000-row cap, §8).
7. **Migrations:** additive, `IF NOT EXISTS`/`IF EXISTS`, **unique timestamp** (verify — duplicate timestamps
   have bitten us twice). Never modify an applied migration.

---

## 5. Data model — additive only

**Thirteen new tables + two extensions.** Grouped by concern. (All carry the §4 conventions; only the
distinctive columns are listed.)

> **One canonical rounding point.** Money amounts are stored to **2 dp** everywhere they feed a journal or a
> valuation report: `stock_movements.total_cost` is computed **`ROUND(qty_delta × unit_cost, 2)`** and is the
> *single* source for both journal lines and valuation (§8 sums `total_cost`, never recomputes `qty×cost`).
> `unit_cost`/`average_cost` keep 4 dp for precision but are never summed directly into ledger totals. A
> cross-foot test asserts `Σ total_cost` (movements) = `Σ journal lines` to the penny.

### 5.1 `part_categories` — the grouping lookup (P0)

**Purpose:** single-level (optionally 2-level via nullable `parent_id`) category tree for items, reporting,
and the matrix. Seeded with garage-sensible defaults.

| Column | Type | Notes |
|---|---|---|
| `name` | VARCHAR(100) NOT NULL | UNIQUE(org, name). |
| `parent_id` | UUID NULL FK→part_categories | Optional 2nd level; v1 ships flat. |
| `is_system` | BOOLEAN DEFAULT false | "Other" undeletable, mirrors supplier_types. |
| `sort_order` | INTEGER DEFAULT 0 | Steps of 10. |

Seeder `seed_default_part_categories_for_org(p_organization_id UUID)`: *Oils & Fluids, Filters, Brakes,
Service Items, Tyres, Suspension & Steering, Electrical / Batteries, Exhaust, Consumables / Sundries
(999, system).*

### 5.2 `parts_catalog` — EXTENDED into the item master (P0)

**Purpose:** turn the flat dictionary into the SKU spine. **Additive `ALTER … ADD COLUMN IF NOT EXISTS`
only** — never drop/rename existing columns. The existing `(org, part_number)` UNIQUE + autocomplete keep
working untouched.

| New column | Type | Notes |
|---|---|---|
| `category_id` | UUID NULL FK→part_categories | |
| `is_stocked` | BOOLEAN DEFAULT false | **The fork.** false = order-in/non-stock (default). |
| `unit_of_measure` | VARCHAR(20) DEFAULT 'each' | each/litre/metre/set/pair enum. |
| `sell_price` | DECIMAL(10,2) NULL | Matrix-derived or fixed. |
| `sell_price_override` | DECIMAL(10,2) NULL | Manual fixed price wins over matrix. |
| `qty_on_hand` | DECIMAL(12,3) DEFAULT 0 | **Derived cache** — only `stock_movements` may change it (§5.4 invariant). |
| `average_cost` | DECIMAL(12,4) DEFAULT 0 | WAVCO rolling average (provisional at receipt). Valuation = stored movement `total_cost`, not `qty_on_hand × average_cost` (§5.4). |
| `min_qty` / `max_qty` | DECIMAL(12,3) NULL | Reorder point / reorder-up-to. |
| `bin_location` | VARCHAR(50) NULL | Free text "A-12". One field, not modelled. |
| `preferred_supplier_id` | UUID NULL FK→suppliers | Default order-in source. |
| `vat_code` | VARCHAR(20) DEFAULT 'STD_20' | Per-item tax code default. |
| `tyre_size` | VARCHAR(30) NULL | e.g. `205/55R16` (tyre = part + size + "Tyres" supplier type). |
| `barcode` | VARCHAR(64) NULL | Stored now; scanning UI deferred. |
| `superseded_by_id` | UUID NULL FK→parts_catalog | Single-hop "replaced by" pointer (alias search). |

> Multi-supplier price lists, lead-time, full supersession chains → child tables in a later phase (§10 P4).

### 5.3 `repair_parts` — EXTENDED (the priced job line stays the consumption point) (P1)

**Purpose:** link the priced line to its stock item + order line, give it a lifecycle, and make a single
ordered line **partially fit and partially return**, **without** touching the XOR parent rule or the roll-up
triggers. Additive columns only:

| New column | Type | Notes |
|---|---|---|
| `stock_item_id` | UUID NULL FK→parts_catalog | Anchors a line to a master SKU (NULL = ad-hoc sundry). |
| `purchase_order_line_id` | UUID NULL FK→purchase_order_lines | The order-in link. |
| `qty_fitted` | DECIMAL(10,2) NULL | Quantity actually fitted/billed (defaults to `quantity` on close if unset). **Extended COGS = `qty_fitted × cogs_snapshot`.** |
| `qty_to_return` | DECIMAL(10,2) NULL | Ordered-but-unused quantity routed to a supplier return (the "ordered 2, fitted 1 → return 1" split lives here, not in a second row). |
| `line_status` | VARCHAR(24) DEFAULT 'requested' | The state machine §5.6. |
| `stock_ownership` | VARCHAR(16) DEFAULT 'owned' | `owned` / `consignment` (consignment = no purchase booked until **used**; an *unused* consignment return needs no credit note — but a consignment part that is *issued and sold* DOES trigger a purchase at point-of-use, §6 Event 5). |
| `has_core` | BOOLEAN DEFAULT false | Core/surcharge (P3). |
| `core_charge_amount` | DECIMAL(10,2) NULL | Refundable deposit. |
| `core_status` | VARCHAR(24) NULL | Parallel core sub-state (P3). |
| `cogs_snapshot` | DECIMAL(12,4) NULL | Immutable **unit** cost locked at COGS recognition (NOT extended — multiply by `qty_fitted`). |
| `cogs_recognised_at` | TIMESTAMPTZ NULL | When COGS journal fired (idempotency guard; **cleared + reversed on document reopen**, §7.7). |

### 5.4 `stock_movements` — the immutable ledger (source of truth for qty + valuation) (P0)

**Purpose:** the append-only spine. **`qty_on_hand` and valuation are derived from this table; nothing else may
move stock.** One row per physical event.

| Column | Type | Notes |
|---|---|---|
| `stock_item_id` | UUID NOT NULL FK→parts_catalog | |
| `location_id` | UUID NULL FK→stock_locations | NULL = default location; on the row from day 1 so multi-site is additive. |
| `movement_type` | VARCHAR(20) NOT NULL | `receipt` / `issue` / `adjustment` / `return_in` / `return_out` / `transfer`. CHECK constraint. |
| `qty_delta` | DECIMAL(12,3) NOT NULL | Signed (+receipt/return_in, −issue/return_out). |
| `unit_cost` | DECIMAL(12,4) NOT NULL | Cost at the moment of movement (drives WAVCO + valuation). **Provisional at receipt** (PO/expected cost). |
| `total_cost` | DECIMAL(12,2) NOT NULL | **`ROUND(qty_delta × unit_cost, 2)`** — the single canonical money figure for journals + valuation. |
| `reference_type` | VARCHAR(24) | `goods_receipt` / `repair_part` / `stocktake` / `supplier_return` / `transfer`. |
| `reference_id` | UUID | The source doc row. |
| `repair_part_id` | UUID NULL FK→repair_parts | Direct back-link for issue/return movements. |
| `reason_code` | VARCHAR(40) NULL | Mandatory for `adjustment` (damage/shrinkage/mispick/found/correction/short). |
| `document_date` | DATE NOT NULL DEFAULT CURRENT_DATE | Accounting date; drives the journal `period_key` (§5.10). |
| `movement_at` | TIMESTAMPTZ DEFAULT NOW() | System timestamp. |

**Consistency rule (DB-enforced):** an `AFTER INSERT` trigger `apply_stock_movement()` updates
`parts_catalog.qty_on_hand += qty_delta` and re-rolls `average_cost` on `receipt`/`return_in` **inside the same
transaction**. The UI never writes `qty_on_hand`. This is the load-bearing invariant.

**WAVCO + negative-SOH rules (DB-enforced in `apply_stock_movement()`):**
- **Provisional cost at receipt.** The `receipt` movement's `unit_cost` is the PO/expected cost and re-rolls
  `average_cost = (max(qoh,0)·old_avg + qty_in·cost_in)/(max(qoh,0)+qty_in)`. The supplier invoice (Event 2)
  trues up only the **residual on-hand** qty; cost already issued is corrected via PPV, never re-rolled
  retroactively (§6 Event 2). WAVCO at receipt is documented as provisional.
- **Issuing into negative / receiving out of negative.** When `qty_on_hand ≤ 0`, `average_cost` is meaningless,
  so: an `issue` that drives SOH negative leaves at the last known `average_cost` and **flags** the row; when
  the catch-up `receipt` arrives, the receipt qty is valued at **receipt cost**, and the difference between the
  issue-time cost used and the receipt cost (for the qty that crossed zero) posts to **Purchase Price
  Variance** (`purchase_price_variance`), not to `average_cost`. The Negative-Stock report catches the
  quantity; this rule defines the **valuation** correction so it never silently drifts.

### 5.5 `stock_locations` — bins / sites (P0, single default; multi-site P4)

**Purpose:** where stock physically sits. Ships with one auto-seeded "Main" location per org; `location_id`
lives on `stock_movements` from day 1 so multi-location is a non-breaking add. Columns: `name`, `code`,
`is_default`, `sort_order`. (Mirror `Settings/VehicleLocations.tsx`.)

### 5.6 The part-line state machine (`repair_parts.line_status`)

```
requested ──cancel──► cancelled (terminal)
   │ (placed on PO)
   ▼
ordered ──supplier can't supply──► back_order ──re-source/wait──┐
   │                                                            │
   ▼ ◄──────────────────────────────────────────────────────────┘
received  (GRN booked; on shelf for the job)
   │
   ├── used (qty_fitted) ──► fitted ──(doc closed/invoiced)──► invoiced (terminal — billed to customer)
   │
   ├── customer DECLINES the line ──► declined ──► to_return (non-stock) | return_in (stocked)
   │
   └── not used (qty_to_return) ──► to_return ──(on supplier RMA)──► returned ──(credit reconciled)──► credited (terminal)
                                                          └── factor rejects ──► return_rejected (write-off / refit)
```

A **`declined`** transition exists from `received`/`fitted`: a part ordered/received and then declined on a
`partial_response`/per-item decline (CLAUDE.md status list; `outcome_status` filtering at `status.ts:1494`)
routes to `to_return` (non-stock) or `return_in` (stocked). **Declined-line parts appear on the Parts-to-Return
report** (§8), not only "removed/reduced" ones — a received-but-declined part is exactly an "items to return"
case.

Parallel **core sub-state** (`core_status`, only when `has_core`): `core_billed → dirty_core_held →
core_in_transit → core_credited` (+ `core_short_credited` / `no_core_returned`). Runs independently — a core
can still be `core_in_transit` long after the part line is `invoiced`.

### 5.7 `purchase_orders` + `purchase_order_lines` — order-in (P1)

**`purchase_orders`:** `supplier_id`, `site_id`/`location_id`, `po_number` (per-org sequence), `status`
(`draft → ordered → part_received → received → invoiced → closed → cancelled`), `supplier_invoice_ref`,
`ordered_at`, `received_at`, `notes`. **`purchase_order_lines`:** `purchase_order_id`, `stock_item_id` NULL,
`repair_part_id` NULL (the job link), `description`, `part_number`, `qty_ordered`, `qty_received`,
`unit_cost`, `line_status`, `is_stocked_at_receipt` (snapshots the fork), `reconciled` (BOOLEAN — set when the
line is consumed onto a job or returned; drives Orphan-Parts, §8). Auto-consolidation: a new order-in line for
a supplier with an open `draft` PO appends to it (GA4 pattern).

### 5.8 `goods_receipts` + `goods_receipt_lines` — receiving / GRN (P1)

**Purpose:** record what physically arrived against a PO; emit the inbound movement + GRNI journal.
`goods_receipts`: `purchase_order_id`, `received_by`, `received_at`, `grn_number`, `notes`.
`goods_receipt_lines`: `goods_receipt_id`, `purchase_order_line_id`, `stock_item_id` NULL, `qty_received`,
`unit_cost` (editable on receipt if different from ordered), `condition` (`ok`/`damaged`). Receiving a
**stocked** line writes a `receipt` `stock_movements` row + **Event 1** journal; a **non-stock** line writes
**no movement** (cost waits for the supplier invoice, Event 4A) but still advances the line to `received`.

### 5.9 `supplier_returns` + `supplier_return_lines` — the returns / credit loop (P2)

**Purpose:** first-class "parts to return" + credit reconciliation (the #1 UK leak). `supplier_returns`:
`supplier_id`, `rma_ref`, `status` (`to_return → shipped → credited → rejected`), `credit_note_ref`,
`credit_amount`, `reconciled_po_id`, `returned_at`. `supplier_return_lines`: `supplier_return_id`,
`repair_part_id`, `stock_item_id` NULL, `purchase_order_line_id` NULL, `qty`, `unit_cost`,
`reason` (`unused`/`declined`/`core`/`warranty`/`damaged`).

**Scope rule — supplier returns are for UNUSED / UNSOLD parts** (`line_status` `to_return` reached *before*
`invoiced`). Mechanics by fork:
- **Stocked, unused:** writes a `return_out` movement (SOH ↓) + the return journal (Event 5).
- **Non-stock, unused:** reverses the Event-4A WIP-clearing cost (the cost was parked, never expensed) — no
  COGS to relieve.
- **Already-sold part returned to supplier** (COGS taken + customer invoiced, then returned): this is **two
  linked legs** — a **customer credit** (reverse the sale + COGS) *and* a supplier return. **Out of scope for
  P2** unless explicitly added; the P2 return path asserts `line_status != 'invoiced'`. Flagged in §13 Q10.
- **Consignment issued-and-sold:** a purchase **is** triggered at point-of-use, so this is not a no-op — the
  point-of-consumption purchase journal must exist before any return (§6 Event 5).

Surcharge/core returns inherit the original PO/GRN ref.

### 5.10 `inventory_journal` + `inventory_journal_lines` — journal-ready double-entry (P2)

**Purpose:** the money trail. **Immutable** balanced Dr/Cr rows an accountant (or a future GL push) consumes
directly. Header + ≥2 lines, ΣDr = ΣCr enforced.

**`inventory_journal` (header):** `source_event` (`goods_receipt`/`purchase_invoice`/`part_sale`/
`non_stock_invoice`/`non_stock_cogs`/`supplier_credit`/`stock_adjustment`/`price_variance`/`core_charge`),
`source_type`+`source_id` (jobsheet/health_check/po/stocktake/supplier_return — carry **both** `jobsheet_id` +
`health_check_id` for `jobPath()` linking), `document_date`, `period_key` (`YYYY-MM` derived from
`document_date` — see period-lock invariant below), `invoice_number` NULL, `tax_point_date` NULL (both stamped
on sale-side events, §6 Event 3b), `net_total`, `tax_total`, `gross_total`, `idempotency_key` (our **internal**
dedup, keyed on `source_event`+`source_id`+line-set; reused on our retries only), `posting_status`
(`unposted`/`draft`/`posted`/`blocked`/`error`/`voided`), `currency` DEFAULT 'GBP'.

**`inventory_journal_lines` (per Dr/Cr):** `internal_account_key` (`parts_stock`/`grni`/`accounts_payable`/
`vat_input`/`accounts_receivable`/`parts_sales`/`parts_cogs`/`vat_output`/`stock_adjustment`/
`purchase_price_variance`/`parts_wip`/`core_liability`), `debit` / `credit` (one populated, **net** — VAT
isolated on its own line), `tax_code`, `tax_amount`, `tracking_site_id`, `tracking_job_id`, `entity_ref`
(`supplier_id`/`customer_id`/`stock_item_id`), `line_description`.

**Invariants enforced in the writer service:**
- ΣDr = ΣCr per journal (reject unbalanced); net amounts on trading lines + VAT on its own control line.
- **Never edit a posted journal — reverse-and-repost.**
- **Internal idempotency** on `idempotency_key` (prevents *our* writer double-inserting). This is **distinct
  from** the provider push token (§5.11 `external_idempotency_key`) — a 3b sale and its 4A bill are two
  provider documents from related journals and must not share a provider key.
- **Period lock.** Each org carries a `books_locked_through DATE` (org setting). A journal whose `document_date`
  falls in a locked period (≤ `books_locked_through`) **must not post into that period**: it posts to the
  current open period with a reference back to the originating event (standard GL behaviour), and a reversal of
  a posted journal that lands in a locked period follows the same rule. `period_key` is the lock granularity.
  (Full lock-management UI is P4; the column + the writer rule ship with P2 so back-dated GRNs/late invoices
  can't corrupt a closed month.)

### 5.11 Mapping layer for the future GL (P2, inert until a provider connects)

| Table | Purpose / key columns |
|---|---|
| `accounting_connections` | per-org connected provider: `provider` (`xero`/`qbo`/`sage`), `tenant_ref`, encrypted tokens, `status`, `default_currency`. (Mirror the postcode-lookup "inert until keyed" pattern.) |
| `account_code_map` | `internal_account_key` → `provider_account_code`/`provider_account_id`. UNIQUE(connection, internal_account_key). **Xero is the confirmed first provider (Leo, 2026-06-28)** — seed defaults to mirror Xero's UK demo chart (630 Inventory, 310 COGS, 200 Sales, 610 Accounts Receivable, 800 Accounts Payable, 820 VAT; GRNI/WIP-clearing/PPV as added current-liability/asset codes), each marked "remap on connect" so journals are human-readable before connection and never collide with a customer's real chart. (`provider` enum still carries `qbo`/`sage` for later.) |
| `tax_code_map` | `internal_tax_key` (`STD_20`/`ZERO`/`EXEMPT`/`NO_VAT`) → `rate_percent` + `provider_tax_type`. Xero tax types: `20% (VAT on Income)` / `20% (VAT on Expenses)` / `Zero Rated` / `Exempt` / `No VAT`. |
| `contact_links` | `party_type`+`party_id` → `provider_contact_id` (reuse, never recreate — avoids duplicate Xero contacts). |
| `journal_push_log` | per-push idempotency: `journal_id`, `connection_id`, `document_type` (`ACCREC`/`ACCPAY`/`ACCPAYCREDIT`/`manual_journal`), **`external_idempotency_key`** (derived per `(connection_id, journal_id, document_type)`), `provider_document_id`, `status`. **The provider idempotency token lives here, never on the journal header.** |

> Building these now (even inert) is the difference between "map codes + push" and a schema rewrite when the
> GL lands. Every journal already carries internal keys; the GL adds only a mapping rowset, not a column.

### 5.12 `pricing_matrix` + `pricing_matrix_bands` — the banded markup engine (P0)

**Purpose:** the default sell-price engine (decision 7). Load-bearing P0 value, so fully specified here (not
just referenced in §9). Override precedence: **job-line override → item `sell_price_override` → matrix → flat
fallback**.

**`pricing_matrix`** (one default per org; optional per-category):

| Column | Type | Notes |
|---|---|---|
| `name` | VARCHAR(100) NOT NULL | UNIQUE(org, name). |
| `category_id` | UUID NULL FK→part_categories | NULL = the org default matrix. |
| `is_default` | BOOLEAN DEFAULT false | Exactly one default per org (partial unique index). |
| `is_active` | BOOLEAN DEFAULT true | |

**`pricing_matrix_bands`** (the cost-bands):

| Column | Type | Notes |
|---|---|---|
| `pricing_matrix_id` | UUID NOT NULL FK→pricing_matrix | |
| `cost_from` | DECIMAL(10,2) NOT NULL | Band lower bound (inclusive). |
| `cost_to` | DECIMAL(10,2) NULL | Band upper bound (NULL = open-ended top band). |
| `markup_pct` | DECIMAL(6,2) NULL | One of markup_pct / multiplier populated. |
| `multiplier` | DECIMAL(6,3) NULL | e.g. ×2.0 on cheap parts. |
| `sort_order` | INTEGER DEFAULT 0 | |

Seeded default bands: £0–10 ×2.0 / £10–100 ×1.6 / £100+ ×1.4 (higher markup on cheap parts).

---

## 6. Accounting design — the exact journals

Conventions: **Dr** = debit, **Cr** = credit; every event balances (ΣDr = ΣCr). Nominal codes illustrative
**placeholders** (Sage-style, **remapped per tenant** via `account_code_map` on GL connect). VAT at 20%.
Worked thread: a part bought **£100 net**, sold **£150 net**. **Input VAT** = reclaimable on purchases;
**Output VAT** = owed on sales.

This directly implements Leo's brief: **a part IN sits on the balance sheet (Inventory asset, or WIP-clearing
for non-stock); when invoiced OUT, an automatic journal moves it balance-sheet → P&L (COGS) and the sale hits
revenue — cost and revenue in the same event.**

### Account map (`internal_account_key` → illustrative placeholder nominal)

| Key | Account | Type | Placeholder code |
|---|---|---|---|
| `parts_stock` | Inventory / Stock | Asset (BS) | 1001 |
| `parts_wip` | WIP / Uninvoiced Parts Cost (non-stock clearing) | Asset (BS) | 1002 |
| `grni` | Goods Received Not Invoiced | Liability (BS) | 2108 |
| `accounts_payable` | Trade Creditors | Liability (BS) | 2100 |
| `vat_input` | Purchase VAT (reclaimable) | Asset (BS) | 2201 |
| `accounts_receivable` | Trade Debtors | Asset (BS) | 1100 |
| `parts_sales` | Parts Sales | Revenue (P&L) | 4000 |
| `parts_cogs` | Cost of Goods Sold — Parts | Expense (P&L) | 5000 |
| `purchase_price_variance` | Purchase Price Variance | Expense (P&L) | 5008 |
| `vat_output` | Sales VAT (owed) | Liability (BS) | 2200 |
| `stock_adjustment` | Stock Adjustment / Write-off | Expense (P&L) | 5009 |
| `core_liability` | Core Charge Deposits | Liability (BS) | 2230 |

> **Code-collision note.** These are inert **placeholders**, remapped on GL connect (the map is per-connection,
> so no collision with the customer's live nominals). `core_liability` was moved to **2230** to avoid the
> common GRNI-range collision around 2108/2109; `purchase_price_variance` (5008) and `parts_wip` (1002) are
> new and non-colliding. The seeded chart is flagged "placeholder — confirm with accountant on connect"
> (§13 Q7).

### Simple-mode journals (no stock) — the DEFAULT path; the only path on VHC-only plans

In **Simple mode** there is no inventory, no GRNI, no WIP buffer, no `stock_movements` — Events 1, 2, 4A-invoice,
5 (stock) and 6 below **do not fire**. A part is a priced line that becomes **one matched pair of postings at the
billing-document close** (the *same* trigger as Full mode, §7.3). Worked thread: cost **£100 net**, sold **£150 net**.

**Simple-close — cost straight to P&L + the sale, same event:**

| Account | Dr | Cr |
|---|---|---|
| COGS — Parts (`parts_cogs`) | £100.00 | |
| Accounts Payable (`accounts_payable`) | | £100.00 |
| VAT Input (`vat_input`) | £20.00 | |
| *…and the sale leg:* Accounts Receivable (`accounts_receivable`) | £180.00 | |
| Parts Sales (`parts_sales`) | | £150.00 |
| VAT Output (`vat_output`) | | £30.00 |

The part cost goes **straight to the P&L** (`parts_cogs`) — **never capitalised as inventory** — on the same date
as the revenue. This is exactly the **Full-mode 3b/4A-sale leg with the inventory/WIP legs removed**: the
`Cr parts_stock` / `Cr parts_wip` simply becomes `Cr accounts_payable`. Same account map, same close hook, same
`inventory_journal` tables — Simple mode just emits fewer lines. When Xero is connected this materialises as a
**purchase bill** (the cost + input VAT) **and** a **sales invoice** (the sale + output VAT), so the bookkeeper
does **not** separately re-key the factor bill (avoids double-counting). Output VAT still reads
`repair_items.vat_amount`; the £0-cost close gate (§12) still applies.

> **Cost-timing fork (§13 Q12).** The table above expenses the cost **at close** (matched to the sale —
> **RECOMMEND**: clean per-job gross profit, reuses the close hook). The alternative is to expense the part **at
> purchase** (`Dr parts_cogs / Cr AP` when the cost is entered, independent of the sale) — the most literal "just
> a cost to P&L," but cost and revenue can land in different periods. Leo to confirm; default = at close.

---

### Event 1 — Goods received into stock (stocked item, no invoice yet)  *(Full mode)*

| Account | Dr | Cr |
|---|---|---|
| Inventory (`parts_stock`) | £100.00 | |
| GRNI (`grni`) | | £100.00 |

No VAT yet (recognised at the tax invoice). Source: `goods_receipt`. Inventory ↑ asset, GRNI ↑ liability. The
£100 is the **provisional** receipt cost; the supplier invoice (Event 2) clears GRNI at this same received
value and posts any variance separately.

### Event 2 — Supplier / purchase invoice received (clears GRNI at received value, books AP + input VAT, posts price variance)

Worked with an invoice of **£105 net** (PO/received value was £100):

| Account | Dr | Cr |
|---|---|---|
| GRNI (`grni`) | £100.00 | |
| Inventory (`parts_stock`) **or** PPV (`purchase_price_variance`) | £5.00 | |
| VAT Input (`vat_input`) | £21.00 | |
| Accounts Payable (`accounts_payable`) | | £126.00 |

**GRNI is cleared at the *received* value (£100)** — it was credited at £100 in Event 1, so it nets to zero (no
£5 stranded in GRNI). The **£5 price variance** goes to **Inventory** (with a WAVCO re-roll on the *residual
on-hand qty only*) if the stock is still on hand, or to **Purchase Price Variance** if that qty has already
been issued/sold. **Never to COGS for unsold stock** — that would expense a cost while the asset is still on
the balance sheet and leave Inventory at the wrong WAVCO.

> **Worked WAVCO drift example (provisional cost + same-day issue).** Receive 2 @ provisional £100 (Event 1,
> `average_cost` → £100). Issue 1 @ £100 onto a job *before* the invoice arrives. Invoice lands at £105/unit.
> The 1 unit **still on hand** re-rolls to £105 (variance £5 → Inventory). The 1 unit **already issued**
> cannot have its COGS retro-changed (close may already have run), so its £5 under-cost posts to **PPV**, not
> back into `average_cost`. Net: Inventory correct, the issued unit's variance is visible in PPV, no silent
> drift.

### Event 3 — Part issued & sold on the customer invoice (perpetual, STOCKED) — fires at billing-document close

**One business event, two paired journals (matching principle). The close stamps `invoice_number` +
`tax_point_date` on both headers — close IS the invoice issuance (decision 4).**

**3a — Cost side (relieve inventory → P&L):**

| Account | Dr | Cr |
|---|---|---|
| COGS — Parts (`parts_cogs`) | £100.00 | |
| Inventory (`parts_stock`) | | £100.00 |

**3b — Revenue side (raise the sale):**

| Account | Dr | Cr |
|---|---|---|
| Accounts Receivable (`accounts_receivable`) | £180.00 | |
| Parts Sales (`parts_sales`) | | £150.00 |
| VAT Output (`vat_output`) | | £30.00 |

Net P&L = £150 − £100 = **£50 gross profit**, recognised in the period of the sale. **This is the
balance-sheet → P&L move Leo described:** 3a takes the part off the Inventory asset and books it as COGS; 3b
books revenue. The COGS line is **`qty_fitted × cogs_snapshot`** (the £100 here = 1 × £100); `cogs_snapshot`
on `repair_parts` freezes the unit cost so later edits don't retro-change it. **The `Cr VAT Output £30` line
reads the already-computed `repair_items.vat_amount`** (it does not re-derive VAT) — it is a *distinct ledger
posting* that must reconcile to the customer's document. VAT rounding follows the pricing triggers' per-item
rounding so the journal ties to the invoice to the penny (HMRC permits per-line or per-invoice rounding; we
stay internally consistent with the triggers).

### Event 4A — Non-stock order-in part (the DEFAULT path) — TWO legs, cost deferred to the sale

**This is the matching fix.** Non-stock parts have no inventory buffer, so the cost is parked on a
balance-sheet clearing account at supplier invoice and only expensed at the sale — exactly mirroring stocked
behaviour.

**4A-invoice — supplier invoice arrives (park cost, NOT expense it):**

| Account | Dr | Cr |
|---|---|---|
| WIP / Uninvoiced Parts Cost (`parts_wip`) | £100.00 | |
| VAT Input (`vat_input`) | £20.00 | |
| Accounts Payable (`accounts_payable`) | | £120.00 |

**4A-sale — billing-document close (expense the cost AND raise the sale, same event):**

| Account | Dr | Cr |
|---|---|---|
| COGS — Parts (`parts_cogs`) | £100.00 | |
| WIP / Uninvoiced Parts Cost (`parts_wip`) | | £100.00 |

…plus the **identical 3b sale leg** (`Dr AR £180 / Cr Parts Sales £150 / Cr VAT Output £30`).

The cost lands in COGS **on the same date as the revenue**, even if the supplier billed you in a different VAT
period/month. There is **no inventory asset** and no SKU cost-roll — just the WIP buffer — but the matching
principle holds. (If you genuinely want cost-on-supplier-invoice instead of cost-deferred, that is a different
accounting policy and breaks matching; the WIP-clearing route is the recommended default — §13 Q2.)

### Event 5 — Return to supplier / credit note (reverse of receipt) — UNUSED parts

*Stocked, supplier invoice already posted (AP exists):*

| Account | Dr | Cr |
|---|---|---|
| Accounts Payable (`accounts_payable`) | £120.00 | |
| Inventory (`parts_stock`) | | £100.00 |
| VAT Input (`vat_input`) | | £20.00 |

*Stocked, returned before invoice (still in GRNI):* reverse Event 1 — `Dr GRNI £100 / Cr Inventory £100`, no VAT.

*Non-stock, returned before the sale:* reverse the parked cost — `Dr AP £120 / Cr WIP-clearing £100 /
Cr VAT Input £20` (the cost was never expensed, so there is no COGS to relieve).

**Consignment ownership** (`stock_ownership='consignment'`): if the part was **never taken into use**, no
purchase was ever booked → return generates **no credit note**, no reversal. **But** if a consignment part was
**issued and sold**, a purchase **is** triggered at point-of-use (Dr WIP-clearing / Cr AP at consumption), and
that purchase journal must exist before any return is modelled — consignment is not a blanket "no purchase".

> **Already-sold returns are out of scope (§5.9):** returning a part whose COGS+sale already posted requires a
> customer credit leg (reverse sale + COGS) *and* the supplier return. The P2 return path rejects
> `line_status='invoiced'`. Modelling both legs is §13 Q10.

### Event 6 — Stock adjustment / write-off / stocktake variance (no VAT)

**6a — Shrinkage / write-down (£30):**

| Account | Dr | Cr |
|---|---|---|
| Stock Adjustment (`stock_adjustment`) | £30.00 | |
| Inventory (`parts_stock`) | | £30.00 |

**6b — Over-count / found stock (£30):** the reverse. FRS-102 NRV write-downs are immediate expenses; keeping
adjustments on their own nominal makes shrinkage visible separately from COGS.

**Non-stock `return_rejected` (factor refuses the credit):** the cost was already moved to COGS at the sale
(Event 4A-sale), so a rejected non-stock return posts **no further entry** — the cost simply **stays in COGS**
as a permanent expense. Only a **stocked** rejected return that must be written off hits `stock_adjustment`
(6a). This is called out so it isn't built as a phantom adjustment.

### Core / surcharge (P3) — a refundable deposit, NOT revenue

**Charge deposit:** `Dr AR/Bank £50 / Cr Core Liability £50`. **Customer returns core:** reverse.
**Not returned in window (forfeit → income):** `Dr Core Liability £50 / Cr Parts Sales £50` **+ Output VAT**.
The VAT treatment on forfeit is **not "if applicable"**: if the original core charge carried VAT, the forfeit
is consideration and VAT is due — so the deposit should generally carry VAT from the start. **This must be
confirmed with the accountant before the P3 build** (§13 Q6) and is not shipped as a guess. Supplier-side core
deposit you pay → hold in a Core Receivable asset, recover on sending the dirty core back. Cores stay on their
own field/line — never folded into parts inventory.

### Why "store now, push later" works

Every event above materialises as an immutable `inventory_journal` + `inventory_journal_lines` keyed by
`internal_account_key` + `tax_code` + `source_event` + source refs. A future integration:
- pushes a **sales invoice** (Xero `ACCREC` / QBO `Invoice`) for the 3b/4A-sale side,
- a **bill** (`ACCPAY` / `Bill`) for the 2 / 4A-invoice purchase side,
- a **supplier credit note** (`ACCPAYCREDIT` / `VendorCredit`) for Event 5,
- a **manual journal** only for stock revaluation/adjustment (Event 6) or price variance where no document fits,

resolving codes through `account_code_map`/`tax_code_map`/`contact_links`, with a **per-push
`external_idempotency_key`** (in `journal_push_log`, derived per `(connection, journal, document_type)`) so a
3b sale's `ACCREC` and its 4A bill's `ACCPAY` never collide, and retries never double-post. We change **no
schema** to add a provider — only mapping rows.

---

## 7. Workflows / behaviour

### 7.1 Goods-in / GRN
Open a PO → "Receive" → per line edit `qty_received` + `unit_cost`, flag discrepancies/damage → post. Stocked
lines write a `receipt` movement (SOH ↑, **provisional** WAVCO re-roll) + Event 1; non-stock lines just advance
to `received`. Receiving optionally unblocks job start (TechMan pattern). GRN number generated.

### 7.2 Booking parts onto a job card (reuse `PartsTab.tsx` + `repair_parts`)
Unchanged entry point: `apps/web/src/pages/HealthChecks/tabs/PartsTab.tsx` → `POST /repair-items/:id/parts`.
Additions: catalogue autocomplete can now set `stock_item_id`; if the chosen item is `is_stocked` and on hand,
adding the line writes an `issue` movement (or a `reservation` in P4) and shows live SOH/Available; matrix
price auto-fills `sell_price`. Ad-hoc lines (`stock_item_id` NULL) keep working exactly as today. New ad-hoc
lines default `allocation_type='direct'` (the migration default; the API coerces unknown values to `direct`,
`repair-items/parts.ts:81`) — the line-status machine never assumes a `shared` default.

> **Issue-at-booking vs COGS-at-close — the reconciling control.** §7.3 fires the COGS *journal* at close, but
> the **`issue` movement (SOH↓) is written at booking** (§7.2). Between booking and close the perpetual
> valuation (`Σ total_cost`) has already dropped while the GL COGS journal hasn't posted, so for every
> in-flight job the perpetual stock value and the journalled COGS would diverge. **We reconcile this with a
> `stock_issued_pending_sale` (WIP-stock) control account:** the `issue` movement posts
> `Dr Stock-Issued-WIP / Cr Inventory` at booking, and Event 3a at close posts `Dr COGS / Cr Stock-Issued-WIP`.
> SOH and the GL only ever diverge through that explicit control account, and **cancelling/declining a booked
> line before close reverses the `issue` movement** (back to `Inventory`) rather than leaking stock. *(If Leo
> prefers, the simpler alternative is deferring the `issue` movement to close so movement + journal are atomic;
> the control-account route keeps live SOH accurate during the job, which techs want — §13 Q11.)*

### 7.3 COGS-on-invoice trigger (tie to the real "invoiced out" event — at the BILLING DOCUMENT)
Hook the billing-document close: VHC `POST /health-checks/:id/close` (`status='completed'`, `closed_at` set,
`status.ts:1516`; `closableStatuses=['authorized','declined','expired']` at `:1438`) **and** jobsheet close
(`jobsheets.closed_at`, P2). The **sold basket** = authorised `repair_items` **plus their selected
`repair_option`** (mirror `item-report-service.ts`/`calcItemTotal`'s selected-option substitution), and its
`repair_parts` are collected via **both** FKs — `repair_part.repair_item_id` **and**
`repair_part.repair_option_id` — because a part can hang off the chosen option, not just the concern. For each
**authorised** part (`outcome_status='authorised'`/`is_approved`, the existing filter at `status.ts:1494`):
- write `cogs_snapshot` (unit) + `cogs_recognised_at` (idempotent — skip if already set), default `qty_fitted`
  to `quantity` if unset,
- emit Event 3a (stocked) or Event 4A-sale `Dr COGS / Cr WIP-clearing` (non-stock) **and** Event 3b sale, with
  COGS = **`qty_fitted × cogs_snapshot`**,
- for stocked items, the `issue` movement was already written at booking; close fires the COGS journal and
  relieves the `stock_issued_pending_sale` control (§7.2).

**Shared allocation — no cost-splitting to replicate.** A `shared` part is simply stored against the parent
group's `repair_item_id` (the pricing triggers ignore `allocation_type` entirely — `calculate_repair_item_totals`
just `SUM`s `repair_parts` by `repair_item_id`). So the COGS sweep **iterates `repair_parts` by
`repair_item_id`/`repair_option_id` and treats each row exactly once**; there is no distribution-across-children
routine to mirror. The only real risk is **double-counting** if the sweep walks both a parent and its children
— so collect each `repair_parts.id` once.

**Empty / partial close.** On a `declined` close the authorised basket is empty and on an `expired` close it
may be partial — recognise COGS only for authorised items; a **zero-item close emits no journal**. The logic
handles this by construction (it iterates only authorised parts).

Estimate `accepted` is a further trigger; an estimate that becomes a jobsheet/VHC recognises at *that*
document's close (no double-fire — `cogs_recognised_at` guards).

### 7.4 Stocktake / adjustment
Stocktake session: pick category/bin/supplier/all → snapshot expected qty (freeze) → enter counted → system
computes variance per line → commit posts `adjustment` movements with a **mandatory `reason_code`** + Event 6.
Variance-tolerance approval is NICE (P4).

### 7.5 The order-in → return loop (the load-bearing UK flow)
Reducing/removing a line, **or the customer declining it**, after it was ordered forks: **"return to stock"**
(stocked → `return_in` movement) vs **"return to supplier"** (→ `supplier_returns`, line `to_return`). The
**Parts-to-Return** report lists all `to_return` **and `declined`** lines grouped by supplier → "Create
Return" → printable returns note for the driver → mark `shipped` → on credit note, record `credit_amount` +
reconcile to the original PO → `credited` + Event 5.

### 7.6 Low-stock reorder
`available = qty_on_hand − allocated`; when `available ≤ min_qty` → low-stock flag. Suggested order qty =
`max_qty − qty_on_hand − qty_on_order`. Low-Stock report groups by `preferred_supplier_id` → becomes a draft
PO per factor. Colour status (in-stock/low/out/on-order) on lists.

### 7.7 Document reopen → COGS reversal (memory: `vhc-admin-edit-reset-initiative`)
A closed → reopened → edited → reclosed billing document must not silently desync COGS from the final invoice.
**On reopen, the close hook posts *reversing* journals for every COGS/sale journal it previously emitted and
clears `cogs_recognised_at` + `cogs_snapshot` (+ `qty_fitted` if it was auto-defaulted) on the affected
`repair_parts`.** Re-close then re-recognises against the final basket. Without this, post-reopen edits (added/
removed parts, changed cost, changed `qty_fitted`) would never adjust COGS because the `cogs_recognised_at`
guard would skip them.

---

## 8. Reporting

All as `report_*` RPCs in `apps/api/src/routes/reports.ts` (inherits `requireModule('reports')` +
`report.view` audit). **Aggregate in the DB** — `stock_movements` and `repair_parts` are the highest-cardinality
tables in the system; raw fetches silently truncate at the **PostgREST ~1000-row cap** (memory:
`postgrest-row-cap`). Valuation = `SUM(stock_movements.total_cost)` in SQL (the canonical 2dp figure — **not**
`SUM(qty_delta × unit_cost)`, which would foot differently against the journal); never reduce in Node.
(`calcItemTotal` lives in API services — `apps/api/src/services/item-report-service.ts`,
`repair-type-report-service.ts` — not a web util; the margin RPC reuses its substitution logic server-side.)

| Report | Priority | What it answers (RPC) |
|---|---|---|
| **Stock Valuation** | P0 | Balance-sheet inventory: `Σ total_cost` (perpetual) by category/location/total. `report_stock_valuation`. |
| **Low Stock / Reorder** | P0 | Items ≤ `min_qty`, by preferred supplier, with suggested qty. Drives purchasing. |
| **Stock Movement history** | P0 | Per-part in/out/adjust ledger over a date range. The "why is SOH −1?" audit. |
| **Parts-on-Order** | P1 | Open PO lines: expected, overdue, by supplier. |
| **Negative-Stock Exceptions** | P1 | Items with `qty_on_hand < 0` to reconcile (falls out of the negative-stock policy). |
| **Parts-to-Return** | P2 | **Ordered-in, unused/declined, NOT an official stock item** (`repair_parts.line_status IN ('to_return','declined')` AND (`stock_item_id IS NULL` OR `is_stocked=false`)) + outstanding supplier credits. **Includes declined-line parts**, not just removed/reduced ones. The UK money-leak report. |
| **Orphan Parts** | P2 | Received/ordered parts **not on any job card** — driven off **`purchase_order_lines`/`goods_receipt_lines`** (which exist for **both** forks), not `stock_movements` (which the non-stock fork never writes). Definition: PO/GRN lines with `repair_part_id IS NULL`, **plus** received non-stock PO lines with `reconciled=false` (received, never fitted, never returned — the literal money-leak). Catches the leakage the brief cares about. |
| **Parts Gross Profit / Margin-by-Repair-Type** | P2 | `sell − cost` by part/category/period, and **by `repair_items.repair_type_id`** — **closes the deferred Repair Types margin piece** (REPAIR_TYPES.md §4.4/§8). Reuse `calcItemTotal` (selected-option substitution), `COALESCE(price_override, total_inc_vat)`, parent/child de-dup. Flag below-cost lines. |
| **Slow-moving / Obsolete (SLOB)** | P3 | No movement in N days, £ tied up. Needs movement history to accumulate first. |
| **GRNI Ageing** | P3 | Receipts un-matched to invoices (lines stuck in GRNI = missing invoices / short-shipments). A real period-end control. |

Web: one page per report under `apps/web/src/pages/Reports/`, lazy-imported + routed in `App.tsx`, a `NavCard`
in `ReportsHub.tsx`. Reuse `useReportFilters`, `useReportData<T>`, `StatCard`, `ChartCard`, `ExportButton`,
`formatters`. Parts Margin slots beside the existing `RepairTypes.tsx` page (which already says "Margin
arrives with the Parts module").

---

## 9. Settings, module gating, seeding

**Module key** — add `'parts_stock'` to the `ModuleKey` union + `MODULES[]` in **both**
`apps/api/src/lib/modules.ts` **and** `apps/web/src/lib/modules.ts` (verified byte-identical; new key slots in
cleanly):
```ts
{ key: 'parts_stock', label: 'Parts & Stock',
  description: 'Stock inventory, goods-in, valuation, purchase orders & supplier returns', defaultOn: false }
```
`defaultOn: false` (matches `jobsheets`/`vehicle_reminders`). Not `core`. The super-admin toggle then works
for free (`PATCH /admin/organizations/:id/modules`). **The existing lite catalog/suppliers/`repair-items/parts`
routes stay ungated**; only new stock surfaces gate.

**Parts mode + plan gating (decision 0).** Add `organization_settings.parts_mode ENUM('simple','full') DEFAULT
'simple'`. A tenant may resolve to `'full'` **only** when the `parts_stock` module is on (per-org override →
`subscription_plans.features.parts_stock` → registry `defaultOn:false`, resolved by
`apps/api/src/services/modules.ts`). **VHC-only plans set `parts_stock:false` in their plan `features`** — exactly
as they do for `jobsheets` — so those tenants are locked to `'simple'`: the API coerces `parts_mode` to `'simple'`
when the entitlement is off, and the Full UI (Stock / Goods-In / PO / Returns nav + the mode toggle) is hidden by
`<RequireModule module="parts_stock">`. GMS-tier plans (`parts_stock:true`) get a **Settings → Pricing & Parts →
"Parts mode"** toggle. **Simple mode still emits journals** (the §6 Simple-mode pair) — the only difference from
today's lite behaviour is the journal output, which stays inert until `accounting_connections` has a live provider.

**API:** new router `apps/api/src/routes/parts-stock.ts` mounted at `/api/v1/parts-stock` with
`parts.use('*', requireModule('parts_stock'))`. PO/goods-in/returns/journal endpoints live here. Settings
lookups (`part_categories`, `stock_locations`) mount under the org-scoped path like `suppliers`.

**Web:** convert the flat **Parts** nav item (`DashboardLayout.tsx`) into a group:
Catalogue (ungated, existing) · Stock · Goods In · Purchase Orders · Returns · Reports — children gated
`module: 'parts_stock'`. Routes wrapped in `<RequireModule module="parts_stock">`. New settings pages
`/settings/part-categories` + `/settings/stock-locations` in the **"Pricing & Parts"** SettingsHub group
(verified present, `SettingsHub.tsx:600`); add to `CARD_MODULE` so they hide when the module is off.

**Seeding** (`services/provisioning.ts:seedDefaultLibraries()`, best-effort; each new seeder uses the
`p_organization_id` param name to match the existing `rpc(fn, { p_organization_id: orgId })` call shape, §4.5):
`seed_default_part_categories_for_org` (§5.1), a default "Main" `stock_locations` row, a default
`pricing_matrix` + bands (§5.12), and **placeholder `account_code_map` / `tax_code_map` rows** (UK Sage ranges,
marked "remap on connect") so journals are readable before any GL connects. Each via the canonical
`ON CONFLICT … DO NOTHING` seeder + migration backfill loop.

**Matrix config** — `pricing_matrix` + `pricing_matrix_bands` (§5.12). Edited under Settings → Pricing & Parts.
Override precedence: **job-line override → item `sell_price_override` → matrix → flat fallback**.

---

## 10. Phasing — each phase a shippable slice

> **Two tracks.** The P0–P4 phases below build the **Full-mode** stock machinery. **Simple mode** (the default,
> and every VHC-only tenant) is a *much thinner* slice that can ship **first and independently** — it touches
> none of the stock tables. (Phase tags `(P0)`/`(P1)`/`(P2)` on the §5 tables refer to the **Full-mode** track.)

**P-Simple — Simple-mode accounting (ship first; the majority no-stock tenant).**
`organization_settings.parts_mode` + plan gating (§9) · the §6 **Simple-mode journal pair** wired to the existing
billing-document **close** trigger (§7.3) · the journal-ready tables it *shares* with Full mode —
`inventory_journal`/`_lines` + the mapping layer (`accounting_connections`, `account_code_map`, `tax_code_map`,
`contact_links`, `journal_push_log`), seeded inert · the **£0-cost close gate** · **Parts-GP / Margin-by-Repair-Type
report** (closes the deferred Repair Types loop for *every* tenant, not just stock-holders). **No `stock_movements`,
PO, GRN, returns, categories, or matrix required.** Delivers the "parts → P&L costs" promise to the majority
no-stock garages with ~6 new tables and zero stock admin. *(Live Xero push is still P4; until then journals
accrue inert, ready to map + send.)*

The Full-mode phases then layer stock on top for GMS-tier tenants who opt in:

**P0 — Stock foundation + valuation (real value, no GL).**
`part_categories` + seeder · `stock_locations` (default) · `parts_catalog` extension (is_stocked, qty_on_hand,
average_cost, min/max, bin, category, sell/override, vat_code) · `stock_movements` + `apply_stock_movement()`
trigger (the SOH invariant + provisional-WAVCO + negative-SOH valuation rules, §5.4) · `pricing_matrix` +
`pricing_matrix_bands` (§5.12) + matrix engine + seeded bands · manual stock adjustment UI · **Stock Valuation
+ Low-Stock + Movement-history reports** · Stock list with colour status. Goods-in can be manual
(adjustment-style) before POs exist. **Ships a working held-stock register + valuation with zero accounting.**
*Defers:* POs, journals, returns.

**P1 — Order-in: POs + goods-in/GRN + job-line links.**
`purchase_orders`/`_lines` · `goods_receipts`/`_lines` · `repair_parts` extension (stock_item_id,
purchase_order_line_id, qty_fitted, qty_to_return, line_status) · raise-PO-from-job + auto-consolidation ·
receiving writes `receipt` movements (stocked) · part-line state machine (requested→ordered→received→fitted,
incl. `declined`) · **Parts-on-Order + Negative-Stock reports**. **Ships the core UK order-in flow.**
*Defers:* the journals + returns.

**P2 — Accounting: journals + returns + margin (+ jobsheet close trigger + £0-cost gate).**
`inventory_journal`/`_lines` (immutable, balanced, `period_key` + writer period-lock rule) + writer service ·
`supplier_returns`/`_lines` + the return→credit loop · mapping layer (`accounting_connections`,
`account_code_map`, `tax_code_map`, `contact_links`, `journal_push_log`, seeded inert) · `jobsheets.closed_at`
as a first-class COGS trigger · COGS-on-close hook (Events 3a/3b/4A both legs + WIP-clearing + the
`stock_issued_pending_sale` control + reopen-reversal §7.7) · goods-in journals (Events 1/2 incl. price
variance/PPV) · adjustment journals (Event 6) · **Parts-to-Return + Orphan-Parts (PO/GRN-driven) +
Parts-GP/Margin-by-Repair-Type reports**. **Acceptance criterion:** close is **blocked (or forces a £0-cost
confirmation)** when an authorised stocked/order-in line has null/0 `cost_price`/`cogs_snapshot` — a £0-cost
line silently books 100% margin and corrupts the ledger this module exists to produce. **Ships the
accounting-grade promise + closes the deferred Repair Types margin loop.** *Defers:* cores, the live GL push.

**P3 — Cores, stocktake sessions, SLOB/GRNI.**
Core/surcharge sub-state + deposit journals (**core-forfeit VAT confirmed with accountant first**, §13 Q6) ·
structured stocktake sessions (freeze + reason-coded variance) · **SLOB + GRNI-Ageing reports** · supplier
price-list child table · single-hop supersession + alias search · barcode scanning UI.

**P4 — GL integration + multi-location + period-lock UI.**
Live Xero/QBO/Sage push (documents + per-push `external_idempotency_key` + draft/posted handling) ·
books-locked-through management UI (the column + writer rule ship in P2) · automated AP reconciliation (vendor
invoice ↔ PO ↔ ledger leakage detector) · multi-location transfers (`transfer` movement) · stock reservation
(On-hand vs WIP vs Available) · per-category matrices · variance-tolerance approval · already-sold-return
two-leg customer-credit modelling (§13 Q10).

---

## 11. Migrations (additive, timestamped — verify uniqueness before each)

| File | Phase | Contents |
|---|---|---|
| `2026XXXX_parts_part_categories.sql` | P0 | `part_categories` + seeder + backfill. |
| `2026XXXX_parts_stock_locations.sql` | P0 | `stock_locations` + default seed. |
| `2026XXXX_parts_catalog_stock_extension.sql` | P0 | `ALTER parts_catalog ADD COLUMN IF NOT EXISTS …` (item-master cols). |
| `2026XXXX_stock_movements.sql` | P0 | `stock_movements` (incl. `total_cost`, `document_date`) + `apply_stock_movement()` trigger (SOH invariant + provisional-WAVCO + negative-SOH valuation rules). |
| `2026XXXX_pricing_matrix.sql` | P0 | `pricing_matrix` + `pricing_matrix_bands` (§5.12) + default seed. |
| `2026XXXX_purchase_orders.sql` | P1 | `purchase_orders` + `purchase_order_lines` (incl. `reconciled`). |
| `2026XXXX_goods_receipts.sql` | P1 | `goods_receipts` + `goods_receipt_lines`. |
| `2026XXXX_repair_parts_stock_extension.sql` | P1 | `ALTER repair_parts ADD COLUMN IF NOT EXISTS …` (stock_item_id, po_line_id, qty_fitted, qty_to_return, line_status, ownership, core, cogs_snapshot, cogs_recognised_at). |
| `2026XXXX_jobsheets_close_timestamp.sql` | P2 | `ALTER jobsheets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ` (the parallel COGS trigger). |
| `2026XXXX_inventory_journal.sql` | P2 | `inventory_journal` (incl. `period_key`, `invoice_number`, `tax_point_date`) + `inventory_journal_lines` + balance CHECK + org `books_locked_through`. |
| `2026XXXX_supplier_returns.sql` | P2 | `supplier_returns` + `supplier_return_lines`. |
| `2026XXXX_accounting_mapping.sql` | P2 | `accounting_connections`, `account_code_map`, `tax_code_map`, `contact_links`, `journal_push_log` + placeholder default-code seed. |
| `2026XXXX_parts_report_rpcs.sql` | P2 | `report_stock_valuation`, `report_parts_to_return`, `report_orphan_parts`, `report_parts_margin`, … (service-role grants). |

Apply locally via `psql -h localhost -p 54422 …` or `supabase migration up`. **Never** modify an applied
migration — new file only.

---

## 12. Gotchas (carry-forward warnings)

- **NO `supabase db reset` — ever.** Two prior data-loss incidents. Additive `IF NOT EXISTS`/`IF EXISTS` only.
- **Multi-tenancy + RLS on every new table** — `organization_id NOT NULL` + 4 `current_setting('app.current_org_id')`
  policies **and** explicit `.eq('organization_id', …)` in every query (defense in depth).
- **The SOH invariant.** `qty_on_hand`/`average_cost` are **derived caches** — never let UI/API write them
  directly; only `stock_movements` inserts (via `apply_stock_movement()`) may move them. Any code path that
  changes stock without a movement row corrupts both quantity and valuation.
- **Quantity is load-bearing.** Every journal/COGS figure is `qty_fitted × cogs_snapshot`; `cogs_snapshot` is a
  **unit** cost. Never use the bare snapshot as the extended cost, and never assume one ordered line = one
  fitted unit (the canonical "ordered 2, fitted 1, return 1" split lives in `qty_fitted`/`qty_to_return`).
- **Cost is deferred for BOTH forks.** Non-stock parts park their cost in `parts_wip` at supplier invoice and
  only expense it at the sale (Event 4A two legs) — **don't** book `Dr COGS` on the supplier invoice, or COGS
  and revenue land in different periods and matching breaks.
- **GRNI clears at received value; variance never goes to COGS for unsold stock.** Event 2 clears GRNI at the
  Event-1 value and posts price variance to Inventory (on-hand) or PPV (already issued). WAVCO at receipt is
  **provisional**; the invoice trues up the residual on-hand qty only (§5.4, §6 Event 2).
- **Issue-at-booking vs COGS-at-close** must reconcile through the `stock_issued_pending_sale` control account
  (or defer the issue to close); cancel/decline before close reverses the `issue` movement (§7.2). Otherwise
  perpetual valuation and journalled COGS diverge for every in-flight job, and declined lines leak stock.
- **`repair_parts.cost_price` is nullable + defaults 0** (`20260203210001`) — legacy lines have no cost, so
  COGS is understated. **P2 acceptance criterion: block close (or force £0-cost confirmation) on any authorised
  stocked/order-in line with null/0 cost** — a £0-cost line silently books 100% margin.
- **`allocation_type='shared'` is not a cost-split.** The pricing triggers ignore `allocation_type`; a `shared`
  part just hangs on the parent group's `repair_item_id`. The COGS sweep iterates `repair_parts` once per row
  (via **both** `repair_item_id` and `repair_option_id`) and must not walk a parent and its children twice. No
  distribution routine to replicate.
- **Parts on the selected `repair_option` count.** `repair_parts` XOR-attach to a concern OR an option; the
  close sweep must read both FKs or option-priced parts silently miss COGS (§7.3).
- **Empty/partial close emits no journal.** `declined`/`expired` closes (`closableStatuses` at `status.ts:1438`)
  may have empty/partial authorised baskets; recognise only authorised items.
- **Reopen reverses COGS.** A reopened → reclosed document must post reversing journals + clear
  `cogs_recognised_at`/`cogs_snapshot`/`qty_fitted` (§7.7), or COGS desyncs from the final invoice after a reset
  (memory: `vhc-admin-edit-reset-initiative`).
- **Idempotency is two keys, not one.** Internal `idempotency_key` (our dedup) ≠ provider
  `external_idempotency_key` (per connection+journal+document_type in `journal_push_log`). A 3b sale's `ACCREC`
  and its 4A bill's `ACCPAY` are two provider documents and must not share a token.
- **Period lock.** Journals dated into a locked period (`document_date ≤ books_locked_through`) post to the
  current open period with a reference back (§5.10); never back-post into a closed month.
- **Output VAT reads, doesn't re-derive.** The sale-side `Cr VAT Output` line sources from
  `repair_items.vat_amount` and must reconcile to the customer document; keep rounding consistent with the
  pricing triggers (§6 Event 3b).
- **VAT control lines stay isolated** — VAT is never baked into inventory/COGS/sales lines; it sits on its own
  `vat_input`/`vat_output` control line so the future GL maps it cleanly.
- **Negative stock** is allowed by default (don't break tech workflow) — but it **must** surface on the
  Negative-Stock report **and** the §5.4 valuation-correction rule must run, or valuation silently drifts.
- **One rounding point.** `total_cost = ROUND(qty_delta × unit_cost, 2)` is the single money figure; valuation
  sums `total_cost`, journals use `total_cost`, and a cross-foot test ties movements ↔ journal lines to the
  penny. Never sum `qty × cost` at 4dp into a ledger total.
- **Core-forfeit VAT is unresolved.** Don't ship "output VAT if applicable" — confirm with the accountant
  whether the deposit carried VAT (P3, §13 Q6).
- **PostgREST ~1000-row cap** — aggregate stock/movement reports in DB RPCs; never fetch raw rows into Node.
- **Order-in is the DEFAULT.** Don't build the UI around held stock. A tech must add a part to a job with one
  line, no master record, no PO, no stock — the warehouse features are the opt-in minority path.
- **Orphan/Parts-to-Return key off PO/GRN lines, not movements.** The non-stock fork writes no
  `stock_movements` row, so movement-based orphan queries miss exactly the parts the brief cares about (§8).
- **Reuse the pricing triggers — don't touch them.** New stock logic sits *beside* `calculate_repair_item_totals`/
  `calculate_repair_option_totals`, never inside them; the sell-side roll-up must keep working unchanged for
  orgs with the module off.
- **`parts_catalog`/`repair_parts` are EXTENDED, not replaced** — additive ALTERs only; the existing
  autocomplete + three-document pricing must keep working with `parts_stock` disabled.
- **Seeders use `p_organization_id`** to match `seedDefaultLibraries()`'s `rpc(fn, { p_organization_id })` call
  shape; suppliers are **not** the seeding precedent (they backfill only) (§4.5).
- **`jobPath()` linking** — any parts surface linking a line back to its job must carry **both** `jobsheet_id`
  + `health_check_id` and call `jobPath({ jobsheetId, healthCheckId })` (memory: `job-card-routing-convention`).

---

## 13. Open questions for Leo

1. **Costing method** — confirm **WAVCO** as the only v1 method (vs offering FIFO)? (RECOMMEND: WAVCO; defer FIFO.)
2. **COGS recognition timing + matching** — confirm **cost is deferred to the sale for non-stock parts via a
   WIP-clearing account** (Event 4A two legs), so cost and revenue match — vs the simpler-but-wrong
   "expense on supplier invoice"? (RECOMMEND: WIP-clearing, matches stocked behaviour.) And confirm **close** is
   the trigger (vs at authorisation)? (RECOMMEND: close.)
3. **Close = invoice issuance?** — ✅ **ANSWERED (Leo, 2026-06-28): close = the invoice.** A closed billing
   document IS the customer VAT invoice; it stamps `invoice_number` + `tax_point_date`, and the COGS + sale/
   Output-VAT journals fire together at close. No separate external invoicing seam for v1.
4. **Jobsheet close** — confirmed we add **`jobsheets.closed_at` as a first-class P2 COGS trigger** (not a
   deferred parenthetical), because parts billed off a jobsheet/estimate that never spawns a VHC would
   otherwise never recognise COGS. Any reason the VHC close should be the *only* money event? (RECOMMEND: add
   jobsheet close in P2.)
5. **GRNI / expected-cost posting** — confirm Event 1 (Dr Inventory / Cr GRNI on *receipt*, provisional cost)
   for **stocked** items, with the supplier invoice truing up variance to Inventory/PPV (Event 2)? (RECOMMEND:
   GRNI for stocked; non-stock uses WIP-clearing via Event 4A.)
6. **Cores/surcharge + forfeit VAT** — confirm **P3 deferral** (fields stubbed now)? **And confirm the VAT
   treatment on a forfeited core deposit with your accountant before build** — if the original core charge
   carried VAT, the forfeit is VATable consideration. Which factors actually charge you cores
   (calipers/turbos/DPFs/batteries)?
7. **Default GL codes** — ✅ **ANSWERED via Q8 (Xero):** seed defaults will mirror **Xero's UK chart** (630
   Inventory, 310 COGS, 200 Sales, 610 AR, 800 AP, 820 VAT; GRNI/WIP/PPV as added codes), marked "remap on
   connect" (§5.11). *Still useful if you have a specific Xero chart-of-accounts you want mirrored one-to-one
   for the pilot garage — otherwise we use the demo-chart defaults.*
8. **First GL provider** — ✅ **ANSWERED (Leo, 2026-06-28): Xero.** P4 push target = Xero (Accounting API:
   `ACCREC`/`ACCPAY` invoices + `ACCPAYCREDIT` credit notes + manual journals; tracking categories for
   site/department). `provider` enum keeps `qbo`/`sage` for later, but build + test against Xero first.
9. **Bring lite catalog under `parts_stock`?** — keep the existing Catalogue page ungated/always-on (RECOMMEND),
   or fold it under the new module so the whole Parts area toggles together?
10. **Already-sold supplier returns** — when a part whose COGS+sale already posted is returned to the factor, do
    you want the **two-leg customer-credit + supplier-return** modelling (P4), or is "supplier returns are for
    unused/unsold parts only" sufficient for v1? (RECOMMEND: unused-only for P2; two-leg in P4.)
11. **Issue timing** — keep the `issue` movement **at booking** (live SOH during the job) reconciled via a
    `stock_issued_pending_sale` control account, or defer the issue to close (movement + journal atomic, but
    SOH lags until close)? (RECOMMEND: at booking + control account — techs want accurate live SOH.) *Full mode only.*
12. **Simple-mode cost timing** *(new — from Leo's two-mode request)* — in **Simple mode**, expense each part's
    cost **at the billing-document close** (matched to the sale; clean per-job gross profit; reuses the close
    hook — **RECOMMEND**), or **at purchase/cost-entry** (the most literal "just a cost to P&L," but cost and
    revenue can fall in different periods)? Also: when Xero is live, should VHC push the parts cost as a
    **supplier bill** (so the bookkeeper doesn't re-key factor invoices — avoids double-counting) or as a plain
    **manual journal**? (RECOMMEND: expense at close; push as a bill.)
