# VHC PDF Redesign - Implementation Prompt

## Overview

Refactor the Vehicle Health Check PDF generation system to produce a clean, professional single-page A4 report. The current multi-page design with duplicate content blocks needs to be replaced with a compact, scannable layout.

**Reference**: See the attached screenshot showing the target design.

---

## Current System Architecture

The PDF system uses Puppeteer to render HTML to PDF. Key files:

```
apps/api/src/services/pdf-generator/
├── pdf.ts                          # Puppeteer rendering (A4, 10mm margins)
├── generators/
│   └── health-check.ts             # Main template - REFACTOR THIS
├── components/
│   ├── header.ts                   # Keep, modify
│   ├── info-section.ts             # Replace with info-bar
│   ├── dashboard.ts                # Replace with rag-summary
│   ├── vehicle-summary.ts          # Remove (consolidating into measurements)
│   ├── measurements/
│   │   ├── tyre-details-card.ts    # Replace with compact tyre grid
│   │   └── brake-card.ts           # Replace with compact brake table
│   ├── item-rows.ts                # Refactor for compact findings
│   ├── green-items.ts              # Replace with quantity-only summary
│   ├── signatures.ts               # Simplify to inline footer
│   └── summary.ts                  # Remove (pricing now in RAG blocks)
├── styles/
│   ├── base.ts                     # Keep, update
│   └── health-check.ts             # Major refactor
└── types.ts                        # HealthCheckPDFData interface
```

---

## Page Structure (Top to Bottom)

### 1. Header
Slim horizontal bar with:
- **Left**: Logo (40x40px max) + "Vehicle Health Check" title + site name subtitle
- **Right**: Report reference (e.g., "VHC00017") + generation date

### 2. Info Bar
Single grey background row containing:
- Registration plate (yellow background, bold)
- Vehicle: Make Model Year
- Customer: Name
- Inspected: Date • Technician Name

### 3. RAG Summary with Pricing
Four blocks in a row:
| Red Block | Amber Block | Green Block | Total Quote |
|-----------|-------------|-------------|-------------|
| Count + "Immediate Attention" + £subtotal | Count + "Advisory Items" + £subtotal | Count + "Checked OK" + "—" | Dark block with total |

### 4. Measurements Section
Two cards side-by-side:

**Left Card: Tyre Tread Depth**
- Header: "Tyre Tread Depth" with legend "Outer / Middle / Inner (mm) • Legal min: 1.6mm"
- 2x2 grid showing all four tyres:
  - Position name: "Front Left", "Front Right", "Rear Left", "Rear Right"
  - Three depth readings: "5.2 / 4.1 / 4.1"
  - Status dot (green/amber/red)
- Highlight critical readings in red
- Background colour indicates status (red-light for urgent, amber-light for advisory)

**Right Card: Brake Measurements**
- Header: "Brake Measurements" with legend "Thickness in mm"
- Two columns: Front Brakes | Rear Brakes
- Table format for front:
  ```
              Nearside    Offside
  Pad         5.0         5.0
  Disc        15.0        15.0
  Min spec    —           16.0
  ```
- Alert message if below spec: "⚠ Discs below minimum — replacement required"
- Show "No data recorded" if no rear brake data

### 5. Findings Section
Three collapsible-style groups:

**Red Group: "⚠ Immediate Attention Required"**
- Red-tinted header
- List of findings, each row containing:
  - Item name (bold)
  - One-line description
  - Deferred badge + date (if applicable)
  - Price (right-aligned)

**Amber Group: "⚡ Advisory Items"**
- Amber-tinted header
- Same row structure as red

**Green Group: "✓ Checked OK"**
- Green-tinted header
- Simple text: "**{count} items** passed inspection with no issues identified"
- Do NOT list individual items

### 6. Footer
Horizontal layout:
- **Left**: Signature line with technician name, date, item count
- **Right**: Workshop name, phone, email
- **Far right**: Page number — "Page 1 of 1" or "Page 1 of 2" (if photos exist)

---

## Data Mapping

Map from `HealthCheckPDFData` to the new layout:

