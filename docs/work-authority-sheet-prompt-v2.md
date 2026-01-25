# Work Authority Sheet - Implementation Prompt

## Overview

Implement the Work Authority Sheet PDF generation feature as defined in `docs/specs/work-authority-sheet-spec.md`.

Read that specification fully before starting - it contains the complete document structure, data models, layout specifications, and visual mockups for both variants.

## Quick Summary

The Work Authority Sheet consolidates authorized VHC repairs and pre-booked DMS work into a printable PDF:

1. **Technician Version**: Work instructions only - no pricing. Shows labour hours, part numbers, quantities, descriptions, and checkboxes for completion tracking.

2. **Service Advisor Version**: Full pricing breakdown - labour rates, parts pricing, section subtotals, VAT, and grand totals. Used for invoice preparation.

## Implementation Order

### Phase 1: Explore Existing Patterns

Before writing any code, examine:
- Current PDF generation approach (library, patterns, templates)
- How VHC repair items are fetched with labour/parts relationships
- Repair group parent-child query patterns
- Existing service layer structure
- API route conventions

Report back what you find so we can confirm the approach.

### Phase 2: Database & Types

1. Create TypeScript interfaces as defined in the spec
2. Write SQL queries/functions to:
   - Fetch authorized VHC items with labour and parts
   - Fetch pre-booked DMS work
   - Generate sequential document numbers (`WA-YYYYMMDD-SEQ`)

### Phase 3: Service Layer

Create `WorkAuthoritySheetService` with:
- `getWorkAuthorityData()` - Fetch and transform all document data
- `generatePdf()` - Generate the PDF buffer
- `generateDocumentNumber()` - Create unique document reference
- `calculateTotals()` - Compute pricing summary (service advisor only)

### Phase 4: PDF Templates

Create two PDF templates following existing patterns:
- Technician template (no pricing)
- Service Advisor template (full pricing)

Follow the layout specifications in the spec for:
- Header section
- Pre-booked work section
- Authorized VHC work section
- Summary section
- Signature/authorization section
- Severity colour coding (RED/AMBER/GREEN)
- Page break rules

### Phase 5: API & UI

1. Create endpoint: `POST /api/vhc/:vhcId/work-authority-sheet`
2. Add permission checks (technicians can't access pricing variant)
3. Add "Generate Work Authority Sheet" button to VHC detail view
4. Implement variant selection modal

## Key Validation Rules

- Must have at least one work item (authorized VHC or pre-booked)
- Service Advisor variant requires complete pricing data
- All labour lines need hours > 0
- All parts lines need quantity > 0
- Respect role-based access (technicians = no pricing)

## Testing Scenarios

- [ ] Technician variant with VHC work only
- [ ] Technician variant with pre-booked only
- [ ] Technician variant with both
- [ ] Service Advisor variant with full pricing
- [ ] Verify VAT calculations
- [ ] Test page breaks with many items
- [ ] Test grouped repair items maintain structure
- [ ] Test permission restrictions
- [ ] Test document number sequencing

## Reference Files

Spec document: `docs/specs/work-authority-sheet-spec.md`

---

```bash
claude-code --dangerously-skip-permissions
```

Start with Phase 1 - explore and report back before implementing.
