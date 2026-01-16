# VHC Component Fixes — Brake & Tyre Issues

## Instructions
These are input component issues in the technician app. Work through each fix carefully.

---

## FIX-001: Brake Fluid — New Category Required
**Priority:** HIGH

**Problem:**
Brake Fluid is using the fluid level selector (OK, Low, Very Low, Overfilled) but needs different options.

**Required:**
- Create NEW item type/category: `brake_fluid`
- Options: **OK**, **Replacement Required**
- NOT a fluid level — it's a pass/fail style check

**Implementation:**
1. Add `brake_fluid` to item types enum/constants
2. Create `BrakeFluidSelector` component:
   - Two large buttons: "OK" (green) and "Replacement Required" (red/amber)
   - Similar styling to RAG selector but only 2 options
3. Update `Inspection.tsx` to render `BrakeFluidSelector` when `item.type === 'brake_fluid'`
4. Update default template: Change "Brake Fluid Level" to "Brake Fluid" with type `brake_fluid`

**Test:**
- [x] Template shows "Brake Fluid" not "Brake Fluid Level"
- [x] Technician sees only 2 options: OK, Replacement Required
- [ ] Selection saves correctly (requires runtime test)
- [ ] Shows correctly in advisor view (requires runtime test)

---

## FIX-002: Brake Measurement — Single Axle Only
**Priority:** HIGH

**Problem:**
The brake measurement component asks for BOTH front AND rear brakes, but it should only measure ONE axle at a time. The template has separate items for "Front Brakes" and "Rear Brakes".

**Current (Wrong):**
```
Front Brakes
├── Front Left Pad: [  ]  Front Right Pad: [  ]
├── Front Left Disc: [  ] Front Right Disc: [  ]
├── Rear Left Pad: [  ]   Rear Right Pad: [  ]  <-- Should NOT be here
└── Rear Left Disc: [  ]  Rear Right Disc: [  ] <-- Should NOT be here
```

**Required:**
```
Front Brakes
├── N/S Pad: [  ]   O/S Pad: [  ]
├── N/S Disc: [  ]  O/S Disc: [  ]
└── Disc/Drum toggle

Rear Brakes (separate template item)
├── N/S Pad: [  ]   O/S Pad: [  ]
├── N/S Disc: [  ]  O/S Disc: [  ]
└── Disc/Drum toggle
```

**Implementation:**
1. Update `BrakeMeasurementInput` component:
   - Remove the axle loop/tabs
   - Show only ONE axle: N/S and O/S columns
   - Disc/Drum toggle for this axle only
   - The item name from template determines which axle (Front/Rear)
2. Data structure should be:
   ```json
   {
     "type": "disc",
     "nearside": { "pad": 6.0, "disc": 22.0 },
     "offside": { "pad": 5.5, "disc": 22.0 }
   }
   ```

**Test:**
- [x] Open "Front Brakes" item — shows only single axle inputs (N/S + O/S)
- [x] Open "Rear Brakes" item — shows only single axle inputs (N/S + O/S)
- [x] Can toggle Disc/Drum for each
- [ ] Data saves correctly per axle (requires runtime test)
- [ ] Advisor view shows brake data correctly (requires runtime test)

---

## FIX-003: Tyre Components — Separate Details and Depth
**Priority:** HIGH

**Problem:**
The tyre component changes merged everything. Now there's no way to record tyre depth separately. Need TWO distinct components.

**Required Structure:**

### Component 1: `TyreDetailsInput` (type: `tyre_details`)
For recording tyre specifications — used ONCE per vehicle.

```
TYRE DETAILS
┌─────────────────────────────────────────────────────────────────┐
│  FRONT LEFT                         FRONT RIGHT                │
│  Manufacturer: [Dropdown ▼]         Manufacturer: [Dropdown ▼] │
│  Size:         [Dropdown ▼]         Size:         [Dropdown ▼] │
│  Speed Rating: [  ]                 Speed Rating: [  ]         │
│  Load Rating:  [  ]                 Load Rating:  [  ]         │
│                                                                │
│  REAR LEFT                          REAR RIGHT                 │
│  Manufacturer: [Dropdown ▼]         Manufacturer: [Dropdown ▼] │
│  Size:         [Dropdown ▼]         Size:         [Dropdown ▼] │
│  Speed Rating: [  ]                 Speed Rating: [  ]         │
│  Load Rating:  [  ]                 Load Rating:  [  ]         │
│                                                                │
│  [Copy First Tyre to All]                                      │
└─────────────────────────────────────────────────────────────────┘
```

