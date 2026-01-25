# Work Authority Sheet - Feature Specification

## Overview

The Work Authority Sheet is a PDF document generated from the VHC system that consolidates all authorized repair work and pre-booked DMS jobs into a single, actionable document. This serves as the definitive work instruction for technicians and a pricing reference for service advisors to facilitate accurate invoicing.

---

## Document Variants

### 1. Technician Version
A pricing-free work instruction sheet focusing purely on what work needs to be performed.

### 2. Service Advisor Version
A comprehensive pricing breakdown used for customer communication and invoice preparation.

---

## Data Sources

### Primary Sources
| Source | Description |
|--------|-------------|
| **VHC Authorized Items** | Repair items from the Vehicle Health Check with outcome status "Authorised" |
| **DMS Pre-Booked Work** | Jobs scheduled through the Dealer Management System prior to vehicle arrival |

### Data Relationships
```
Work Authority Sheet
├── Vehicle Information (from VHC/DMS)
├── Customer Information (from VHC/DMS)
├── Pre-Booked Work (DMS)
│   ├── Labour Lines
│   └── Parts Lines
└── Authorized VHC Work
    ├── Repair Groups (if grouped)
    │   ├── Labour Lines
    │   └── Parts Lines
    └── Individual Repair Items
        ├── Labour Lines
        └── Parts Lines
```

---

## Document Structure

### Header Section (Both Versions)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WORK AUTHORITY SHEET                         │
│                    [Technician / Service Advisor]                   │
├─────────────────────────────────────────────────────────────────────┤
│ Workshop: [Workshop Name]              Document No: WA-[YYYYMMDD]-[SEQ]
│ Date: [Generation Date]                Time: [Generation Time]      │
├─────────────────────────────────────────────────────────────────────┤
│ VEHICLE DETAILS                                                     │
│ Registration: [VRM]          VIN: [VIN Number]                     │
│ Make/Model: [Make] [Model]   Year: [Year]                          │
│ Mileage In: [Odometer]       Fuel Level: [Level]                   │
├─────────────────────────────────────────────────────────────────────┤
│ CUSTOMER DETAILS                                                    │
│ Name: [Customer Name]                                               │
│ Contact: [Phone]             Email: [Email]                        │
│ Address: [Address Line 1, Line 2, Postcode]                        │
├─────────────────────────────────────────────────────────────────────┤
│ SERVICE ADVISOR: [Name]      TECHNICIAN: [Assigned Tech]           │
│ VHC Reference: [VHC-ID]      Job Card No: [DMS Job Number]         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Section 1: Pre-Booked Work (DMS)

Work that was scheduled before the vehicle arrived, imported from the DMS.

### Technician Version

