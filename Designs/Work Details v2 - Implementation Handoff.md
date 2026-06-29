# Work Details — Inline line editor (v2)

**Goal:** replace the two always-open entry cards (Add labour + Add part) inside each
expanded work line with **one inline editor row that lives in the table columns**, opened
on demand from a quiet `+ Labour` / `+ Part` action row. One editor open at a time, so a
line's height stays flat no matter how many lines the job has.

**Why:** today every expanded line permanently renders a full labour card *and* a full
part card. On a multi-line job that's a wall of forms, and the entry fields use a totally
different visual language (own labels, own widths) from the column-aligned saved rows.
The fix keeps data display and data entry in the same grid.

**Scope:** all changes are inside `WorkLineGroup` in
`apps/web/src/pages/Jobsheets/WorkDetailsPanel.tsx`. No API/state/validation/pricing
changes — the submit handlers (`submitLabour`, `submitPart`), the data model, and the
totals are untouched. This is a presentation + local open/close-state change.

---

## Behaviour spec

Inside an expanded line, **below the saved labour/parts rows**:

```
[ saved labour/parts rows, column-aligned — unchanged ]
+ Labour    + Part                      ← quiet green text actions (resting)
```

- Click **+ Part** → the action row is replaced by an inline **part editor** that spans
  the grid columns: Description input under *Description*, "Part" label under *Type*, Qty
  input under *Qty/Hr*, Sell £ input under *Rate*, live line total under *Total*. A second
  thin row under it holds Supplier select + Cost £ + live margin, with **Cancel** /
  **Save part** (green) pushed right.
- Click **+ Labour** → inline **labour editor**: Description input under *Description*,
  "Labour" under *Type*, Hours input under *Qty/Hr*, the locked rate shown under *Rate*,
  live total under *Total*; Cancel / **Save labour** (green) on a second row.
- Only one editor open per line at a time. Opening one closes the other. Save (success)
  or Cancel returns to the resting `+ Labour  + Part` row. Enter still submits.
- The green editor band uses `bg-green-50 border-green-200` to read as "active entry".
- Primary action button is **green** (`bg-green-600 hover:bg-green-700 text-white`), not
  the current dark-grey `btnPrimary`.

---

## Implementation

### 1 · Add local open-state to `WorkLineGroup`

Find the existing local state near the top of the component:
```tsx
  const [labDesc, setLabDesc] = useState('')
  const [labHours, setLabHours] = useState('')
  const [savingLab, setSavingLab] = useState(false)
  const [part, setPart] = useState({ description: '', quantity: '1', costPrice: '', sellPrice: '', supplierId: '' })
  const [savingPart, setSavingPart] = useState(false)
```
Add below it:
```tsx
  // Which inline editor is open in this line: none, labour, or part. One at a time.
  const [editor, setEditor] = useState<null | 'labour' | 'part'>(null)
```

In the success branches of `submitLabour` / `submitPart`, close the editor after a save:
```tsx
    if (ok) { setLabHours(''); setLabDesc(''); setEditor(null) }   // submitLabour
    ...
    if (ok) { setPart({ description: '', quantity: '1', costPrice: '', sellPrice: '', supplierId: '' }); setEditor(null) }  // submitPart
```

### 2 · Add a green primary button class (local to the file)

Near the other style consts (`compactSelect`, `fieldCls`, `btnPrimary`…), add:
```tsx
  const btnSave = 'h-9 px-4 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50'
  const btnCancel = 'h-9 px-4 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50'
```
A shared grid-cell input that matches the row columns:
```tsx
  const cellInput = 'h-9 w-full rounded-lg border border-[#e4e7ec] bg-white px-2.5 text-sm text-[#16191f] focus:outline-none focus:border-[#16191f] focus:shadow-[0_0_0_3px_rgba(22,25,31,0.08)]'
```

### 3 · Replace the entry block

**Find** the whole entry-panels block — from the opening comment through its closing
`</div>`:
```tsx
          {/* Entry panels — roomy, labelled fields */}
          {editable && (
            <div className="mx-3 mt-2 space-y-2">
              {/* Add labour */}
              ...
              {/* Add part */}
              ...
            </div>
          )}
```
*(It starts at `{/* Entry panels — roomy, labelled fields */}` and ends at the `</div>`
that closes `<div className="mx-3 mt-2 space-y-2">`, right before `{/* Line subtotal */}`.)*

