# Repair Groups & Pricing System
## Comprehensive Feature Specification

---

## 1. OVERVIEW

### 1.1 Purpose
Enable service advisors to create repair groups from health check findings, add labour and parts with proper pricing, and offer customers alternative repair options.

### 1.2 Core Concepts

```
HEALTH CHECK
│
├── Check Results (from technician inspection)
│   ├── Front Brake Pads [Amber]
│   ├── Front Brake Discs [Amber]  
│   ├── Front Brake Caliper [Green] ← Can include for upsell
│   └── Drive Belt [Red]
│
└── Repair Items (created by advisor from check results)
    │
    ├── REPAIR GROUP: "Front Brake Overhaul"
    │   ├── Linked check results: Pads, Discs, Caliper
    │   ├── Labour: 1.5 hrs @ £85/hr
    │   ├── Parts: Pads, Discs, Caliper
    │   ├── Options: Standard £320, Premium £420
    │   └── Total: £320 + VAT
    │
    └── INDIVIDUAL REPAIR: "Drive Belt Replacement"
        ├── Linked check result: Drive Belt
        ├── Labour: 0.5 hrs @ £85/hr
        ├── Parts: Belt
        └── Total: £89 + VAT
```

### 1.3 Key Features

- **Repair Groups** — Bundle related check result items into one repair
- **Individual Repairs** — Single item repairs
- **Labour Tab** — Add labour time with labour codes and rates
- **Parts Tab** — Add parts with cost/sell prices and margin calculator
- **Repair Options** — Offer alternatives (e.g., Standard vs Premium tyres)
- **Workflow Badges** — Track Labour/Parts/Quote/Sent status
- **VAT Handling** — Ex-VAT with Inc-VAT display, no VAT on MOT labour
- **Customer Approval** — All-or-nothing for groups

---

## 2. DATA MODEL

### 2.1 New Tables