Data structure:
```json
{
  "front_left": { "manufacturer": "Michelin", "size": "205/55R16", "speed": "V", "load": "91" },
  "front_right": { "manufacturer": "Michelin", "size": "205/55R16", "speed": "V", "load": "91" },
  "rear_left": { "manufacturer": "Michelin", "size": "205/55R16", "speed": "V", "load": "91" },
  "rear_right": { "manufacturer": "Michelin", "size": "205/55R16", "speed": "V", "load": "91" }
}
```

### Component 2: `TyreDepthInput` (type: `tyre_depth`)
For recording tread depth — used FOUR times (one per tyre position).

```
FRONT LEFT TYRE - TREAD DEPTH
┌─────────────────────────────────────────────────────────────────┐
│  Outer:  [====|========] 4.5mm                                 │
│  Middle: [=====|=======] 5.0mm                                 │
│  Inner:  [===|=========] 4.2mm                                 │
│                                                                │
│  Damage: [None ▼]                                              │
│          Options: None, Cut, Bulge, Cracking, Sidewall, Other  │
│                                                                │
│  Auto-calculated RAG based on lowest reading                   │
└─────────────────────────────────────────────────────────────────┘
```

Data structure:
```json
{
  "outer": 4.5,
  "middle": 5.0,
  "inner": 4.2,
  "damage": "none"
}
```

**Implementation Steps:**

1. **Rename existing component:**
   - Current mixed component → rename to `TyreDetailsInput`
   - Set type to `tyre_details`
   - Remove any tread depth inputs from it
   - Keep: manufacturer, size, speed rating, load rating for all 4 tyres
   - Keep: "Copy to All" functionality

2. **Create/restore TyreDepthInput:**
   - Type: `tyre_depth`
   - 3 sliders: Outer, Middle, Inner (0-10mm range)
   - Color gradient on sliders (red < 2mm, amber < 4mm, green >= 4mm)
   - Damage dropdown: None, Cut, Bulge, Cracking, Sidewall Damage, Other
   - Auto-calculate RAG from lowest of the 3 readings
   - This component is for ONE tyre only

3. **Update Inspection.tsx:**
   ```typescript
   case 'tyre_details':
     return <TyreDetailsInput ... />;
   case 'tyre_depth':
     return <TyreDepthInput ... />;
   ```

4. **Update Default Template:**
   
   In "Tyres" section:
   ```
   - Tyre Details (type: tyre_details) — NEW, one item for all 4 tyres
   - Front Left Tyre (type: tyre_depth) — tread depth only
   - Front Right Tyre (type: tyre_depth) — tread depth only
   - Rear Left Tyre (type: tyre_depth) — tread depth only
   - Rear Right Tyre (type: tyre_depth) — tread depth only
   ```

5. **Create Migration:**
   - Update existing template items to use correct types
   - Add "Tyre Details" item if missing

**Test:**
- [x] Template has "Tyre Details" item (type: tyre_details)
- [x] Template has 4 tyre items for depth (type: tyre_depth)
- [x] Opening "Tyre Details" shows all 4 tyres with manufacturer/size dropdowns
- [x] "Copy to All" works for tyre details
- [x] Opening "Front Left Tyre" shows 3 depth sliders + damage dropdown
- [x] Depth sliders have color gradient
- [x] RAG auto-calculates from lowest reading
- [ ] All data saves correctly (requires runtime test)
- [ ] Advisor view shows tyre details and depths correctly (requires runtime test)

---

## Execution Order

1. FIX-002: Brake Measurement (simpler fix)
2. FIX-001: Brake Fluid (new component)
3. FIX-003: Tyre Components (larger change)

---

## Prompt

```bash
claude -p "Read docs/vhc-component-fixes.md. Fix issues in order: FIX-002 (Brake Measurement single axle), FIX-001 (Brake Fluid new category), FIX-003 (Tyre Details and Tyre Depth separation). Test each fix. Check off when done." --dangerously-skip-permissions
```