```
┌─────────────────────────────────────────────────────────────────────┐
│ PRE-BOOKED WORK                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ □ Full Service - 20,000 Mile                                        │
│   Labour: 1.5 hrs                                                   │
│   Parts:                                                            │
│   • Oil Filter (OF-12345) x1                                       │
│   • Air Filter (AF-67890) x1                                       │
│   • Sump Plug Washer (SPW-111) x1                                  │
│   • Engine Oil 5W-30 (EO-5W30-5L) x5 litres                        │
│                                                                     │
│ □ Brake Fluid Change                                                │
│   Labour: 0.5 hrs                                                   │
│   Parts:                                                            │
│   • Brake Fluid DOT 4 (BF-DOT4-1L) x1 litre                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Service Advisor Version

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ PRE-BOOKED WORK                                                                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Full Service - 20,000 Mile                                                       │
│ ┌──────────────────────────────────────────────────────────────────────────────┐ │
│ │ LABOUR                                                                       │ │
│ │ Description              Labour Code    Hrs    Rate      Total               │ │
│ │ Full Service             SVC-20K        1.5    £85.00    £127.50             │ │
│ ├──────────────────────────────────────────────────────────────────────────────┤ │
│ │ PARTS                                                                        │ │
│ │ Description              Part No.       Qty    Unit      Total               │ │
│ │ Oil Filter               OF-12345       1      £8.50     £8.50               │ │
│ │ Air Filter               AF-67890       1      £15.00    £15.00              │ │
│ │ Sump Plug Washer         SPW-111        1      £0.85     £0.85               │ │
│ │ Engine Oil 5W-30 (L)     EO-5W30-5L     5      £12.00    £60.00              │ │
│ ├──────────────────────────────────────────────────────────────────────────────┤ │
│ │ SUBTOTAL: Labour £127.50 | Parts £84.35 | Total £211.85                      │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│ Brake Fluid Change                                                               │
│ ┌──────────────────────────────────────────────────────────────────────────────┐ │
│ │ LABOUR                                                                       │ │
│ │ Description              Labour Code    Hrs    Rate      Total               │ │
│ │ Brake Fluid Change       BRK-FLUID      0.5    £85.00    £42.50              │ │
│ ├──────────────────────────────────────────────────────────────────────────────┤ │
│ │ PARTS                                                                        │ │
│ │ Description              Part No.       Qty    Unit      Total               │ │
│ │ Brake Fluid DOT 4 (L)    BF-DOT4-1L     1      £9.50     £9.50               │ │
│ ├──────────────────────────────────────────────────────────────────────────────┤ │
│ │ SUBTOTAL: Labour £42.50 | Parts £9.50 | Total £52.00                         │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Section 2: Authorized VHC Work

Work identified during the Vehicle Health Check that has been authorized by the customer.

### Technician Version

```
┌─────────────────────────────────────────────────────────────────────┐
│ AUTHORIZED VHC WORK                                                 │
├─────────────────────────────────────────────────────────────────────┤
│ □ Front Brake Pads & Discs [AMBER - Advisory]                       │
│   Defect: Front brake pads worn to 2mm, discs showing scoring       │
│   Labour: 1.2 hrs                                                   │
│   Parts:                                                            │
│   • Front Brake Pad Set (FBP-VW-001) x1                            │
│   • Front Brake Disc (FBD-VW-001) x2                               │
│                                                                     │
│ □ Wiper Blades [AMBER - Advisory]                                   │
│   Defect: Front wiper blades perished, causing smearing             │
│   Labour: 0.2 hrs                                                   │
│   Parts:                                                            │
│   • Front Wiper Blade Set (WB-BOSCH-24) x1                         │
│                                                                     │
│ □ Tyre Replacement - Rear Nearside [RED - Urgent]                   │
│   Defect: Tyre tread depth 1.2mm, below legal limit                │
│   Labour: 0.3 hrs                                                   │
│   Parts:                                                            │
│   • Tyre 205/55R16 Michelin Primacy (TYR-MICH-P4) x1               │
└─────────────────────────────────────────────────────────────────────┘
```

### Service Advisor Version

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ AUTHORIZED VHC WORK                                                              │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ● Front Brake Pads & Discs                                    [AMBER - Advisory] │
│   Defect: Front brake pads worn to 2mm, discs showing scoring                    │
│ ┌──────────────────────────────────────────────────────────────────────────────┐ │
│ │ LABOUR                                                                       │ │
│ │ Description              Labour Code    Hrs    Rate      Total               │ │
│ │ R&R Front Brake P&D      BRK-FRT-PD     1.2    £85.00    £102.00             │ │
│ ├──────────────────────────────────────────────────────────────────────────────┤ │
│ │ PARTS                                                                        │ │
│ │ Description              Part No.       Qty    Unit      Total               │ │
│ │ Front Brake Pad Set      FBP-VW-001     1      £45.00    £45.00              │ │
│ │ Front Brake Disc         FBD-VW-001     2      £65.00    £130.00             │ │
│ ├──────────────────────────────────────────────────────────────────────────────┤ │
│ │ SUBTOTAL: Labour £102.00 | Parts £175.00 | Total £277.00                     │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│ ● Wiper Blades                                                [AMBER - Advisory] │
│   Defect: Front wiper blades perished, causing smearing                          │
│ ┌──────────────────────────────────────────────────────────────────────────────┐ │
│ │ LABOUR                                                                       │ │
│ │ Description              Labour Code    Hrs    Rate      Total               │ │
│ │ Fit Wiper Blades         WIP-FIT        0.2    £85.00    £17.00              │ │
│ ├──────────────────────────────────────────────────────────────────────────────┤ │
│ │ PARTS                                                                        │ │
│ │ Description              Part No.       Qty    Unit      Total               │ │
│ │ Front Wiper Blade Set    WB-BOSCH-24    1      £28.00    £28.00              │ │
│ ├──────────────────────────────────────────────────────────────────────────────┤ │
│ │ SUBTOTAL: Labour £17.00 | Parts £28.00 | Total £45.00                        │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│ ● Tyre Replacement - Rear Nearside                                [RED - Urgent] │
│   Defect: Tyre tread depth 1.2mm, below legal limit                              │
│ ┌──────────────────────────────────────────────────────────────────────────────┐ │
│ │ LABOUR                                                                       │ │
│ │ Description              Labour Code    Hrs    Rate      Total               │ │
│ │ Tyre Fitting & Balance   TYR-FIT        0.3    £85.00    £25.50              │ │
│ ├──────────────────────────────────────────────────────────────────────────────┤ │
│ │ PARTS                                                                        │ │
│ │ Description              Part No.       Qty    Unit      Total               │ │
│ │ Tyre 205/55R16 Michelin  TYR-MICH-P4    1      £95.00    £95.00              │ │
│ ├──────────────────────────────────────────────────────────────────────────────┤ │
│ │ SUBTOTAL: Labour £25.50 | Parts £95.00 | Total £120.50                       │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Section 3: Summary & Totals

### Technician Version

```
┌─────────────────────────────────────────────────────────────────────┐
│ WORK SUMMARY                                                        │
├─────────────────────────────────────────────────────────────────────┤
│ Total Labour Hours: 3.7 hrs                                         │
│ Total Parts Lines: 10 items                                         │
│                                                                     │
│ Estimated Time: 4.0 hrs (inc. allowances)                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Service Advisor Version

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ PRICING SUMMARY                                                                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PRE-BOOKED WORK                                                                 │
│  ├─ Labour:                               £170.00                                │
│  └─ Parts:                                £93.85                                 │
│     Subtotal:                             £263.85                                │
│                                                                                  │
│  AUTHORIZED VHC WORK                                                             │
│  ├─ Labour:                               £144.50                                │
│  └─ Parts:                                £298.00                                │
│     Subtotal:                             £442.50                                │
│                                                                                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  GRAND TOTALS                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  Total Labour:        3.7 hrs              £314.50                         │  │
│  │  Total Parts:         10 lines             £391.85                         │  │
│  │  ─────────────────────────────────────────────────────                     │  │
│  │  Subtotal (ex VAT):                        £706.35                         │  │
│  │  VAT @ 20%:                                £141.27                         │  │
│  │  ═══════════════════════════════════════════════════                       │  │
│  │  TOTAL (inc VAT):                          £847.62                         │  │
│  └────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Section 4: Authorization & Signatures