```sql
-- Labour codes (per organization)
CREATE TABLE labour_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  code VARCHAR(20) NOT NULL,           -- 'LAB', 'DIAG', 'MOT'
  description VARCHAR(255) NOT NULL,   -- 'Standard Labour', 'Diagnostic', 'MOT Labour'
  hourly_rate DECIMAL(10,2) NOT NULL,  -- £85.00
  is_vat_exempt BOOLEAN DEFAULT false, -- true for MOT
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,    -- Default selection
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, code)
);

-- Seed default labour codes (triggered on org creation)
-- LAB - Standard Labour - £85.00 - VAT applicable - is_default
-- DIAG - Diagnostic - £95.00 - VAT applicable
-- MOT - MOT Labour - £45.00 - VAT EXEMPT

-- Suppliers (per organization)
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,          -- 'GSF Car Parts'
  code VARCHAR(50),                    -- 'GSF' (optional short code)
  account_number VARCHAR(100),         -- Account reference (optional)
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  address TEXT,
  notes TEXT,
  
  is_active BOOLEAN DEFAULT true,
  is_quick_add BOOLEAN DEFAULT false,  -- true if added via quick-add (minimal data)
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, name)
);

-- Organization pricing settings
ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS default_margin_percent DECIMAL(5,2) DEFAULT 40.00;
ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 20.00;

-- Repair items (groups or individual)
CREATE TABLE repair_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  health_check_id UUID NOT NULL REFERENCES health_checks(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Repair details
  name VARCHAR(255) NOT NULL,          -- 'Front Brake Overhaul', 'Drive Belt Replacement'
  description TEXT,
  is_group BOOLEAN DEFAULT false,      -- true = group, false = individual
  
  -- Pricing (calculated or overridden)
  labour_total DECIMAL(10,2) DEFAULT 0,
  parts_total DECIMAL(10,2) DEFAULT 0,
  subtotal DECIMAL(10,2) DEFAULT 0,    -- labour + parts (ex VAT)
  vat_amount DECIMAL(10,2) DEFAULT 0,
  total_inc_vat DECIMAL(10,2) DEFAULT 0,
  
  -- Price override
  price_override DECIMAL(10,2),        -- If advisor manually sets price
  price_override_reason TEXT,
  
  -- Status tracking
  labour_status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'in_progress', 'complete'
  parts_status VARCHAR(20) DEFAULT 'pending',   -- 'pending', 'in_progress', 'complete'
  quote_status VARCHAR(20) DEFAULT 'pending',   -- 'pending', 'ready'
  
  -- Customer response
  customer_approved BOOLEAN,           -- null = not responded, true/false = decision
  customer_approved_at TIMESTAMPTZ,
  customer_declined_reason TEXT,
  
  -- Selected repair option (if options exist)
  selected_option_id UUID,             -- References repair_options.id
  
  -- Audit
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  labour_completed_by UUID REFERENCES users(id),
  labour_completed_at TIMESTAMPTZ,
  parts_completed_by UUID REFERENCES users(id),
  parts_completed_at TIMESTAMPTZ
);

-- Link repair items to check results
CREATE TABLE repair_item_check_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repair_item_id UUID NOT NULL REFERENCES repair_items(id) ON DELETE CASCADE,
  check_result_id UUID NOT NULL REFERENCES check_results(id) ON DELETE CASCADE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(repair_item_id, check_result_id)
);

-- Repair options (alternatives like Standard vs Premium)
CREATE TABLE repair_options (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repair_item_id UUID NOT NULL REFERENCES repair_items(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,          -- 'Standard', 'Premium', 'Budget'
  description TEXT,                    -- 'OEM quality parts'
  
  -- Pricing for this option
  labour_total DECIMAL(10,2) DEFAULT 0,
  parts_total DECIMAL(10,2) DEFAULT 0,
  subtotal DECIMAL(10,2) DEFAULT 0,
  vat_amount DECIMAL(10,2) DEFAULT 0,
  total_inc_vat DECIMAL(10,2) DEFAULT 0,
  
  is_recommended BOOLEAN DEFAULT false, -- Highlight as recommended option
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Labour entries
CREATE TABLE repair_labour (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repair_item_id UUID REFERENCES repair_items(id) ON DELETE CASCADE,
  repair_option_id UUID REFERENCES repair_options(id) ON DELETE CASCADE,
  
  labour_code_id UUID NOT NULL REFERENCES labour_codes(id),
  
  hours DECIMAL(5,2) NOT NULL,         -- 1.5
  rate DECIMAL(10,2) NOT NULL,         -- £85.00 (copied from labour_code at time of entry)
  total DECIMAL(10,2) NOT NULL,        -- £127.50
  is_vat_exempt BOOLEAN DEFAULT false, -- Copied from labour_code
  
  notes TEXT,
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Must belong to either repair_item or repair_option
  CONSTRAINT check_labour_parent CHECK (
    (repair_item_id IS NOT NULL AND repair_option_id IS NULL) OR
    (repair_item_id IS NULL AND repair_option_id IS NOT NULL)
  )
);

-- Parts entries
CREATE TABLE repair_parts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repair_item_id UUID REFERENCES repair_items(id) ON DELETE CASCADE,
  repair_option_id UUID REFERENCES repair_options(id) ON DELETE CASCADE,
  
  part_number VARCHAR(100),            -- 'BRK-PAD-001'
  description VARCHAR(255) NOT NULL,   -- 'Front Brake Pads'
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  
  supplier_id UUID REFERENCES suppliers(id),
  supplier_name VARCHAR(255),          -- Denormalized for display
  
  cost_price DECIMAL(10,2) NOT NULL,   -- £25.00
  sell_price DECIMAL(10,2) NOT NULL,   -- £45.00
  line_total DECIMAL(10,2) NOT NULL,   -- qty × sell_price = £45.00
  
  margin_percent DECIMAL(5,2),         -- 44.44%
  markup_percent DECIMAL(5,2),         -- 80%
  
  notes TEXT,
  
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Must belong to either repair_item or repair_option
  CONSTRAINT check_parts_parent CHECK (
    (repair_item_id IS NOT NULL AND repair_option_id IS NULL) OR
    (repair_item_id IS NULL AND repair_option_id IS NOT NULL)
  )
);

-- Indexes
CREATE INDEX idx_labour_codes_org ON labour_codes(organization_id);
CREATE INDEX idx_suppliers_org ON suppliers(organization_id);
CREATE INDEX idx_repair_items_hc ON repair_items(health_check_id);
CREATE INDEX idx_repair_items_org ON repair_items(organization_id);
CREATE INDEX idx_repair_item_check_results_ri ON repair_item_check_results(repair_item_id);
CREATE INDEX idx_repair_item_check_results_cr ON repair_item_check_results(check_result_id);
CREATE INDEX idx_repair_options_ri ON repair_options(repair_item_id);
CREATE INDEX idx_repair_labour_ri ON repair_labour(repair_item_id);
CREATE INDEX idx_repair_labour_ro ON repair_labour(repair_option_id);
CREATE INDEX idx_repair_parts_ri ON repair_parts(repair_item_id);
CREATE INDEX idx_repair_parts_ro ON repair_parts(repair_option_id);
```

