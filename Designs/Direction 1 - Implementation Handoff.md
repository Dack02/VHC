# New Jobsheet — Direction 1 (single column, full-width Work Details)

**Goal:** stop splitting the screen 50/50. A jobsheet with many labour + parts lines
needs the Work Details table at **full page width**; the booking metadata is all narrow
inputs and reads fine stacked. So: collapse the two columns into **one column**, put the
**Workshop schedule** and **Work Details** full-width below the booking fields.

This is a layout-only change. No state, handlers, API calls, or validation change.

Touches **two files**:
- `apps/web/src/pages/Jobsheets/NewJobsheet.tsx` — flatten the grid, move the
  schedule + work panel into the single column.
- `apps/web/src/pages/Jobsheets/WorkDetailsPanel.tsx` — widen the line-item grid now
  that it has the whole width (today it's tuned for the narrow sidebar).

---

## Target page order (single column, `max-w-5xl`)

```
New Jobsheet
├─ Vehicle              ┐ side-by-side (2-col) on ≥sm, stack on mobile
├─ Customer            ┘
├─ Booking details     (full width — requirement, advisor, mileage, delivery, codes, contact notes)
├─ Work Required       (VHC toggle)
├─ Workshop schedule   (BookingDatePicker — FULL WIDTH)
├─ Work details        (WorkDetailsPanel — FULL WIDTH, grows downward)
├─ capacity warnings
└─ Create Jobsheet / Cancel
```

The schedule week-strip and the invoice table both finally get the full width; the table
no longer has to clip its Description column.

---

## File 1 — `NewJobsheet.tsx`

### Edit 1 · Flatten the outer grid (remove the two-column wrapper + inner form)

**Find:**
```tsx
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <form onSubmit={handleSubmit} className="lg:col-span-1 space-y-4">
        {/* Vehicle */}
```
**Replace with:**
```tsx
      <form onSubmit={handleSubmit} className="max-w-5xl space-y-4">
        {/* Vehicle + Customer — compact band, side by side on wide screens */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        {/* Vehicle */}
```

> This opens a 2-col band that wraps **only** the Vehicle and Customer cards. Close it
> right after the Customer card (Edit 2).

### Edit 2 · Close the Vehicle/Customer band after the Customer card

The Customer card is the block that starts with `{selectedVehicle && (` and ends with its
`)}`. Immediately **after** that closing `)}` and **before** `{/* Booking details */}`,
add one closing `</div>`:

**Find:**
```tsx
          </div>
        )}

        {/* Booking details */}
```
**Replace with:**
```tsx
          </div>
        )}
        </div>{/* /Vehicle+Customer band */}

        {/* Booking details */}
```

*(If that `</div>\n        )}` fragment isn't unique, anchor on the `{/* Booking details */}`
comment — the new `</div>` goes on the line directly above it.)*

### Edit 3 · Move schedule + Work Details into the single column, drop the right column

**Find** (the tail — from the capacity warnings through the end of the old grid):
```tsx
        {capacityBlocked && (
          <p className="text-xs text-rag-red">This day is full — pick another day in Workshop schedule date before creating the jobsheet.</p>
        )}
        {overrideMissing && (
          <p className="text-xs text-rag-amber">This day is over your loading target — add a reason in Workshop schedule date to book it.</p>
        )}
        <div className="flex gap-3">
          <button type="submit" disabled={submitting || !selectedVehicle?.customer_id || !form.dueInDate || capacityBlocked || overrideMissing} className="px-6 py-2 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark disabled:opacity-50">
            {submitting ? 'Creating…' : 'Create Jobsheet'}
          </button>
          <button type="button" onClick={handleCancel} className="px-6 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
        </form>

        {/* Right: booking date (capacity-aware) on top, then priced work on the draft jobsheet */}
        <div className="lg:col-span-1 space-y-4">
          {/* Booking date — capacity-aware picker (Resource Manager). Leads the right
              column so the week strip + recommendation are prominent while you build work. */}
          <BookingDatePicker
```
**Replace with:**
```tsx
        {/* Workshop schedule — full width, capacity-aware picker (Resource Manager) */}
        <BookingDatePicker
```

Then **find** the end of that moved right-column block (the `</div>` that closed the old
right column and the `</div>` that closed the old grid):
```tsx
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-2">Work Details</h2>
              <p className="text-sm text-gray-400">Select a vehicle and customer to start adding labour, parts and packages — they’ll be saved to this booking as you go.</p>
            </div>
          )}
        </div>
      </div>
```
**Replace with:**
```tsx
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-2">Work Details</h2>
              <p className="text-sm text-gray-400">Select a vehicle and customer to start adding labour, parts and packages — they’ll be saved to this booking as you go.</p>
            </div>
          )}

        {capacityBlocked && (
          <p className="text-xs text-rag-red">This day is full — pick another day in Workshop schedule date before creating the jobsheet.</p>
        )}
        {overrideMissing && (
          <p className="text-xs text-rag-amber">This day is over your loading target — add a reason in Workshop schedule date to book it.</p>
        )}
        <div className="flex gap-3">
          <button type="submit" disabled={submitting || !selectedVehicle?.customer_id || !form.dueInDate || capacityBlocked || overrideMissing} className="px-6 py-2 bg-primary text-white font-medium rounded-lg hover:bg-primary-dark disabled:opacity-50">
            {submitting ? 'Creating…' : 'Create Jobsheet'}
          </button>
          <button type="button" onClick={handleCancel} className="px-6 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
      </form>
```

Net effect: `<BookingDatePicker>` and the `{draftId && token ? <WorkDetailsPanel/> : …}`
block now sit in the single column (after the Work Required card); the capacity warnings
and the action buttons move to the very bottom; the old right-column `<div>` and the grid
`</div>` are gone, and the `<form>` now wraps everything.

### Edit 4 · Let Work Details span full width

The panel defaults its own wrapper to `className="lg:col-span-2"` (a leftover from the
grid). Pass an explicit empty class so it's plain full-width:

**Find:**
```tsx
            <WorkDetailsPanel
              parent={{ type: 'jobsheet', id: draftId }}
              token={token}
              organizationId={user?.organization?.id}
```
**Replace with:**
```tsx
            <WorkDetailsPanel
              className=""
              parent={{ type: 'jobsheet', id: draftId }}
              token={token}
              organizationId={user?.organization?.id}
```

---

## File 2 — `WorkDetailsPanel.tsx`

### Edit 5 · Widen the line-item grid (it now has the whole page)

**Find:**
```tsx
// Invoice grid: Description (flex, min 110px) · Type · Qty/Hr · Rate · Total · action.
// The 110px floor keeps the description readable in the narrow live-build sidebar
// (panel ≈ half-width at the lg breakpoint); cells clip rather than overlap.
const GRID_COLS = 'minmax(110px,1fr) 44px 42px 54px 64px 20px'
```
**Replace with:**
```tsx
// Invoice grid: Description (flex) · Type · Qty/Hr · Rate · Total · action.
// Full-width layout — the panel now spans the whole page, so the description gets
// real room and the numeric columns are comfortably readable / right-aligned.
const GRID_COLS = 'minmax(280px,1fr) 130px 100px 120px 130px 36px'
```

This is the only required change in this file — `GRID_COLS` drives the header band, the
group header rows, the labour rows and the parts rows, so widening it once fixes them all.

### Edit 6 (optional) · Roomier totals block

**Find:** `<div className="w-full sm:w-64 text-sm">`
**Replace:** `<div className="w-full sm:w-80 text-sm">`

### Edit 7 (optional) · Update the default className

If nothing else imports `WorkDetailsPanel` with the grid assumption, change its default
so callers don't need to pass `className=""`:

**Find:** `}, className = 'lg:col-span-2'`
**Replace:** `}, className = ''`

> ⚠️ Before doing Edit 7, grep for other `<WorkDetailsPanel` usages (e.g. the Estimate /
> JobsheetDetail screens). If any rely on `lg:col-span-2`, keep the default and instead
> pass `className="lg:col-span-2"` there. Otherwise skip Edit 7 and keep Edit 4.

---

## Verify

- `cd apps/web && npx tsc --noEmit` (or the repo's typecheck) — should pass; this is JSX only.
- Manually: New Jobsheet → pick a vehicle + customer → add a package and several labour/parts
  lines. The table should fill the page width with a readable Description column and the
  schedule strip above it; everything stacks in one column.
- Mobile: the Vehicle/Customer band collapses to one column (`grid-cols-1`), the rest already stacks.

## Notes / out of scope
- Nothing about the draft-jobsheet lifecycle, capacity guard, or pricing changes.
- Booking Notes stays inside the Work Details panel as today.
- The Work Required (VHC) card stays where it is, just above Work Details — its copy
  ("…under Work Details →") still reads correctly since Work Details now follows it.
