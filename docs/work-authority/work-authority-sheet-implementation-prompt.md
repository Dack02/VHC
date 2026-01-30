# Work Authority Sheet - Implementation Prompt

## Overview

Implement the Work Authority Sheet PDF generation feature. This document consolidates authorised VHC repairs and pre-booked DMS work into a printable PDF for service advisors.

**Reference the HTML mockup at `docs/mockups/work-authority-sheet-mockup.html` for the exact visual design to follow.**

## Document Variants

### Service Advisor Version (implement first)
Full pricing breakdown with labour rates, parts pricing, and VAT. Used for invoice preparation.

### Technician Version (implement second)
Same layout but with all pricing columns removed. Shows only:
- Description
- Code / Part No.
- Qty/Hrs

No Rate, No Total, No pricing summary. Just the work items and quantities.

## Layout Structure (from mockup)

### Header
- Dark navy bar with "WORK AUTHORITY SHEET" title
- Document number (WA-YYYYMMDD-SEQ), date, time on right

### Info Grid (two columns)
- **Left box - Vehicle:** Reg, Make/Model, Year, Mileage, VIN
- **Right box - Customer:** Name, Contact, Email

### Reference Bar
Single row: Workshop | Service Advisor | Technician | VHC Ref

### Authorised Work Table
Single unified table with columns:
- Description (40%)
- Code / Part No. (15%)
- Qty/Hrs (10%)
- Rate (15%) - Service Advisor only
- Total (10%) - Service Advisor only

**Row types:**
1. **Item header row** - Grey background, repair title + severity badge on right
2. **Labour/Part rows** - Fixed-width label (LABOUR/PART) followed by description
3. **Subtotal row** - Right-aligned subtotal for each item
4. **Child items** (for grouped repairs) - Indented with └ prefix, muted text

**Severity badges:**
- RED - URGENT: Red background (#fee2e2), red text (#dc2626)
- AMBER - ADVISORY: Amber background (#fef3c7), amber text (#d97706)
- GREEN - OK: Green background (#d1fae5), green text (#059669)

### Totals Section (Service Advisor only)
Compact table:
- Pre-Booked Work: £X.XX
- Authorised VHC Work (X.X hrs labour, X parts): £X.XX
- Subtotal (ex VAT): £X.XX
- VAT @ 20%: £X.XX
- **TOTAL (inc VAT): £X.XX** (dark background, white text)

## Key Design Decisions

1. **No sign-off sections** - Remove all signature/authorisation record areas
2. **UK spelling** - "Authorised" not "Authorized"
3. **Fixed-width labels** - LABOUR and PART labels are fixed width (45px) so descriptions align
4. **Compact totals** - Single column layout, not two-column grid
5. **Items with £0.00** - Only show items that have labour or parts with actual values
6. **Grouped items** - Show parent with its labour/parts, then list child item names indented below

## Data Requirements

### Fetch from VHC
```typescript
interface WorkAuthorityData {
  documentNumber: string;           // WA-YYYYMMDD-SEQ
  generatedAt: Date;
  variant: 'technician' | 'service_advisor';
  
  workshop: { name: string };
  
  vehicle: {
    vrm: string;
    vin: string | null;
    make: string;
    model: string;
    year: number;
    mileageIn: number;
  };
  
  customer: {
    name: string;
    phone: string | null;
    email: string | null;
  };
  
  serviceAdvisor: string;
  assignedTechnician: string | null;
  vhcReference: string;
  
  preBookedWork: WorkItem[];
  authorisedVhcWork: WorkItem[];
  
  totals: {
    preBookedTotal: number;
    vhcLabourHours: number;
    vhcPartsCount: number;
    vhcTotal: number;
    subtotalExVat: number;
    vatRate: number;
    vatAmount: number;
    grandTotal: number;
  };
}

interface WorkItem {
  id: string;
  title: string;
  severity: 'RED' | 'AMBER' | 'GREEN' | null;
  labourLines: {
    description: string;
    code: string;
    hours: number;
    rate: number;      // ex VAT
    total: number;     // ex VAT
  }[];
  partsLines: {
    description: string;
    partNumber: string;
    quantity: number;
    unitPrice: number; // ex VAT
    total: number;     // ex VAT
  }[];
  subtotal: number;
  childItems?: {       // For grouped repairs
    title: string;
    severity: 'RED' | 'AMBER' | 'GREEN';
  }[];
}
```

## Implementation Steps

### Phase 1: Explore Existing Patterns
Before writing code, examine:
- Current PDF generation approach in the codebase
- How VHC repair items are fetched with labour/parts
- Repair group parent-child relationships
- Existing service layer patterns

Report back what you find.

### Phase 2: Data Layer
1. Create TypeScript interfaces (as above)
2. Write SQL to fetch authorised VHC items with labour and parts
3. Write SQL to fetch pre-booked DMS work
4. Implement document number generation (WA-YYYYMMDD-SEQ, sequential per tenant per day)

### Phase 3: PDF Generation
1. Create HTML template matching the mockup exactly
2. Use existing PDF generation library (likely Puppeteer)
3. Implement Service Advisor variant first
4. Then create Technician variant (same template, pricing columns hidden)

### Phase 4: API Endpoint
```
POST /api/vhc/:vhcId/work-authority-sheet
Body: { variant: 'technician' | 'service_advisor' }
Returns: PDF file or URL
```

### Phase 5: UI Integration
Add "Generate Work Authority Sheet" button to VHC detail view with variant selection.

## Validation Rules

- Must have at least one work item (authorised VHC or pre-booked)
- Skip items with no labour AND no parts (£0.00 items)
- All prices are ex VAT in the line items, VAT applied at the end
- Technicians cannot access service_advisor variant

## Files to Reference

- HTML Mockup: `docs/mockups/work-authority-sheet-mockup.html`
- Existing PDF generation patterns in the codebase
- VHC repair item queries

---

Start with Phase 1 - explore the codebase and report back before implementing.