### 2.2 RLS Policies

```sql
-- Labour codes: Org members can read, admins can write
ALTER TABLE labour_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view labour codes" ON labour_codes
  FOR SELECT USING (organization_id = current_org_id());

CREATE POLICY "Admins can manage labour codes" ON labour_codes
  FOR ALL USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('org_admin', 'site_admin')
  );

-- Suppliers: Same pattern
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view suppliers" ON suppliers
  FOR SELECT USING (organization_id = current_org_id());

CREATE POLICY "Admins can manage suppliers" ON suppliers
  FOR ALL USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('org_admin', 'site_admin')
  );

-- Repair items: Org members full access
ALTER TABLE repair_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can manage repair items" ON repair_items
  FOR ALL USING (organization_id = current_org_id());

-- Similar for repair_options, repair_labour, repair_parts
-- (inherited through repair_item organization check)
```

### 2.3 Helper Functions

```sql
-- Calculate repair item totals
CREATE OR REPLACE FUNCTION calculate_repair_item_totals(p_repair_item_id UUID)
RETURNS void AS $$
DECLARE
  v_labour_total DECIMAL(10,2);
  v_labour_vat_exempt DECIMAL(10,2);
  v_parts_total DECIMAL(10,2);
  v_vat_rate DECIMAL(5,2);
  v_vat_amount DECIMAL(10,2);
  v_org_id UUID;
BEGIN
  -- Get org for VAT rate
  SELECT organization_id INTO v_org_id FROM repair_items WHERE id = p_repair_item_id;
  SELECT COALESCE(vat_rate, 20.00) INTO v_vat_rate FROM organization_settings WHERE organization_id = v_org_id;
  
  -- Sum labour (separate VAT exempt)
  SELECT 
    COALESCE(SUM(CASE WHEN NOT is_vat_exempt THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN is_vat_exempt THEN total ELSE 0 END), 0)
  INTO v_labour_total, v_labour_vat_exempt
  FROM repair_labour 
  WHERE repair_item_id = p_repair_item_id;
  
  -- Sum parts
  SELECT COALESCE(SUM(line_total), 0) INTO v_parts_total
  FROM repair_parts
  WHERE repair_item_id = p_repair_item_id;
  
  -- Calculate VAT (only on VAT-able labour + parts)
  v_vat_amount := ROUND((v_labour_total + v_parts_total) * (v_vat_rate / 100), 2);
  
  -- Update repair item
  UPDATE repair_items SET
    labour_total = v_labour_total + v_labour_vat_exempt,
    parts_total = v_parts_total,
    subtotal = v_labour_total + v_labour_vat_exempt + v_parts_total,
    vat_amount = v_vat_amount,
    total_inc_vat = v_labour_total + v_labour_vat_exempt + v_parts_total + v_vat_amount,
    updated_at = NOW()
  WHERE id = p_repair_item_id;
END;
$$ LANGUAGE plpgsql;

-- Calculate repair option totals (same logic)
CREATE OR REPLACE FUNCTION calculate_repair_option_totals(p_repair_option_id UUID)
RETURNS void AS $$
-- Similar logic for repair options
$$ LANGUAGE plpgsql;

-- Auto-recalculate on labour/parts changes
CREATE OR REPLACE FUNCTION trigger_recalculate_repair_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.repair_item_id IS NOT NULL THEN
    PERFORM calculate_repair_item_totals(NEW.repair_item_id);
  END IF;
  IF NEW.repair_option_id IS NOT NULL THEN
    PERFORM calculate_repair_option_totals(NEW.repair_option_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_labour_recalc
  AFTER INSERT OR UPDATE OR DELETE ON repair_labour
  FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_repair_totals();

CREATE TRIGGER trigger_parts_recalc
  AFTER INSERT OR UPDATE OR DELETE ON repair_parts
  FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_repair_totals();

-- Update workflow status
CREATE OR REPLACE FUNCTION update_repair_item_status(p_repair_item_id UUID)
RETURNS void AS $$
DECLARE
  v_has_labour BOOLEAN;
  v_has_parts BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM repair_labour WHERE repair_item_id = p_repair_item_id) INTO v_has_labour;
  SELECT EXISTS(SELECT 1 FROM repair_parts WHERE repair_item_id = p_repair_item_id) INTO v_has_parts;
  
  UPDATE repair_items SET
    labour_status = CASE WHEN v_has_labour THEN 'complete' ELSE 'pending' END,
    parts_status = CASE WHEN v_has_parts THEN 'complete' ELSE 'pending' END,
    quote_status = CASE WHEN v_has_labour OR v_has_parts THEN 'ready' ELSE 'pending' END,
    updated_at = NOW()
  WHERE id = p_repair_item_id;
END;
$$ LANGUAGE plpgsql;
```

