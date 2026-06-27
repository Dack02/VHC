# Form & Modal Design Guidelines

The standard look-and-feel for **data-entry forms and modal dialogs** across the
VHC web app. Any new form (create/edit modal, settings panel, multi-field entry
screen) should follow this so the product feels consistent.

- **Canonical reference implementation:** [`apps/web/src/components/customers/CustomerFormModal.tsx`](../apps/web/src/components/customers/CustomerFormModal.tsx)
  — copy its structure and class strings rather than inventing new ones.
- **Original design handoff:** [`Designs/design_handoff_add_customer_modal/README.md`](../Designs/design_handoff_add_customer_modal/README.md)
  ("Add Customer Modal — Option A, Sectioned compact"). The tokens below are the
  final, exact values from that handoff.

> When in doubt, open `CustomerFormModal.tsx` and reuse its `inputCls`,
> `labelCls`, button, section and footer class strings verbatim. Treat that file
> as the source of truth; this doc explains the intent.

---

## When this applies

- **Modals** that capture or edit a record (customers, vehicles, suppliers,
  templates, settings sub-dialogs, etc.).
- **In-page forms** with more than a couple of fields.

It does **not** override the broader app chrome (sidebar, kanban tiles, RAG
status, report cards) — those keep the existing `rounded-xl` card / tenant
`bg-primary` conventions in the root styling guide. This is specifically the
**form/dialog** layer.

---

## Design tokens

**Typography** — the app's default sans is **Hanken Grotesk** (set in
`tailwind.config.js` + `index.css`), so the design's type scale comes for free.

| Role | Size / weight | Colour |
|------|---------------|--------|
| Modal title | 19px / 700, tracking -0.015em | `#16191f` |
| Modal subtitle | 13px / 400 | `#8a909c` |
| Section title (rail) | 15px / 700 | `#16191f` |
| Section caption (rail) | 12.5px | `#9aa0ab` |
| Field label | 13px / 600 | `#3a3f4a` |
| Input text | 15px / 400 | `#16191f` |
| Footnote / helper | 12.5px | `#9aa0ab` |
| Button (secondary / primary) | 14px / 600 · 700 | — |

**Colours**

- Text primary `#16191f`; label `#3a3f4a`; muted caption `#9aa0ab`; subtitle
  `#8a909c`; optional-suffix `#aeb4be`.
- Input border `#e4e7ec`; section divider `#f3f5f7`; header/footer divider `#eef0f3`.
- Footer bg `#fafbfc`; secondary/Find button border `#d7dbe0`; Find button bg
  `#f6f7f9` / hover `#eef0f3`.
- **Primary action** bg `#16191f` / hover `#000` / text `#fff`. **Note:** form
  primary buttons use this fixed neutral-dark, *not* the tenant `bg-primary`
  brand colour (brand colour stays for nav, links, badges). Don't "fix" this to
  `bg-primary`.
- Required / error accent `#d23f3f`.
- Scrim `rgba(16,20,28,0.45)`.

**Radius** — modal `18px`; inputs & buttons `10px`; close / icon buttons `9px`.

**Spacing** — section rows `padding: 22px 30px`; footer `16px 30px`; label-rail
gap `36px` (Tailwind `gap-9`); field grid gap `14px 18px`; label→input gap `6px`.

**Shadows** — modal
`0 28px 70px -24px rgba(16,20,28,0.34), 0 8px 24px -14px rgba(16,20,28,0.18)`;
input focus ring `0 0 0 3px rgba(22,25,31,0.08)` with border → `#16191f`.

---

## Reusable class strings

Copy these from `CustomerFormModal.tsx`. If you build a second form, prefer
extracting them into a shared module (e.g. `lib/formStyles.ts`) over
copy-pasting a third time.

```tsx
// Text input (height 42, 10px radius, dark focus ring)
const inputCls =
  'h-[42px] w-full box-border rounded-[10px] border border-[#e4e7ec] bg-white px-[14px] text-[15px] text-[#16191f] ' +
  'placeholder:text-[#aeb4be] focus:outline-none focus:border-[#16191f] focus:shadow-[0_0_0_3px_rgba(22,25,31,0.08)]'

// Error variant (red border)
const inputErrCls = inputCls.replace('border-[#e4e7ec]', 'border-[#d23f3f]')

// Field label
const labelCls = 'mb-1.5 block text-[13px] font-semibold text-[#3a3f4a]'
```

