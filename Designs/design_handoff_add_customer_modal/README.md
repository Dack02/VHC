# Handoff: Add New Customer modal redesign (Option A — Sectioned compact)

## Overview
This redesigns the existing **"Add New Customer"** modal in the garage/workshop app. The
original was a tall, single-column form that required scrolling, wasted horizontal space, and
had no visual hierarchy. The new design is a **compact, two-column modal** that fits on one
desktop screen, organised into three labelled sections (Customer, Contact, Address) using a
left **label-rail** layout. No fields were removed — they were regrouped and laid out in a
2-up grid.

## About the design files
The file in this bundle (`Add Customer Modal - Option A.dc.html`) is a **design reference
created in HTML** — a prototype showing the intended look and behaviour. It is **not
production code to copy directly**. The task is to **recreate this design in the app's existing
codebase** (React/Vue/etc.) using its established components, form library, and styling
patterns. Map the inputs/buttons described below onto your existing UI primitives rather than
porting the raw HTML. If there is no component system yet, implement with the most appropriate
framework for the project.

## Fidelity
**High-fidelity.** Colours, typography, spacing, radii, and states below are final and exact.
Recreate the layout and visual treatment faithfully, substituting your codebase's equivalent
components where they exist.

---

## Screen: Add new customer (modal dialog)

### Purpose
A staff member at a desktop creates a new customer record (name, business, contact methods,
address) for jobs, invoices and reminders.

### Layout
- **Overlay:** full-viewport scrim, `rgba(16,20,28,0.45)`, modal centred.
- **Modal card:** `width: 924px` (max-width 100% on small screens), `background:#fff`,
  `border-radius:18px`, `border:1px solid rgba(16,20,28,0.05)`,
  `box-shadow: 0 28px 70px -24px rgba(16,20,28,0.34), 0 8px 24px -14px rgba(16,20,28,0.18)`,
  `overflow:hidden`.
- **Vertical structure:** Header → 3 section rows → Footer.
- **Each section row** is a CSS grid: `grid-template-columns: 190px 1fr; gap: 36px;
  padding: 22px 30px;`. Left cell = section title + caption (the "label rail"); right cell =
  the field grid. Sections 1 & 2 have a `1px solid #f3f5f7` bottom border; section 3 has none.
- **Field grid (right cell):** `display:grid; grid-template-columns: 1fr 1fr; gap: 14px 18px;`.
  Full-width fields use `grid-column: 1 / -1`.

### Header
- Padding `22px 30px 20px`, bottom border `1px solid #eef0f3`, space-between row.
- **Title:** "Add new customer" — 19px / 700 / color `#16191f` / letter-spacing `-0.015em`.
- **Subtitle:** "Create a record for jobs, invoices and reminders." — 13px / color `#8a909c` /
  margin-top 3px.
- **Close button (top-right):** 34×34, `border-radius:9px`, transparent bg,
  hover bg `#f3f5f7`. Icon = X, 20px, stroke `#9aa0ab`, stroke-width 2, round caps.

### Section 1 — Customer
- Rail title "Customer" (15px / 700 / `#16191f`), caption "Their name and business."
  (12.5px / `#9aa0ab`).
- Fields:
  - **First name** *(required)* — placeholder "Jordan", half width.
  - **Last name** *(required)* — placeholder "Whitfield", half width.
  - **Company name** *(optional)* — placeholder "e.g. Whitfield Logistics Ltd", full width.
    Label suffix "· optional" in `#aeb4be`, weight 500.