### Technician Version

```
┌─────────────────────────────────────────────────────────────────────┐
│ COMPLETION SIGN-OFF                                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Technician Signature: _______________________  Date: ____________   │
│                                                                     │
│ Time Started: __________    Time Completed: __________              │
│                                                                     │
│ Quality Check By: ________________________     Date: ____________   │
│                                                                     │
│ Notes:                                                              │
│ ________________________________________________________________   │
│ ________________________________________________________________   │
│ ________________________________________________________________   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Service Advisor Version

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ AUTHORIZATION RECORD                                                             │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│ Customer Authorization                                                           │
│ ┌────────────────────────────────────────────────────────────────────────────┐   │
│ │ Authorized By: [Customer Name / Contact Method]                            │   │
│ │ Authorization Date: [Date]        Time: [Time]                             │   │
│ │ Method: □ In Person  □ Telephone  □ Email  □ SMS  □ Portal                 │   │
│ │ Reference: [Authorization Reference if applicable]                         │   │
│ └────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│ Internal Sign-Off                                                                │
│ ┌────────────────────────────────────────────────────────────────────────────┐   │
│ │ Service Advisor: ______________________ Signature: _______________         │   │
│ │ Date: ____________                                                         │   │
│ │                                                                            │   │
│ │ Workshop Controller: __________________ Signature: _______________         │   │
│ │ Date: ____________                                                         │   │
│ └────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│ Invoice Reference: _______________  (To be completed post-work)                  │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Model Requirements

### Required Database Queries

```typescript
interface WorkAuthorityData {
  // Document metadata
  documentNumber: string;          // WA-YYYYMMDD-SEQ
  generatedAt: Date;
  generatedBy: string;             // User who generated the document
  variant: 'technician' | 'service_advisor';
  