```tsx
// Primary action  (submit)
className="h-[42px] rounded-[10px] bg-[#16191f] px-[22px] text-[14px] font-bold text-white hover:bg-black disabled:opacity-50"

// Secondary action (cancel)
className="h-[42px] rounded-[10px] border border-[#d7dbe0] bg-white px-5 text-[14px] font-semibold text-[#3a3f4a] hover:bg-[#f6f7f9]"

// Tertiary / ghost action (e.g. "Add another …")
className="flex h-[42px] items-center gap-1.5 text-[13px] font-semibold text-[#16191f] hover:text-[#3a3f4a]"
```

**Markers in labels:** required → `<span className="text-[#d23f3f]"> *</span>`;
optional → `<span className="font-medium text-[#aeb4be]"> · optional</span>`.

---

## Layout pattern

### Modal shell

```tsx
// Scrim — click-outside closes
<div
  className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(16,20,28,0.45)] p-4"
  onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
>
  {/* Card: 924px, 18px radius, soft shadow, scrolls internally */}
  <div
    role="dialog" aria-modal="true" aria-label="…"
    className="flex max-h-[92vh] w-[924px] max-w-full flex-col overflow-hidden rounded-[18px] border border-[rgba(16,20,28,0.05)] bg-white shadow-[0_28px_70px_-24px_rgba(16,20,28,0.34),0_8px_24px_-14px_rgba(16,20,28,0.18)]"
  >
    {/* Header (title + subtitle + close) → scrollable body → sticky footer */}
  </div>
</div>
```

Header is `border-b border-[#eef0f3] px-[30px] pb-5 pt-[22px]`; footer is
`border-t border-[#eef0f3] bg-[#fafbfc] px-[30px] py-4` with "* Required fields"
on the left and the Cancel / primary button group on the right.

### Sectioned label-rail (for multi-section forms)

Each section is a two-column grid: a left **label rail** (title + caption) and a
right **field grid**. Use it when a form has natural groups (e.g. Customer /
Contact / Address).

```tsx
<section className="grid grid-cols-1 gap-9 border-b border-[#f3f5f7] px-[30px] py-[22px] sm:grid-cols-[190px_1fr]">
  <div>
    <h3 className="text-[15px] font-bold text-[#16191f]">Section title</h3>
    <p className="mt-1 text-[12.5px] text-[#9aa0ab]">Short caption.</p>
  </div>
  <div className="grid grid-cols-1 gap-x-[18px] gap-y-[14px] sm:grid-cols-2">
    {/* half-width field */}
    <div>…</div>
    {/* full-width field */}
    <div className="sm:col-span-2">…</div>
  </div>
</section>
```

The last section drops the `border-b`. On narrow screens the rail stacks above
the fields (`grid-cols-1`).

### Simpler forms

A short form doesn't need the rail — drop straight into the field grid
(`grid grid-cols-1 gap-x-[18px] gap-y-[14px] sm:grid-cols-2`) inside the modal
body, but keep the same header, footer, inputs, buttons and tokens.

---

## Behaviour (required)

- **Close affordances:** X button, Cancel button, scrim click, and **Esc**.
- **Focus:** focus the first field on open; **trap Tab** inside the modal; restore
  focus to the trigger element on close. (See the `useEffect` focus-trap in
  `CustomerFormModal.tsx`.)
- **Validation:** validate on submit; show inline errors with the red-border
  input (`inputErrCls`) + a `text-[12.5px] text-[#d23f3f]` helper under the field.
  Block submit while required fields are empty.
- **Submit state:** disable the primary button and show "Saving…" while the
  request is in flight; surface request failures via `toast` and/or an inline
  banner.
- **Multi-value fields** (e.g. extra emails/phones): an "Add another …" ghost
  button appends rows; each row has a remove (×) control.
- **External lookups** (postcode, reg, etc.): an inline action button next to the
  field; **degrade gracefully** (disabled no-op with an explanatory `title`) when
  the provider isn't configured — never hard-fail the form.

---

## New-form checklist

- [ ] Reuses `inputCls` / `labelCls` / button class strings (no ad-hoc input styling).
- [ ] Header (title + subtitle) and footer ("* Required fields" + Cancel/primary).
- [ ] Primary action is neutral-dark `#16191f` (not `bg-primary`).
- [ ] Required `*` and optional `· optional` markers applied.
- [ ] Esc / scrim / Cancel close; focus trapped + restored.
- [ ] Inline validation with red border + helper text.
- [ ] Loading + error states (disabled submit, toast/banner).