### Section 2 — Contact
- Rail title "Contact", caption "How you'll reach them."
- Fields:
  - **Email** — placeholder "name@company.co.uk", half width.
  - **Mobile** — placeholder "07700 900000", half width.
  - **Phone** with "· landline" suffix — placeholder "0161 000 0000", half width.
  - **"Add another email or number"** — text/ghost button (bottom-aligned in its grid cell):
    plus icon (15px) + label, 13px / 600 / `#16191f`, hover color `#3a3f4a`. Clicking appends
    an extra email or phone row (replaces the original "+ Add another email" / "+ Add another
    mobile" links — keep that multi-value capability).

### Section 3 — Address
- Rail title "Address", caption "For invoices and collection."
- Fields:
  - **Postcode** (half width) — input + **Find** button in a `display:flex; gap:8px` row.
    Input has `text-transform:uppercase`, placeholder "SW1A 1AA". Find button: height 42,
    padding `0 16px`, `border:1px solid #d7dbe0`, `border-radius:10px`, bg `#f6f7f9`,
    13px / 700 / `#16191f`, hover bg `#eef0f3`. (Wire to your postcode-lookup service to
    auto-fill the address lines; if none exists, leave as a no-op/disabled.)
  - **Town / City** — half width.
  - **Address line 1** — full width.
  - **Address line 2** *(optional)* — half width.
  - **County** — half width.

### Footer
- Padding `16px 30px`, bg `#fafbfc`, top border `1px solid #eef0f3`, space-between row.
- **Left:** "* Required fields" — 12.5px / `#9aa0ab`, asterisk `#d23f3f`.
- **Right:** button group, `gap:10px`:
  - **Cancel** — height 42, padding `0 20px`, `border:1px solid #d7dbe0`, radius 10,
    bg `#fff`, 14px / 600 / `#3a3f4a`, hover bg `#f6f7f9`. Closes without saving.
  - **Add customer** (primary) — height 42, padding `0 22px`, no border, radius 10,
    bg `#16191f`, text `#fff`, 14px / 700, hover bg `#000`. Submits the form.

---

## Inputs (shared spec)
All text inputs: `height:42px`, `border:1px solid #e4e7ec`, `border-radius:10px`,
`padding:0 14px`, `font-size:15px`, color `#16191f`, bg `#fff`, `box-sizing:border-box`.
- **Label:** sits above input, 13px / 600 / `#3a3f4a`, 6px gap to input.
- **Required marker:** ` *` in `#d23f3f` after the label text.
- **Optional marker:** ` · optional` in `#aeb4be`, weight 500.
- **Focus state:** `border-color:#16191f; box-shadow:0 0 0 3px rgba(22,25,31,0.08)`,
  remove default outline.

## Interactions & behaviour
- **Open/close:** standard modal. Close on X, Cancel, scrim click, and `Esc`. Trap focus
  inside the modal; return focus to the trigger on close.
- **Add another email/number:** appends an additional contact input (preserve original
  multi-email / multi-mobile capability).
- **Find (postcode):** triggers postcode lookup → populates Address line 1/2, Town/City,
  County.
- **Submit (Add customer):** validate, then create the customer record.
- **No layout animation required** beyond the app's existing modal enter/exit transition.

## Form validation
- **First name** and **Last name** are **required** — block submit and show inline error if
  empty.
- **Email** — validate format when present (it is optional here; confirm against business
  rules).
- All other fields optional. Use the codebase's existing validation/error-display pattern
  (e.g. red border + helper text under the field).

## State management
- Form field values: firstName*, lastName*, companyName, emails[] (multi), mobiles[] (multi),
  landline, postcode, addressLine1, addressLine2, townCity, county.
- `emails` / `mobiles` are arrays to support "Add another".
- isSubmitting / errors map for validation.
- Postcode-lookup loading + results state (if implemented).

## Design tokens
**Colours**
- Text primary `#16191f`; section captions/muted `#9aa0ab`; label text `#3a3f4a`;
  optional-suffix `#aeb4be`; subtitle `#8a909c`.
- Border (inputs) `#e4e7ec`; section divider `#f3f5f7`; header/footer divider `#eef0f3`.
- Footer bg `#fafbfc`; secondary-button border `#d7dbe0`; Find button bg `#f6f7f9` /
  hover `#eef0f3`.
- Primary button bg `#16191f` / hover `#000`; primary text `#fff`.
- Required/error accent `#d23f3f`.
- Scrim `rgba(16,20,28,0.45)`.

**Typography** — Hanken Grotesk (Google Fonts), weights 400/500/600/700. Swap for your app's
sans if it has one; keep the weight/size scale.
- Title 19/700; section title 15/700; subtitle 13/400; label 13/600; input 15/400;
  caption & footnote 12.5; buttons 14/(600 secondary, 700 primary).

**Spacing** — modal padding `22px 30px` (sections), `16px 30px` (footer); rail gap 36px;
field grid gap `14px 18px`; label→input gap 6px.

**Radius** — modal 18px; inputs & buttons 10px; close/icon button 9px.

**Shadows** — modal `0 28px 70px -24px rgba(16,20,28,0.34), 0 8px 24px -14px rgba(16,20,28,0.18)`;
input focus ring `0 0 0 3px rgba(22,25,31,0.08)`.

## Assets
No image assets. Two inline SVG line icons only: a close "X" and a "plus" — replace with your
icon library's equivalents (e.g. `X` / `Plus`).

## Files
- `Add Customer Modal - Option A.dc.html` — the high-fidelity reference for Option A
  (rendered as a centred modal over a scrim). Open in a browser to inspect exact spacing,
  colours, and hover/focus states.