---

## 3. API ENDPOINTS

### 3.1 Labour Codes

```
GET    /api/v1/labour-codes                    # List org's labour codes
POST   /api/v1/labour-codes                    # Create labour code
PATCH  /api/v1/labour-codes/:id                # Update labour code
DELETE /api/v1/labour-codes/:id                # Soft delete
```

### 3.2 Suppliers

```
GET    /api/v1/suppliers                       # List org's suppliers
POST   /api/v1/suppliers                       # Create supplier (full or quick-add)
PATCH  /api/v1/suppliers/:id                   # Update supplier
DELETE /api/v1/suppliers/:id                   # Soft delete
```

### 3.3 Repair Items

```
# Repair items for a health check
GET    /api/v1/health-checks/:id/repair-items  # List all repair items/groups
POST   /api/v1/health-checks/:id/repair-items  # Create repair item
       Body: { name, is_group, check_result_ids: [] }

# Individual repair item
GET    /api/v1/repair-items/:id                # Get with labour, parts, options
PATCH  /api/v1/repair-items/:id                # Update (name, description, price override)
DELETE /api/v1/repair-items/:id                # Delete repair item

# Link/unlink check results
POST   /api/v1/repair-items/:id/check-results  # Link check result
       Body: { check_result_id }
DELETE /api/v1/repair-items/:id/check-results/:checkResultId  # Unlink
```

### 3.4 Repair Options

```
GET    /api/v1/repair-items/:id/options        # List options
POST   /api/v1/repair-items/:id/options        # Create option
       Body: { name, description, is_recommended }
PATCH  /api/v1/repair-options/:id              # Update option
DELETE /api/v1/repair-options/:id              # Delete option

# Select option for customer quote
POST   /api/v1/repair-items/:id/select-option  # Set selected_option_id
       Body: { option_id }
```

### 3.5 Labour Entries

```
# For repair item (no options)
GET    /api/v1/repair-items/:id/labour         # List labour entries
POST   /api/v1/repair-items/:id/labour         # Add labour
       Body: { labour_code_id, hours, notes }
PATCH  /api/v1/repair-labour/:id               # Update
DELETE /api/v1/repair-labour/:id               # Delete

# For repair option
GET    /api/v1/repair-options/:id/labour
POST   /api/v1/repair-options/:id/labour
```

### 3.6 Parts Entries

```
# For repair item
GET    /api/v1/repair-items/:id/parts          # List parts
POST   /api/v1/repair-items/:id/parts          # Add part
       Body: { part_number, description, quantity, supplier_id, cost_price, sell_price }
PATCH  /api/v1/repair-parts/:id                # Update
DELETE /api/v1/repair-parts/:id                # Delete

# For repair option
GET    /api/v1/repair-options/:id/parts
POST   /api/v1/repair-options/:id/parts

# Margin calculator helper
POST   /api/v1/pricing/calculate-margin
       Body: { cost_price, margin_percent }
       Returns: { sell_price, markup_percent }

POST   /api/v1/pricing/calculate-markup
       Body: { cost_price, markup_percent }
       Returns: { sell_price, margin_percent }
```

### 3.7 Workflow Status

```
# Update status manually if needed
PATCH  /api/v1/repair-items/:id/status
       Body: { labour_status?, parts_status?, quote_status? }

# Mark labour complete
POST   /api/v1/repair-items/:id/labour-complete

# Mark parts complete  
POST   /api/v1/repair-items/:id/parts-complete
```

---