  // Vehicle & Customer
  vehicle: {
    vrm: string;
    vin: string;
    make: string;
    model: string;
    year: number;
    mileageIn: number;
    fuelLevel?: string;
  };
  
  customer: {
    name: string;
    phone?: string;
    email?: string;
    address?: {
      line1: string;
      line2?: string;
      postcode: string;
    };
  };
  
  // Staff assignments
  serviceAdvisor: string;
  assignedTechnician?: string;
  
  // References
  vhcReference: string;
  dmsJobNumber?: string;
  
  // Work items
  preBookedWork: WorkSection[];
  authorizedVhcWork: WorkSection[];
  
  // Totals (Service Advisor only)
  totals?: PricingSummary;
}

interface WorkSection {
  id: string;
  title: string;
  description?: string;           // Defect description for VHC items
  severity?: 'RED' | 'AMBER' | 'GREEN';  // VHC severity
  labourLines: LabourLine[];
  partsLines: PartsLine[];
  subtotals?: SectionSubtotals;   // Service Advisor only
}

interface LabourLine {
  description: string;
  labourCode: string;
  hours: number;
  rate?: number;                  // Service Advisor only
  total?: number;                 // Service Advisor only
}

interface PartsLine {
  description: string;
  partNumber: string;
  quantity: number;
  unit?: string;                  // 'each', 'litre', 'set', etc.
  unitPrice?: number;             // Service Advisor only
  total?: number;                 // Service Advisor only
}

interface SectionSubtotals {
  labourTotal: number;
  partsTotal: number;
  sectionTotal: number;
}