**Replace with:**
```tsx
          {/* Inline entry — one editor at a time, aligned to the line-item grid */}
          {editable && (
            <>
              {/* LABOUR editor */}
              {editor === 'labour' && (
                canAddLabour ? (
                  <>
                    <div className="grid items-center gap-x-2 px-3 py-2 bg-green-50 border-y border-green-200" style={{ gridTemplateColumns: GRID_COLS }}>
                      <input autoFocus value={labDesc} onChange={e => setLabDesc(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submitLabour(); if (e.key === 'Escape') setEditor(null) }}
                        placeholder="Labour description" className={`${cellInput} ml-6`} style={{ width: 'calc(100% - 1.5rem)' }} />
                      <span className="text-xs font-medium text-green-700">Labour</span>
                      <input type="number" step="0.1" min="0" value={labHours} onChange={e => setLabHours(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submitLabour() }} placeholder="0.0" className={`${cellInput} text-right`} />
                      <span className="text-right text-sm text-gray-500">{money(lockedCode!.hourlyRate)}</span>
                      <span className="text-right text-sm font-semibold text-gray-900">{money((parseFloat(labHours) || 0) * lockedCode!.hourlyRate)}</span>
                      <span />
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 pl-9 bg-green-50 border-b border-green-200">
                      <span className="text-xs text-gray-500">{lockedCode!.code} @ {money(lockedCode!.hourlyRate)}/hr</span>
                      <div className="ml-auto flex gap-2">
                        <button onClick={() => setEditor(null)} className={btnCancel}>Cancel</button>
                        <button onClick={submitLabour} disabled={savingLab || !labDesc.trim() || !labHours} className={btnSave}>Save labour</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="px-3 pl-9 py-2 text-xs text-amber-600">Pick a repair type {repairType && !lockedCode ? 'with a default labour code ' : ''}above to add labour.</p>
                )
              )}

              {/* PART editor */}
              {editor === 'part' && (
                <>
                  <div className="grid items-center gap-x-2 px-3 py-2 bg-green-50 border-y border-green-200" style={{ gridTemplateColumns: GRID_COLS }}>
                    <input autoFocus value={part.description} onChange={e => setPart({ ...part, description: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Escape') setEditor(null) }}
                      placeholder="Part description" className={`${cellInput} ml-6`} style={{ width: 'calc(100% - 1.5rem)' }} />
                    <span className="text-xs font-medium text-green-700">Part</span>
                    <input type="number" step="1" min="0" value={part.quantity} onChange={e => setPart({ ...part, quantity: e.target.value })} className={`${cellInput} text-right`} />
                    <input type="number" step="0.01" min="0" value={part.sellPrice} onChange={e => setPart({ ...part, sellPrice: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') submitPart() }} placeholder="Sell £" className={`${cellInput} text-right`} />
                    <span className="text-right text-sm font-semibold text-gray-900">{money((parseFloat(part.quantity) || 0) * (parseFloat(part.sellPrice) || 0))}</span>
                    <span />
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 pl-9 bg-green-50 border-b border-green-200">
                    <select value={part.supplierId} onChange={e => setPart({ ...part, supplierId: e.target.value })} className={compactSelect}>
                      <option value="">Supplier —</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <input type="number" step="0.01" min="0" value={part.costPrice} onChange={e => setPart({ ...part, costPrice: e.target.value })} placeholder="Cost £" className={`${cellInput} w-28`} />
                    {margin != null && <span className="text-xs text-gray-500">Margin <strong className="text-green-700">{margin.toFixed(0)}%</strong></span>}
                    <div className="ml-auto flex gap-2">
                      <button onClick={() => setEditor(null)} className={btnCancel}>Cancel</button>
                      <button onClick={submitPart} disabled={savingPart || !part.description.trim() || part.sellPrice === ''} className={btnSave}>Save part</button>
                    </div>
                  </div>
                </>
              )}

              {/* Resting action row */}
              {editor === null && (
                <div className="flex gap-5 px-3 py-2 pl-12">
                  <button onClick={() => setEditor('labour')} className="text-sm font-semibold text-green-700 hover:text-green-800">+ Labour</button>
                  <button onClick={() => setEditor('part')} className="text-sm font-semibold text-green-700 hover:text-green-800">+ Part</button>
                </div>
              )}
            </>
          )}
```

### 4 · (Optional) fold Repair type onto the expanded header

Today Repair type sits in its own grey bar (`mx-3 mb-2 px-3 py-2 rounded-lg bg-gray-50/70`).
In the mock it's a compact select on the group header line. If you want that, move the
`<select>` (the `compactSelect` one) up next to `{line.name}` in the group-header button row
and delete the grey bar — purely cosmetic, safe to skip. Keep the
`Labour @ £x/hr` / `No labour code` hint somewhere visible (e.g. trailing the header).

---

## Verify
- Typecheck (`npx tsc --noEmit`) — JSX/local-state only.
- Expand a line → see `+ Labour  + Part`. Click each: an inline editor opens in the grid
  columns; the other closes. Save commits via the existing handler and returns to the
  resting row; Cancel/Escape closes with no write. Live total + margin update as you type.
- Read-only inspection lines (`editable === false`) show no action row — unchanged.

## Out of scope
- Server calls, pricing, VAT, totals, the package picker, and the add-work-line flow are
  all unchanged.
- This pairs with the Direction 1 page layout but doesn't depend on it.