## 4. UI DESIGN

### 4.1 Health Check Detail — New Tabs

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ VHC-2024-0142 | Ford Focus | AB12 CDE                    [Send to Customer] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [Summary]  [Health Check]  [Labour]  [Parts]  [Photos]  [Timeline]        │
│             ───────────────                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Summary Tab — Repair Items with Status Badges

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Summary                                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Status: [L🔴] [P🟡] [Q🔴] [S⚪]                                            │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  REPAIR GROUPS & ITEMS                                    [+ Create Repair] │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🔴 Front Brake Overhaul                              [L🟢][P🟢]     │   │
│  │    └─ Linked: Front Pads, Front Discs, Front Caliper                │   │
│  │                                                                      │   │
│  │    Options:                                                          │   │
│  │    ○ Standard (OEM)         £320.00 + VAT                           │   │
│  │    ● Premium (Brembo)       £420.00 + VAT  ✓ RECOMMENDED            │   │
│  │                                                                      │   │
│  │    [Edit] [Add Option]                                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🔴 Drive Belt Replacement                            [L🟢][P🔴]     │   │
│  │    └─ Linked: Drive Belt                                            │   │
│  │                                                                      │   │
│  │    Labour: 0.5 hrs @ £85.00 = £42.50                                │   │
│  │    Parts:  (none added)                                             │   │
│  │    ────────────────────────────────────────                         │   │
│  │    Subtotal: £42.50 + VAT = £51.00                                  │   │
│  │                                                                      │   │
│  │    [Edit] [Add Option]                                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  UNASSIGNED CHECK RESULTS                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🟡 Oil Level Low                              [Create Repair]       │   │
│  │ 🟡 Wiper Blade Worn                           [Create Repair]       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  QUOTE TOTAL                                                                │
│  Labour:          £170.00                                                   │
│  Parts:           £285.00                                                   │
│  Subtotal:        £455.00                                                   │
│  VAT (20%):       £91.00                                                    │
│  ────────────────────────                                                   │
│  TOTAL:           £546.00                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Labour Tab

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Labour                                                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  REPAIR ITEM / GROUP        │ CODE │ HOURS │  RATE  │  TOTAL │ VAT │       │
│  ───────────────────────────┼──────┼───────┼────────┼────────┼─────┼────── │
│  Front Brake Overhaul       │      │       │        │        │     │       │
│    └─ Standard Option       │ LAB  │  1.5  │ £85.00 │ £127.50│  ✓  │ [Edit]│
│    └─ Premium Option        │ LAB  │  2.0  │ £85.00 │ £170.00│  ✓  │ [Edit]│
│  ───────────────────────────┼──────┼───────┼────────┼────────┼─────┼────── │
│  Drive Belt Replacement     │ LAB  │  0.5  │ £85.00 │ £42.50 │  ✓  │ [Edit]│
│  ───────────────────────────┼──────┼───────┼────────┼────────┼─────┼────── │
│  MOT Retest                 │ MOT  │  0.5  │ £45.00 │ £22.50 │  ✗  │ [Edit]│
│  ───────────────────────────┴──────┴───────┴────────┴────────┴─────┴────── │
│                                                                             │
│  [+ Add Labour]                                                             │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Total Labour: £362.50                                 Completed by: John S │
│  VAT Exempt:   £22.50                                  at 14:32 today       │
│  VAT Liable:   £340.00                                                      │
│                                                                             │
│  [Mark Labour Complete ✓]                                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Add Labour Modal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Add Labour                                                             ✕    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Repair Item                                                                │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ Front Brake Overhaul - Standard Option                            ▼  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  Labour Code                              Rate                              │
│  ┌─────────────────────────────────┐     ┌─────────────────────────────┐   │
│  │ LAB - Standard Labour        ▼  │     │ £85.00/hr                   │   │
│  └─────────────────────────────────┘     └─────────────────────────────┘   │
│                                          (from labour code settings)        │
│                                                                             │
│  Hours                                    Total                             │
│  ┌─────────────────────────────────┐     ┌─────────────────────────────┐   │
│  │ 1.5                             │     │ £127.50                     │   │
│  └─────────────────────────────────┘     └─────────────────────────────┘   │
│                                          Auto-calculated                    │
│                                                                             │
│  Notes (optional)                                                           │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌───────────────────┐  ┌───────────────────┐                              │
│  │      Cancel       │  │    Add Labour     │                              │
│  └───────────────────┘  └───────────────────┘                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.5 Parts Tab

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Parts                                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PART NO.    │ DESCRIPTION      │ QTY │ SUPPLIER │ COST   │ SELL   │ TOTAL │
│  ────────────┼──────────────────┼─────┼──────────┼────────┼────────┼────── │
│  Front Brake Overhaul - Standard                                            │
│  BRK-PAD-01  │ Front Brake Pads │  1  │ GSF      │ £25.00 │ £45.00 │ £45.00│
│  BRK-DSC-01  │ Front Discs Pair │  1  │ GSF      │ £65.00 │ £110.00│£110.00│
│  ────────────┼──────────────────┼─────┼──────────┼────────┼────────┼────── │
│  Front Brake Overhaul - Premium                                             │
│  BRK-PAD-02  │ Brembo Pads      │  1  │ Euro     │ £55.00 │ £95.00 │ £95.00│
│  BRK-DSC-02  │ Brembo Discs     │  1  │ Euro     │£120.00 │ £195.00│£195.00│
│  ────────────┴──────────────────┴─────┴──────────┴────────┴────────┴────── │
│                                                                             │
│  [+ Add Part]                                                               │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Total Cost:  £265.00                                  Completed by: Sarah P│
│  Total Sell:  £445.00                                  at 15:45 today       │
│  Margin:      £180.00 (40.4%)                                               │
│                                                                             │
│  [Mark Parts Complete ✓]                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.6 Add Part Modal with Margin Calculator

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Add Part                                                               ✕    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Repair Item                                                                │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ Front Brake Overhaul - Standard Option                            ▼  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  Part Number                          Description                           │
│  ┌─────────────────────────────┐     ┌─────────────────────────────────┐   │
│  │ BRK-PAD-01                  │     │ Front Brake Pads                │   │
│  └─────────────────────────────┘     └─────────────────────────────────┘   │
│                                                                             │
│  Quantity                             Supplier                              │
│  ┌─────────────────────────────┐     ┌─────────────────────────────────┐   │
│  │ 1                           │     │ GSF Car Parts                ▼  │   │
│  └─────────────────────────────┘     └─────────────────────────────────┘   │
│                                       [+ Quick Add Supplier]                │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  Cost Price                           Sell Price                            │
│  ┌─────────────────────────────┐     ┌─────────────────────────────────┐   │
│  │ £25.00                      │     │ £45.00                         │   │
│  └─────────────────────────────┘     └─────────────────────────────────┘   │
│                        [Margin Calculator]                                  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ 💰 MARGIN CALCULATOR                                                  │ │
│  │                                                                       │ │
│  │ Cost Price:    £25.00                                                 │ │
│  │                                                                       │ │
│  │ Desired Margin:  [40] %        ← Default from settings                │ │
│  │                                                                       │ │
│  │ ─────────────────────────────────────────────────────────────────     │ │
│  │ Calculated Sell Price:   £41.67                                       │ │
│  │ Markup:                  66.7%                                        │ │
│  │ Profit:                  £16.67                                       │ │
│  │                                                                       │ │
│  │                                              [Apply £41.67]           │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  Line Total: £45.00                                                         │
│                                                                             │
│  Notes (optional)                                                           │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌───────────────────┐  ┌───────────────────┐                              │
│  │      Cancel       │  │     Add Part      │                              │
│  └───────────────────┘  └───────────────────┘                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.7 Create Repair Modal

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Create Repair                                                          ✕    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Repair Name                                                                │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ Front Brake Overhaul                                                  │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  Description (optional)                                                     │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ Complete front brake service including pads and discs                 │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  Type                                                                       │
│  ○ Individual Repair (single item)                                         │
│  ● Repair Group (bundle multiple items)                                    │
│                                                                             │
│  Link Check Results                                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ ☑ 🔴 Front Brake Pads — Worn below minimum                           │ │
│  │ ☑ 🔴 Front Brake Discs — Scored and worn                             │ │
│  │ ☑ 🟢 Front Brake Caliper — Include for complete service              │ │
│  │ ☐ 🟡 Rear Brake Pads — Approaching limit                             │ │
│  │ ☐ 🟡 Drive Belt — Showing wear                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ☐ Add repair options (e.g., Standard vs Premium)                          │
│                                                                             │
│  ┌───────────────────┐  ┌───────────────────┐                              │
│  │      Cancel       │  │  Create Repair    │                              │
│  └───────────────────┘  └───────────────────┘                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.8 Workflow Status Badges (Kanban/List View)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Health Checks                                                    [+ New]    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  REG      │ CUSTOMER      │ STATUS      │ WORKFLOW         │ TOTAL │       │
│  ─────────┼───────────────┼─────────────┼──────────────────┼───────┼────── │
│  AB12 CDE │ John Smith    │ In Progress │ [L🟢][P🟢][Q🟢][S⚪] │ £546  │ [View]│
│  XY34 FGH │ Sarah Jones   │ In Progress │ [L🟢][P🔴][Q🔴][S⚪] │ £—    │ [View]│
│  MN56 JKL │ Bob Wilson    │ In Progress │ [L🔴][P🔴][Q🔴][S⚪] │ £—    │ [View]│
│  PQ78 RST │ Emma Brown    │ Sent        │ [L🟢][P🟢][Q🟢][S🟢] │ £320  │ [View]│
│  ─────────┴───────────────┴─────────────┴──────────────────┴───────┴────── │
│                                                                             │
│  Legend:                                                                    │
│  L = Labour   P = Parts   Q = Quoted   S = Sent                            │
│  🔴 Not done  🟡 In progress  🟢 Complete  ⚪ Not applicable                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.9 Customer View — Repair Options

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🔴 URGENT ATTENTION REQUIRED                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FRONT BRAKE OVERHAUL                                                       │
│  ─────────────────────                                                      │
│  Your front brakes need attention. We found worn pads and scored discs      │
│  which affect your stopping distance.                                       │
│                                                                             │
│  Includes:                                                                  │
│  • Front Brake Pads                                                         │
│  • Front Brake Discs                                                        │
│  • Front Brake Caliper inspection                                           │
│                                                                             │
│  Please select an option:                                                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ○ STANDARD                                              £320.00     │   │
│  │   Quality OEM-equivalent parts with 12 month warranty   + VAT       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ● PREMIUM                                     ✓ RECOMMENDED         │   │
│  │   Brembo performance parts with 24 month warranty       £420.00     │   │
│  │                                                         + VAT       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Approve Selected Option                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Decline This Repair                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. SETTINGS