```typescript
// Header
healthCheck.site.branding.logoUrl → Logo image
healthCheck.reference → Report ref
healthCheck.created_at → Generation date
healthCheck.site.name → Site name subtitle

// Info Bar
healthCheck.vehicle.registration → Reg plate
healthCheck.vehicle.make, model, year → Vehicle info
healthCheck.customer.name → Customer name
healthCheck.inspection_date → Inspection date
healthCheck.technician.name → Technician name

// RAG Summary
results.filter(r => r.status === 'red').length → Red count
results.filter(r => r.status === 'amber').length → Amber count  
results.filter(r => r.status === 'green').length → Green count
// Pricing - sum from repair_items or check_results with prices
redItems.reduce((sum, item) => sum + item.total_price, 0) → Red subtotal
amberItems.reduce((sum, item) => sum + item.total_price, 0) → Amber subtotal

// Tyre Measurements
// Extract from check_results where template_item.category === 'tyres'
// or from dedicated tyre_measurements table if exists
tyreData = {
  front_left: { outer: 5.2, middle: 4.1, inner: 4.1, status: 'ok' },
  front_right: { outer: 2.4, middle: 2.4, inner: 1.4, status: 'urgent' },
  // etc.
}

// Brake Measurements  
// Extract from check_results where template_item.category === 'brakes'
brakeData = {
  front: {
    type: 'disc',
    nearside: { pad: 5.0, disc: 15.0 },
    offside: { pad: 5.0, disc: 15.0 },
    min_spec: 16.0
  },
  rear: null // or similar structure
}

// Findings
// Red/amber items from check_results joined with reasons
// Include: name, description (from AI-generated reason or template default)
// Include: deferred_until date if status === 'deferred'
// Include: price from repair_items or check_result.quoted_price

// Footer
healthCheck.technician_signature → Signature image (base64)
healthCheck.technician.name → Name
healthCheck.inspection_date → Date
results.length → Item count
healthCheck.site.phone, email → Contact
```

---

## Page 2: Photo Evidence (Conditional)

If any findings have associated photos, generate a second page:

### Page 2 Layout

**Header (Mini)**
- Same slim header as page 1 but simplified
- "Photo Evidence" as title
- Report ref + reg plate for reference

**Photo Grid**
- Group photos by the finding they relate to
- For each finding with photos:
  ```
  ┌─────────────────────────────────────────────────────┐
  │ Finding Name                              [Status]  │
  ├─────────────────────────────────────────────────────┤
  │ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
  │ │  Photo  │ │  Photo  │ │  Photo  │ │  Photo  │    │
  │ │    1    │ │    2    │ │    3    │ │    4    │    │
  │ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │
  └─────────────────────────────────────────────────────┘
  ```
- Max 4 photos per row
- Photo size: ~80x80px thumbnails
- Finding name links back to page 1 conceptually (e.g., "Front Brake Discs" with red/amber badge)

**Footer**
- Simple: "Page 2 of 2" + workshop name

### Photo Data Mapping
```typescript
// Photos come from check_result_media or similar
// Group by check_result_id, then map to finding name

interface PhotoGroup {
  finding_name: string;
  status: 'red' | 'amber';
  photos: {
    url: string;      // Supabase storage URL
    caption?: string; // Optional caption
  }[];
}

// Filter check_results that have media attached
const findingsWithPhotos = results
  .filter(r => r.media && r.media.length > 0)
  .map(r => ({
    finding_name: r.template_item.name,
    status: r.status,
    photos: r.media.map(m => ({
      url: `${SUPABASE_URL}/storage/v1/object/public/vhc-photos/${m.path}`,
      caption: m.caption
    }))
  }));
```

### Conditional Rendering
- If `findingsWithPhotos.length === 0`: Do NOT generate page 2, document is single page
- If photos exist: Generate page 2 with photo evidence
- Update page footer on page 1 to show "Page 1 of 2" when photos exist

---

## Edge Cases & Overflow Handling