interface PricingSummary {
  preBooked: {
    labour: number;
    parts: number;
    subtotal: number;
  };
  vhcWork: {
    labour: number;
    parts: number;
    subtotal: number;
  };
  totalLabourHours: number;
  totalLabourValue: number;
  totalPartsLines: number;
  totalPartsValue: number;
  subtotalExVat: number;
  vatAmount: number;
  vatRate: number;
  grandTotal: number;
}
```

---

## API Endpoints

### Generate Work Authority Sheet

```
POST /api/vhc/{vhcId}/work-authority-sheet
```

**Request Body:**
```json
{
  "variant": "technician" | "service_advisor",
  "includePreBooked": true,
  "includeVhcWork": true,
  "filterOutcomes": ["Authorised"],  // Default: only authorized items
  "assignedTechnician": "tech-uuid"   // Optional: filter or assign
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "documentNumber": "WA-20250122-001",
    "pdfUrl": "/api/documents/wa-20250122-001.pdf",
    "expiresAt": "2025-01-22T23:59:59Z"
  }
}
```

### Retrieve Existing Work Authority Sheet

```
GET /api/documents/work-authority/{documentNumber}
```

---

## PDF Generation Considerations

### Layout Specifications

| Property | Value |
|----------|-------|
| Page Size | A4 Portrait |
| Margins | 15mm all sides |
| Header Height | 25mm |
| Footer Height | 15mm |
| Font - Headers | Helvetica Bold, 12pt |
| Font - Body | Helvetica, 10pt |
| Font - Tables | Helvetica, 9pt |
| Line Spacing | 1.2 |

### Colour Coding (VHC Severity)

| Severity | Background | Border | Text |
|----------|------------|--------|------|
| RED | #FEE2E2 | #DC2626 | #991B1B |
| AMBER | #FEF3C7 | #D97706 | #92400E |
| GREEN | #D1FAE5 | #059669 | #065F46 |

### Page Break Rules

1. Never break within a work item (labour + parts must stay together)
2. Section headers should not appear alone at bottom of page
3. Summary section should ideally fit on final page
4. Signature block must be on final page

---

## Implementation Phases

### Phase 1: Data Layer
- [ ] Create SQL queries to fetch authorized VHC items with labour/parts
- [ ] Create SQL queries to fetch pre-booked DMS work
- [ ] Implement data transformation to WorkAuthorityData interface
- [ ] Add document number generation (sequential per day)

### Phase 2: PDF Generation
- [ ] Set up PDF generation library (recommend: @react-pdf/renderer or PDFKit)
- [ ] Create base document template with header/footer
- [ ] Implement technician variant layout
- [ ] Implement service advisor variant layout
- [ ] Add severity colour coding
- [ ] Implement page break logic

### Phase 3: API Integration
- [ ] Create generation endpoint
- [ ] Implement document storage (temp or permanent)
- [ ] Add retrieval endpoint
- [ ] Implement access control (technician vs advisor permissions)

### Phase 4: UI Integration
- [ ] Add "Generate Work Authority" button to VHC detail view
- [ ] Implement variant selection modal
- [ ] Add PDF preview/download functionality
- [ ] Add to technician mobile interface

### Phase 5: DMS Integration
- [ ] Map DMS job structure to WorkSection format
- [ ] Handle labour code translation
- [ ] Handle parts data synchronization
- [ ] Implement error handling for missing DMS data

---

## Edge Cases & Validation

### Scenarios to Handle

1. **No pre-booked work**: Display section with "No pre-booked work for this visit"
2. **No authorized VHC items**: Display section with "No additional work authorized"
3. **Missing pricing data**: Service Advisor variant should error; Technician variant proceeds
4. **Partial parts data**: Show available info, flag missing part numbers
5. **Labour-only items**: Valid scenario (e.g., diagnostic time)
6. **Parts-only items**: Valid scenario (e.g., customer-supplied parts fitted)
7. **Grouped repairs**: Maintain group structure in output
8. **Multiple technicians**: Support technician assignment per work section

### Validation Rules

```typescript
const validationRules = {
  // Document must have at least one work item
  hasWorkItems: (data: WorkAuthorityData) => 
    data.preBookedWork.length > 0 || data.authorizedVhcWork.length > 0,
  
  // Service Advisor variant requires pricing
  hasPricing: (data: WorkAuthorityData, variant: string) => 
    variant !== 'service_advisor' || data.totals !== undefined,
  
  // All labour lines must have hours
  labourHasHours: (lines: LabourLine[]) => 
    lines.every(l => l.hours > 0),
  
  // All parts must have quantity
  partsHasQuantity: (lines: PartsLine[]) => 
    lines.every(p => p.quantity > 0),
};
```

---

## Security & Permissions

### Access Control Matrix

| Action | Technician | Service Advisor | Admin |
|--------|------------|-----------------|-------|
| Generate Technician Version | ✓ | ✓ | ✓ |
| Generate Service Advisor Version | ✗ | ✓ | ✓ |
| View Technician Version | ✓ | ✓ | ✓ |
| View Service Advisor Version | ✗ | ✓ | ✓ |
| Regenerate Document | ✗ | ✓ | ✓ |

### Audit Trail

Each generation should log:
- Document number
- Generated by (user ID)
- Generation timestamp
- Variant type
- VHC reference
- Items included (count)

---

## Future Enhancements

1. **Digital signatures**: E-signature capture for customer authorization
2. **Email delivery**: Send PDF directly to customer
3. **QR code**: Link back to VHC portal for live updates
4. **Multi-language**: Support for translated documents
5. **Customizable templates**: Per-workshop branding and layout
6. **Parts availability**: Integration with stock levels
7. **Labour scheduling**: Estimated completion time based on booked hours
8. **Cost comparison**: Show original vs discounted pricing

---

## Related Documents

- [VHC Repair Items & Pricing Specification](./repair-items-pricing-spec.md)
- [Outcome Tracking Implementation](./outcome-tracking-spec.md)
- [DMS Integration Guide](./dms-integration-spec.md)
- [PDF Generation Skills](/mnt/skills/public/pdf/SKILL.md)