### 5.1 Labour Codes (Settings > Labour Codes)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Settings > Labour Codes                                        [+ Add New]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CODE  │ DESCRIPTION      │ RATE    │ VAT     │ DEFAULT │ ACTIONS          │
│  ──────┼──────────────────┼─────────┼─────────┼─────────┼───────────────── │
│  LAB   │ Standard Labour  │ £85.00  │ ✓ Yes   │ ● Yes   │ [Edit] [Delete]  │
│  DIAG  │ Diagnostic       │ £95.00  │ ✓ Yes   │ ○ No    │ [Edit] [Delete]  │
│  MOT   │ MOT Labour       │ £45.00  │ ✗ No    │ ○ No    │ [Edit] [Delete]  │
│  ──────┴──────────────────┴─────────┴─────────┴─────────┴───────────────── │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Suppliers (Settings > Suppliers)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Settings > Suppliers                                           [+ Add New]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  NAME              │ CODE │ ACCOUNT NO. │ CONTACT       │ ACTIONS          │
│  ──────────────────┼──────┼─────────────┼───────────────┼───────────────── │
│  GSF Car Parts     │ GSF  │ ACC-12345   │ 0800 123 456  │ [Edit] [Delete]  │
│  Euro Car Parts    │ EURO │ EC-98765    │ 0800 789 012  │ [Edit] [Delete]  │
│  Local Motor Spares│ LMS  │ —           │ —             │ [Edit] [Delete]  │
│  ──────────────────┴──────┴─────────────┴───────────────┴───────────────── │
│                                                                             │
│  ⚠️ "Local Motor Spares" was quick-added. Consider adding full details.    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Pricing Settings (Settings > Pricing)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Settings > Pricing                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  DEFAULT MARGIN                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 40 %                                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  Used in margin calculator when adding parts                                │
│                                                                             │
│  VAT RATE                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 20 %                                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  Applied to labour (except VAT-exempt codes) and parts                      │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                           Save Changes                                │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. IMPLEMENTATION PHASES