### Content Overflow (Won't Fit One Page)
If content exceeds one A4 page:
1. **First priority**: Truncate finding descriptions to one line max
2. **Second priority**: If still overflowing, show max 5 items per RAG category with note "and {n} more items"
3. **Last resort**: Allow second page for findings only (measurements stay on page 1)

### Zero Items in Category
- If red count = 0: Still show the red RAG block with "0", hide the red findings group
- If amber count = 0: Same approach
- If green count = 0: Show "0 items" in green summary

### Missing Data
- No tyre data: Show "No tyre measurements recorded" in the tyre card
- No brake data for an axle: Show "No data recorded" in that column
- No price for item: Show "POA" (Price on Application)
- No customer: Show "—" or "Walk-in Customer"
- No technician signature: Show empty signature line with "(unsigned)"

### Deferred Items
- If `check_result.outcome === 'deferred'` and `deferred_until` exists:
  - Show "DEFERRED" badge next to the item
  - Show "⏱ Deferred until {formatted_date}" below description
- Deferred items should still appear in their RAG category (red/amber)

### Long Item Names or Descriptions
- Item names: Truncate with ellipsis at ~40 characters
- Descriptions: Single line, truncate at ~80 characters with ellipsis

---

## Styling Guidelines

### Colours (CSS Variables)
```css
--red: #DC2626;
--red-light: #FEF2F2;
--red-border: #FECACA;
--amber: #D97706;
--amber-light: #FFFBEB;
--amber-border: #FDE68A;
--green: #059669;
--green-light: #ECFDF5;
--green-border: #A7F3D0;
--gray-50 through --gray-900 (Tailwind scale)
```

### Typography
- Base font size: 9px
- Labels/meta: 7px
- Section headers: 9px bold
- Title: 16px bold
- Use system fonts only: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif`

### Spacing
- Page padding: 10mm
- Section gaps: 10-12px
- Inner padding: 6-10px

### Print/PDF Considerations
- No CSS variables in final output (Puppeteer limitation) - use inline styles or hardcoded values
- Avoid page breaks within sections (`page-break-inside: avoid`)
- Ensure all external images load before render (networkidle0 is already configured)
- Base64 encode the signature, don't rely on external URLs

---

## Implementation Steps

1. **Create new compact components**:
   - `components/compact/info-bar.ts`
   - `components/compact/rag-summary.ts`
   - `components/compact/tyre-grid.ts`
   - `components/compact/brake-table.ts`
   - `components/compact/findings-group.ts`
   - `components/compact/footer.ts`
   - `components/compact/photo-page.ts` — Page 2 with grouped photos

2. **Update styles**:
   - Create `styles/health-check-compact.ts` with all new styles
   - Keep existing styles for backwards compatibility if needed

3. **Refactor main generator**:
   - Update `generators/health-check.ts` to use new components
   - Add data transformation functions to map existing data to compact format
   - Add conditional page 2 generation when photos exist
   - Update page numbering logic

4. **Update data fetching** (if needed):
   - Ensure pricing subtotals are calculated
   - Ensure deferred dates are included in query
   - Ensure media/photos are included with check_results

5. **Test edge cases**:
   - 0 items in each category
   - Missing measurements
   - Very long item names
   - 10+ items (overflow scenario)
   - No photos (single page)
   - Multiple findings with photos (page 2 generated)

---

## Acceptance Criteria

- [ ] Single A4 page for typical health check (≤5 red, ≤5 amber items) when no photos
- [ ] All tyre measurements visible in compact 2x2 grid
- [ ] Brake measurements clearly labelled (Pad vs Disc rows)
- [ ] RAG blocks show count + subtotal pricing
- [ ] Total quote prominently displayed
- [ ] Deferred items show badge and date
- [ ] Green items show quantity only, not list
- [ ] Footer contains signature, technician info, and workshop contact
- [ ] No duplicate measurement data anywhere in document
- [ ] Photos appear on page 2 only, grouped by finding with clear reference
- [ ] Page 2 only generated if photos exist
- [ ] Page numbering updates correctly (1 of 1 vs 1 of 2)
- [ ] PDF renders correctly in Puppeteer (no missing styles or broken layouts)