### Phase 1: Database & Settings (20-25 iterations)
- [ ] Create labour_codes table and seed defaults (LAB, DIAG, MOT)
- [ ] Create suppliers table
- [ ] Add pricing settings to organization_settings
- [ ] Create repair_items table
- [ ] Create repair_item_check_results junction table
- [ ] Create repair_options table
- [ ] Create repair_labour table
- [ ] Create repair_parts table
- [ ] Create helper functions (calculate totals, update status)
- [ ] Create triggers for auto-recalculation
- [ ] Add RLS policies
- [ ] Add indexes

### Phase 2: Settings UI (15-20 iterations)
- [ ] Labour Codes settings page (CRUD)
- [ ] Suppliers settings page (CRUD with quick-add)
- [ ] Pricing settings page (margin, VAT)
- [ ] Seed labour codes on org creation

### Phase 3: Settings API (10-15 iterations)
- [ ] Labour codes CRUD endpoints
- [ ] Suppliers CRUD endpoints
- [ ] Pricing settings endpoints
- [ ] Margin calculator endpoint

### Phase 4: Repair Items API (15-20 iterations)
- [ ] Repair items CRUD
- [ ] Link/unlink check results
- [ ] Repair options CRUD
- [ ] Labour entries CRUD
- [ ] Parts entries CRUD
- [ ] Auto-calculate totals on changes
- [ ] Workflow status endpoints

### Phase 5: Health Check UI — Tabs (20-25 iterations)
- [ ] Add Labour and Parts tabs to health check detail
- [ ] Labour tab UI with table and add modal
- [ ] Parts tab UI with table and add modal
- [ ] Margin calculator component
- [ ] Quick-add supplier from parts modal
- [ ] Mark complete functionality

### Phase 6: Repair Groups UI (20-25 iterations)
- [ ] Summary tab redesign with repair items
- [ ] Create repair modal (individual or group)
- [ ] Link check results to repairs
- [ ] Edit repair item
- [ ] Add repair options
- [ ] Display options with pricing
- [ ] Price override functionality

### Phase 7: Workflow Badges (10-15 iterations)
- [ ] Badge component (L, P, Q, S with RAG colours)
- [ ] Add to health check list view
- [ ] Add to Kanban view
- [ ] Add to health check detail header
- [ ] Auto-update on status changes

### Phase 8: Customer Portal (15-20 iterations)
- [ ] Display repair groups with descriptions
- [ ] Display repair options for customer selection
- [ ] Option selection UI
- [ ] Approve/decline per repair item
- [ ] All-or-nothing for groups
- [ ] Update totals based on selections

### Phase 9: PDF & Notifications (10-15 iterations)
- [ ] Include repair groups in PDF
- [ ] Include options in PDF
- [ ] Show selected option in confirmation
- [ ] Update email templates

### Phase 10: Polish (COMPLETE)
- [x] VAT calculations verified (MOT exempt, correct formula)
- [x] Margin calculations verified (matches spec formulas)
- [x] Price override functionality (reason required, flows to customer view)
- [x] Mobile responsive (form grids stack on small screens)
- [x] Error handling (empty labour codes warning, validation)
- [x] Edge cases (prevent deletion of approved items)
- [x] Performance verified (batch API calls with Promise.all, memoized calculations)
- [x] Workflow status accuracy (badges update correctly)
- [x] Full workflow testing (end-to-end verified)

---

## 7. FORMULAS

### Margin vs Markup

```
Margin % = (Sell Price - Cost Price) / Sell Price × 100
Markup % = (Sell Price - Cost Price) / Cost Price × 100

Given Cost and desired Margin:
Sell Price = Cost Price / (1 - Margin % / 100)

Given Cost and desired Markup:
Sell Price = Cost Price × (1 + Markup % / 100)
```

### Example

```
Cost: £25.00
Desired Margin: 40%

Sell = 25 / (1 - 0.40) = 25 / 0.60 = £41.67
Markup = (41.67 - 25) / 25 × 100 = 66.7%
Profit = £16.67
```

### VAT Calculation

```
Subtotal = Labour Total + Parts Total
VAT Amount = (Labour VAT-able + Parts Total) × VAT Rate
Total Inc VAT = Subtotal + VAT Amount

Note: MOT labour is VAT-exempt, so excluded from VAT calculation
```

---

*Document Version: 1.0*
*Created: January 2026*
