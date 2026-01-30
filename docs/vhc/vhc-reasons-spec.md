# VHC Tech Reasons & Sales Descriptions
## Comprehensive Feature Specification

---

## 1. OVERVIEW

### 1.1 Purpose
Provide technicians with predefined reason lists when marking inspection items, and give advisors professionally written descriptions to communicate effectively with customers.

**The core problem being solved:**
- Technician knows something is wrong (or right), but struggles to articulate WHY
- Service Advisor needs to explain work without sounding pushy
- Customer needs to understand and trust the recommendation

**The flow:** Tech inspects item → Selects reason(s) → System provides professional description → Customer understands and approves

### 1.2 User Benefits

| User | Benefit |
|------|---------|
| **Technician** | Faster inspection - pick from list instead of typing. Consistent terminology. |
| **Service Advisor** | Ready-made descriptions for both problems AND positive findings. |
| **Customer** | Clear, jargon-free explanations. Understands what's checked AND what's wrong. |
| **Business** | Consistent communication. Higher authorization rates. Quality control on messaging. |

### 1.3 Key Features
- Predefined reason lists per template item (or item type)
- **Reasons available for ALL RAG statuses** (Red, Amber, AND Green)
- **Item type grouping** — define reasons once, apply to multiple similar items
- Multiple reasons can be selected per item
- Auto-RAG suggestion (tech can override)
- Technical description (advisor sees)
- Customer-friendly description (customer sees)
- **Tech-selected follow-up interval** (e.g., "Check again in 3 months")
- Advisor can edit descriptions before sending
- Reason categories (Safety, Wear, Maintenance, Advisory, Positive)
- **Custom reason submission → Workshop Manager approval workflow**
- AI generation for bulk initial data
- **Organization tone setting** (Premium or Friendly)
- UK English throughout
- Recently used reasons for faster selection
- Usage analytics and approval rate tracking
- Starter template for new organizations

---

## 2. DATA MODEL

### 2.1 Item Types (for Reason Grouping)

Items that need identical reasons can share an `item_type`. This eliminates duplication.

```sql
-- Add item_type to template_items
ALTER TABLE template_items ADD COLUMN item_type VARCHAR(50);

-- Standard item types
COMMENT ON COLUMN template_items.item_type IS 
'Groups similar items so they share the same reasons. Examples:
- tyre: All 4 tyre items share tyre reasons
- brake_assembly: Front/Rear brakes share brake reasons  
- wiper: Front/Rear wipers share wiper reasons
- fluid_level: Oil/Coolant/Brake Fluid share fluid reasons
- NULL: Unique items have their own specific reasons';
```

**Standard Item Types:**

| item_type | Applies To |
|-----------|------------|
| `tyre` | Front Left/Right, Rear Left/Right Tyre |
| `brake_assembly` | Front Brakes, Rear Brakes |
| `brake_disc` | Front/Rear Brake Discs |
| `brake_pad` | Front/Rear Brake Pads |
| `wiper` | Front Wipers, Rear Wiper |
| `shock_absorber` | Front/Rear Shock Absorbers |
| `fluid_level` | Oil, Coolant, Brake Fluid, Washer Fluid |
| `light_cluster` | Headlights, Rear Lights, Indicators |
| `seat_belt` | Driver/Passenger Seat Belts |
| `suspension_arm` | Wishbones, Control Arms |
| `cv_boot` | Inner/Outer CV Boots |
| `null` | Unique items (Drive Belt, Battery, Air Filter, etc.) |

### 2.2 New Tables

```sql
-- Reason categories (global reference)
CREATE TABLE reason_categories (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  color VARCHAR(7),
  -- Which RAG statuses this category typically applies to
  typical_rag VARCHAR(10)  -- 'red', 'amber', 'green', or 'any'
);

-- Seed categories (including positive for green items)
INSERT INTO reason_categories (id, name, description, display_order, color, typical_rag) VALUES
('safety', 'Safety Critical', 'Issues that affect vehicle safety - must be addressed immediately', 1, '#DC2626', 'red'),
('wear', 'Wear Item', 'Components that wear over time and need periodic replacement', 2, '#F59E0B', 'amber'),
('maintenance', 'Maintenance', 'Routine maintenance items', 3, '#3B82F6', 'amber'),
('advisory', 'Advisory', 'Items to monitor - not urgent but worth noting', 4, '#6B7280', 'amber'),
('positive', 'Positive Finding', 'Item checked and in good condition', 5, '#10B981', 'green');

-- Organization tone setting
ALTER TABLE organization_settings ADD COLUMN reason_tone VARCHAR(50) DEFAULT 'friendly';
-- Values: 'premium' (formal, technical) or 'friendly' (warm, reassuring)

COMMENT ON COLUMN organization_settings.reason_tone IS
'Controls the tone of AI-generated reason descriptions:
- premium: Formal, technical language suitable for dealerships
- friendly: Warm, reassuring language suitable for independent garages';

-- Reasons per template item OR item type
CREATE TABLE item_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Link to EITHER a specific item OR an item type (not both)
  template_item_id UUID REFERENCES template_items(id) ON DELETE CASCADE,
  item_type VARCHAR(50),
  
  -- Reason text (what tech sees and selects)
  reason_text VARCHAR(255) NOT NULL,
  
  -- Descriptions
  technical_description TEXT,  -- For advisor: detailed technical explanation
  customer_description TEXT,   -- For customer: simple, clear explanation
  
  -- RAG and category
  default_rag VARCHAR(10) DEFAULT 'amber',  -- 'red', 'amber', 'green'
  category_id VARCHAR(50) REFERENCES reason_categories(id),
  
  -- Follow-up suggestion (optional - tech can override)
  suggested_follow_up_days INTEGER,  -- e.g., 90 for "3 months"
  suggested_follow_up_text VARCHAR(255),  -- e.g., "Recommend checking at next service"
  
  -- AI tracking
  ai_generated BOOLEAN DEFAULT false,
  ai_reviewed BOOLEAN DEFAULT false,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  
  -- Usage tracking
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  
  -- Approval tracking (aggregated from check_result_reasons)
  times_approved INTEGER DEFAULT 0,
  times_declined INTEGER DEFAULT 0,
  
  -- Starter template flag (for copying to new orgs)
  is_starter_template BOOLEAN DEFAULT false,
  
  -- Status & ordering
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  
  -- Must have either template_item_id OR item_type
  CONSTRAINT check_reason_target CHECK (
    (template_item_id IS NOT NULL AND item_type IS NULL) OR
    (template_item_id IS NULL AND item_type IS NOT NULL)
  ),
  
  -- Unique reason per item or type
  CONSTRAINT unique_reason_per_item UNIQUE (organization_id, template_item_id, reason_text),
  CONSTRAINT unique_reason_per_type UNIQUE (organization_id, item_type, reason_text)
);

-- Custom reason submissions (tech suggestions → manager approval)
CREATE TABLE reason_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- What the reason applies to
  template_item_id UUID REFERENCES template_items(id),
  item_type VARCHAR(50),
  
  -- Submitted content
  submitted_reason_text VARCHAR(255) NOT NULL,
  submitted_notes TEXT,  -- Tech's explanation of why this should be added
  
  -- Context (which inspection triggered this)
  health_check_id UUID REFERENCES health_checks(id),
  check_result_id UUID REFERENCES check_results(id),
  submitted_by UUID NOT NULL REFERENCES users(id),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Review workflow
  status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,  -- Reason for rejection, or notes on approval
  
  -- If approved, link to created reason
  approved_reason_id UUID REFERENCES item_reasons(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT check_submission_target CHECK (
    template_item_id IS NOT NULL OR item_type IS NOT NULL
  )
);

-- Junction table: selected reasons per check result
CREATE TABLE check_result_reasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  check_result_id UUID NOT NULL REFERENCES check_results(id) ON DELETE CASCADE,
  item_reason_id UUID NOT NULL REFERENCES item_reasons(id),
  
  -- Denormalized for analytics queries
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),  -- Tech who selected
  
  -- Allow override of descriptions per check
  technical_description_override TEXT,
  customer_description_override TEXT,
  
  -- Tech-selected follow-up (can differ from reason's suggestion)
  follow_up_days INTEGER,
  follow_up_text VARCHAR(255),
  
  -- Track if tech overrode the auto-RAG
  rag_overridden BOOLEAN DEFAULT false,
  
  -- Approval tracking (updated when customer responds)
  customer_approved BOOLEAN,  -- NULL = not yet responded, true/false = decision
  approved_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(check_result_id, item_reason_id)
);

-- Add custom reason text to check_results (for free-form additions)
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS custom_reason_text TEXT;
ALTER TABLE check_results ADD COLUMN IF NOT EXISTS custom_reason_submitted BOOLEAN DEFAULT false;

-- Indexes
CREATE INDEX idx_item_reasons_template ON item_reasons(template_item_id) WHERE template_item_id IS NOT NULL;
CREATE INDEX idx_item_reasons_type ON item_reasons(item_type) WHERE item_type IS NOT NULL;
CREATE INDEX idx_item_reasons_org ON item_reasons(organization_id);
CREATE INDEX idx_item_reasons_category ON item_reasons(category_id);
CREATE INDEX idx_item_reasons_rag ON item_reasons(default_rag);
CREATE INDEX idx_item_reasons_usage ON item_reasons(usage_count DESC);
CREATE INDEX idx_item_reasons_starter ON item_reasons(is_starter_template) WHERE is_starter_template = true;
CREATE INDEX idx_reason_submissions_org ON reason_submissions(organization_id);
CREATE INDEX idx_reason_submissions_status ON reason_submissions(status);
CREATE INDEX idx_check_result_reasons_result ON check_result_reasons(check_result_id);
CREATE INDEX idx_check_result_reasons_user ON check_result_reasons(user_id, created_at DESC);
CREATE INDEX idx_check_result_reasons_org ON check_result_reasons(organization_id);
CREATE INDEX idx_check_result_reasons_approval ON check_result_reasons(item_reason_id, customer_approved) WHERE customer_approved IS NOT NULL;
```

### 2.3 RLS Policies

```sql
-- item_reasons: Org members can read, managers can write
ALTER TABLE item_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view reasons" ON item_reasons
  FOR SELECT USING (organization_id = current_org_id());

CREATE POLICY "Managers can manage reasons" ON item_reasons
  FOR ALL USING (
    organization_id = current_org_id() 
    AND current_user_role() IN ('org_admin', 'site_admin', 'service_advisor')
  );

-- reason_submissions: Tech can submit, managers can review
ALTER TABLE reason_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view submissions" ON reason_submissions
  FOR SELECT USING (organization_id = current_org_id());

CREATE POLICY "Techs can create submissions" ON reason_submissions
  FOR INSERT WITH CHECK (organization_id = current_org_id());

CREATE POLICY "Managers can update submissions" ON reason_submissions
  FOR UPDATE USING (
    organization_id = current_org_id()
    AND current_user_role() IN ('org_admin', 'site_admin', 'service_advisor')
  );

-- check_result_reasons: Based on parent check_result access
ALTER TABLE check_result_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access via check_result" ON check_result_reasons
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM check_results cr
      JOIN health_checks hc ON cr.health_check_id = hc.id
      WHERE cr.id = check_result_id
      AND hc.organization_id = current_org_id()
    )
  );
```

### 2.4 Helper Functions

```sql
-- Get reasons for a template item (merges specific + type-based reasons)
CREATE OR REPLACE FUNCTION get_reasons_for_item(
  p_template_item_id UUID,
  p_organization_id UUID
)
RETURNS TABLE (
  id UUID,
  reason_text VARCHAR(255),
  technical_description TEXT,
  customer_description TEXT,
  default_rag VARCHAR(10),
  category_id VARCHAR(50),
  suggested_follow_up_days INTEGER,
  suggested_follow_up_text VARCHAR(255),
  usage_count INTEGER,
  approval_rate NUMERIC,
  source VARCHAR(20)  -- 'specific' or 'type'
) AS $$
DECLARE
  v_item_type VARCHAR(50);
BEGIN
  -- Get the item's type
  SELECT ti.item_type INTO v_item_type
  FROM template_items ti
  WHERE ti.id = p_template_item_id;
  
  RETURN QUERY
  -- Specific reasons for this exact item
  SELECT 
    ir.id,
    ir.reason_text,
    ir.technical_description,
    ir.customer_description,
    ir.default_rag,
    ir.category_id,
    ir.suggested_follow_up_days,
    ir.suggested_follow_up_text,
    ir.usage_count,
    CASE WHEN (ir.times_approved + ir.times_declined) > 0 
      THEN ROUND(ir.times_approved::NUMERIC / (ir.times_approved + ir.times_declined) * 100, 1)
      ELSE NULL 
    END as approval_rate,
    'specific'::VARCHAR(20) as source
  FROM item_reasons ir
  WHERE ir.template_item_id = p_template_item_id
    AND ir.organization_id = p_organization_id
    AND ir.is_active = true
  
  UNION ALL
  
  -- Type-based reasons (only if item has a type)
  SELECT 
    ir.id,
    ir.reason_text,
    ir.technical_description,
    ir.customer_description,
    ir.default_rag,
    ir.category_id,
    ir.suggested_follow_up_days,
    ir.suggested_follow_up_text,
    ir.usage_count,
    CASE WHEN (ir.times_approved + ir.times_declined) > 0 
      THEN ROUND(ir.times_approved::NUMERIC / (ir.times_approved + ir.times_declined) * 100, 1)
      ELSE NULL 
    END as approval_rate,
    'type'::VARCHAR(20) as source
  FROM item_reasons ir
  WHERE ir.item_type = v_item_type
    AND v_item_type IS NOT NULL
    AND ir.organization_id = p_organization_id
    AND ir.is_active = true
    -- Exclude if there's a specific reason with same text (specific overrides type)
    AND NOT EXISTS (
      SELECT 1 FROM item_reasons ir2
      WHERE ir2.template_item_id = p_template_item_id
        AND ir2.organization_id = p_organization_id
        AND ir2.reason_text = ir.reason_text
        AND ir2.is_active = true
    )
  
  ORDER BY default_rag DESC, usage_count DESC, reason_text;
END;
$$ LANGUAGE plpgsql;

-- Increment usage count when reason is selected
CREATE OR REPLACE FUNCTION increment_reason_usage()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE item_reasons 
  SET usage_count = usage_count + 1,
      last_used_at = NOW()
  WHERE id = NEW.item_reason_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_increment_reason_usage
  AFTER INSERT ON check_result_reasons
  FOR EACH ROW EXECUTE FUNCTION increment_reason_usage();

-- Update approval stats when customer responds
CREATE OR REPLACE FUNCTION update_reason_approval_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_approved IS NOT NULL AND OLD.customer_approved IS NULL THEN
    IF NEW.customer_approved = true THEN
      UPDATE item_reasons SET times_approved = times_approved + 1 WHERE id = NEW.item_reason_id;
    ELSE
      UPDATE item_reasons SET times_declined = times_declined + 1 WHERE id = NEW.item_reason_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_approval_stats
  AFTER UPDATE OF customer_approved ON check_result_reasons
  FOR EACH ROW EXECUTE FUNCTION update_reason_approval_stats();

-- Copy starter template reasons to new organization
CREATE OR REPLACE FUNCTION copy_starter_reasons_to_org(
  target_org_id UUID,
  source_org_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
  copied_count INTEGER := 0;
BEGIN
  INSERT INTO item_reasons (
    organization_id, template_item_id, item_type, reason_text,
    technical_description, customer_description,
    default_rag, category_id, 
    suggested_follow_up_days, suggested_follow_up_text,
    ai_generated, ai_reviewed,
    is_active, sort_order
  )
  SELECT 
    target_org_id, template_item_id, item_type, reason_text,
    technical_description, customer_description,
    default_rag, category_id,
    suggested_follow_up_days, suggested_follow_up_text,
    ai_generated, true,  -- Mark as reviewed
    is_active, sort_order
  FROM item_reasons
  WHERE is_starter_template = true
    AND (source_org_id IS NULL OR organization_id = source_org_id)
  ON CONFLICT DO NOTHING;
  
  GET DIAGNOSTICS copied_count = ROW_COUNT;
  RETURN copied_count;
END;
$$ LANGUAGE plpgsql;
```

---

## 3. API ENDPOINTS

### 3.1 Item Reasons CRUD

```
# Get reasons for a template item (merges specific + type-based)
GET /api/v1/template-items/:id/reasons
  Query: ?rag=red|amber|green (optional filter)
  → Returns: { 
      reasons: ItemReason[], 
      categories: Category[],
      item_type: string | null,
      reason_source: 'specific' | 'type' | 'mixed'
    }

# Get reasons by item type (for admin bulk management)
GET /api/v1/reasons/by-type/:itemType
  → Returns: { reasons: ItemReason[] }

# Get recently used reasons for current tech
GET /api/v1/reasons/recently-used
  Query: ?limit=10
  → Returns: { reasons: ItemReason[] }

# Create reason for specific item
POST /api/v1/template-items/:id/reasons
  Body: { 
    reason_text, technical_description, customer_description, 
    default_rag, category_id,
    suggested_follow_up_days?, suggested_follow_up_text?
  }
  → Returns: ItemReason

# Create reason for item type (applies to all items of that type)
POST /api/v1/reasons/by-type/:itemType
  Body: { 
    reason_text, technical_description, customer_description, 
    default_rag, category_id,
    suggested_follow_up_days?, suggested_follow_up_text?
  }
  → Returns: ItemReason

# Update reason
PATCH /api/v1/item-reasons/:id
  Body: { ...fields to update }
  → Returns: ItemReason

# Delete reason (soft delete)
DELETE /api/v1/item-reasons/:id
  → Returns: { success: true }

# Reorder reasons
PUT /api/v1/template-items/:id/reasons/reorder
  Body: { reason_ids: string[] }
  → Returns: { success: true }

# Mark AI reason as reviewed
POST /api/v1/item-reasons/:id/mark-reviewed
  → Returns: ItemReason

# Get reason usage and approval statistics
GET /api/v1/organizations/:id/reason-stats
  Query: ?period=30d
  → Returns: { 
      topReasons: [], 
      unusedReasons: [], 
      totalUsage: number,
      approvalRates: { reasonId: string, rate: number }[]
    }
```

### 3.2 Reason Submissions (Tech → Manager Approval)

```
# Submit custom reason for manager review
POST /api/v1/reason-submissions
  Body: { 
    template_item_id?, item_type?,
    reason_text, notes,
    health_check_id?, check_result_id?
  }
  → Returns: ReasonSubmission

# List pending submissions (for managers)
GET /api/v1/organizations/:id/reason-submissions?status=pending
  → Returns: { submissions: ReasonSubmission[], count: number }

# Get pending submission count (for badge)
GET /api/v1/organizations/:id/reason-submissions/count?status=pending
  → Returns: { count: number }

# Approve submission (creates new reason)
POST /api/v1/reason-submissions/:id/approve
  Body: { 
    technical_description, customer_description, 
    default_rag, category_id,
    suggested_follow_up_days?, suggested_follow_up_text?
  }
  → Creates item_reason, updates submission status
  → Returns: { submission: ReasonSubmission, reason: ItemReason }

# Reject submission
POST /api/v1/reason-submissions/:id/reject
  Body: { review_notes }
  → Returns: ReasonSubmission
```

### 3.3 Check Result Reasons

```
# Get reasons for a check result
GET /api/v1/check-results/:id/reasons
  → Returns: { 
      selected_reasons: CheckResultReason[], 
      available_reasons: ItemReason[] 
    }

# Set selected reasons for check result
PUT /api/v1/check-results/:id/reasons
  Body: { 
    reason_ids: string[],
    follow_up_days?: number,
    follow_up_text?: string
  }
  → Returns: { selected_reasons: CheckResultReason[] }

# Update description override (advisor editing before send)
PATCH /api/v1/check-result-reasons/:id
  Body: { 
    technical_description_override?, 
    customer_description_override?,
    follow_up_days?,
    follow_up_text?
  }
  → Returns: CheckResultReason

# Record customer approval/decline (called when customer responds)
PATCH /api/v1/check-result-reasons/:id/approval
  Body: { approved: boolean }
  → Returns: CheckResultReason
```

### 3.4 AI Generation

```
# Generate reasons for single template item
POST /api/v1/template-items/:id/reasons/generate
  → Returns: { reasons: ItemReason[], count: number }

# Generate reasons for item type (all items of that type)
POST /api/v1/reasons/by-type/:itemType/generate
  → Returns: { reasons: ItemReason[], count: number }

# Bulk generate for all template items in a template
POST /api/v1/templates/:id/generate-all-reasons
  → Returns: { 
      items_processed: number, 
      types_processed: number,
      reasons_created: number 
    }

# Regenerate descriptions for existing reason
POST /api/v1/item-reasons/:id/regenerate-descriptions
  → Returns: ItemReason (with new descriptions)
```

### 3.5 Organization Tone Setting

```
# Get tone setting
GET /api/v1/organizations/:id/settings/reason-tone
  → Returns: { tone: 'premium' | 'friendly' }

# Update tone setting
PATCH /api/v1/organizations/:id/settings/reason-tone
  Body: { tone: 'premium' | 'friendly' }
  → Returns: { tone: string }
```

### 3.6 Starter Template (Super Admin)

```
# Mark reasons as starter template
POST /api/v1/admin/reasons/mark-as-starter
  Body: { organization_id, reason_ids: string[] }
  → Returns: { marked: number }

# Copy starter reasons to organization
POST /api/v1/organizations/:id/copy-starter-reasons
  → Returns: { copied: number }
```

---

## 4. AI GENERATION

### 4.1 Prompt Template for Reason Generation

```typescript
const generateReasonsPrompt = (
  templateItem: TemplateItem, 
  tone: 'premium' | 'friendly',
  itemType?: string
) => `
You are an expert UK MOT tester and vehicle technician. Generate a list of common reasons/findings for the following vehicle inspection item.

INSPECTION ITEM: ${templateItem?.name || `All ${itemType} items`}
SECTION: ${templateItem?.section_name || 'Various'}
ITEM TYPE: ${itemType || templateItem?.item_type || 'unique'}

TONE SETTING: ${tone === 'premium' 
  ? 'PREMIUM - Use formal, technical language suitable for a main dealer or prestige service centre. Professional and precise.'
  : 'FRIENDLY - Use warm, reassuring language suitable for an independent family garage. Clear and approachable.'}

Generate reasons for ALL three RAG statuses:
- RED reasons: Immediate safety concerns, failures, must-fix items
- AMBER reasons: Wear items, advisory items, should address soon
- GREEN reasons: Positive findings, checked and OK, reassuring confirmations

For each reason, provide:
1. reason_text: What the technician selects (concise, max 50 chars)
2. technical_description: For the service advisor (2-3 sentences, technical detail)
3. customer_description: For the customer (2-3 sentences, ${tone === 'premium' ? 'professional but clear' : 'warm and reassuring'}, explain WHY it matters)
4. default_rag: 'red', 'amber', or 'green'
5. category: 'safety', 'wear', 'maintenance', 'advisory', or 'positive'
6. suggested_follow_up_days: Number of days until recommended recheck (null if not applicable)
7. suggested_follow_up_text: Brief follow-up recommendation (null if not applicable)

IMPORTANT:
- Use UK English spelling (tyre, colour, centre, honour)
- Customer descriptions should be ${tone === 'premium' ? 'professional and reassuring' : 'friendly and reassuring'}
- Explain safety implications where relevant
- Include common wear-related reasons and failure modes
- Include at least 2-3 GREEN/positive reasons (e.g., "Good condition", "Within specification")
- Follow-up suggestions should be realistic (e.g., 90 days, 180 days, "at next service")

Return as JSON array:
[
  {
    "reason_text": "...",
    "technical_description": "...",
    "customer_description": "...",
    "default_rag": "red|amber|green",
    "category": "safety|wear|maintenance|advisory|positive",
    "suggested_follow_up_days": 90,
    "suggested_follow_up_text": "Recommend rechecking at next service"
  }
]

Generate 8-12 relevant reasons covering red, amber, AND green findings.
`;
```

### 4.2 AI Service

```typescript
// /apps/api/src/services/ai-reasons.ts

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

interface GeneratedReason {
  reason_text: string;
  technical_description: string;
  customer_description: string;
  default_rag: 'red' | 'amber' | 'green';
  category: 'safety' | 'wear' | 'maintenance' | 'advisory' | 'positive';
  suggested_follow_up_days: number | null;
  suggested_follow_up_text: string | null;
}

export async function generateReasonsForItem(
  templateItem: TemplateItem,
  tone: 'premium' | 'friendly'
): Promise<GeneratedReason[]> {
  const prompt = generateReasonsPrompt(templateItem, tone);
  
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }]
  });
  
  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  
  if (!jsonMatch) {
    throw new Error('Failed to parse AI response');
  }
  
  const reasons: GeneratedReason[] = JSON.parse(jsonMatch[0]);
  
  // Validate and sanitize
  return reasons.map(r => ({
    reason_text: r.reason_text.slice(0, 255),
    technical_description: r.technical_description,
    customer_description: r.customer_description,
    default_rag: ['red', 'amber', 'green'].includes(r.default_rag) ? r.default_rag : 'amber',
    category: ['safety', 'wear', 'maintenance', 'advisory', 'positive'].includes(r.category) 
      ? r.category : 'advisory',
    suggested_follow_up_days: r.suggested_follow_up_days,
    suggested_follow_up_text: r.suggested_follow_up_text?.slice(0, 255) || null
  }));
}

export async function generateReasonsForItemType(
  itemType: string,
  tone: 'premium' | 'friendly'
): Promise<GeneratedReason[]> {
  const prompt = generateReasonsPrompt(null, tone, itemType);
  
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }]
  });
  
  // ... same parsing logic
}
```

---

## 5. TECHNICIAN UI

### 5.1 Reason Selection (During Inspection)

When tech taps an item, show reason picker **regardless of RAG status**:

```
┌─────────────────────────────────────────────────────────────────┐
│  Front Left Tyre                                        ✕ Close │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Status: [🔴 Red] [🟡 Amber] [🟢 Green]  ← Selected: Amber      │
│                                                                 │
│  🔍 Search reasons...                    ← Shows if > 10 reasons│
│                                                                 │
│  SELECT REASON(S):                                              │
│  ─────────────────                                              │
│                                                                 │
│  RECENTLY USED                              ← Tech's recent picks│
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐ Tread depth below 3mm                 Used yesterday  │   │
│  │ ☐ Tread depth within legal limit        Used 2 days ago │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SAFETY CRITICAL                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐ Tread depth below legal limit (1.6mm)                 │   │
│  │   → Auto: 🔴 Red  |  Follow-up: Immediate               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  WEAR ITEMS                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☑ Tread depth below 3mm — approaching limit             │   │
│  │   → Auto: 🟡 Amber  |  Follow-up: 3 months              │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐ Uneven wear pattern — possible alignment issue        │   │
│  │   → Auto: 🟡 Amber  |  Follow-up: Check alignment       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  POSITIVE                                        ← Green reasons │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐ Tread depth within specification                      │   │
│  │   → Auto: 🟢 Green                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☐ Tyre in good condition — no defects                   │   │
│  │   → Auto: 🟢 Green                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  FOLLOW-UP RECOMMENDATION                                       │
│  ┌────────────────────┐  ┌─────────────────────────────────┐   │
│  │  In 3 months     ▼ │  │ Recommend replacement soon      │   │
│  └────────────────────┘  └─────────────────────────────────┘   │
│  Presets: [None] [1 month] [3 months] [6 months] [Next MOT]    │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  📝 Add Custom Note                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Type additional observations...                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ☐ Submit as new reason for manager review                     │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      Save & Continue                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Reason Selection Logic

```typescript
function onReasonSelect(reason: ItemReason, selected: boolean) {
  if (selected) {
    selectedReasons.push(reason.id);
    
    // Auto-set RAG from highest severity selected reason
    const highestRag = getHighestRagFromReasons(selectedReasons);
    if (currentRag !== highestRag) {
      setRag(highestRag);
      showToast(`Status auto-set to ${highestRag} based on selected reason`);
    }
    
    // Auto-populate follow-up if reason has suggestion
    if (reason.suggested_follow_up_days && !followUpDays) {
      setFollowUpDays(reason.suggested_follow_up_days);
      setFollowUpText(reason.suggested_follow_up_text);
    }
  } else {
    selectedReasons = selectedReasons.filter(id => id !== reason.id);
    recalculateAutoRag();
  }
}

// RAG priority: red > amber > green
function getHighestRagFromReasons(reasonIds: string[]): string {
  const reasons = reasonIds.map(id => getReason(id));
  if (reasons.some(r => r.default_rag === 'red')) return 'red';
  if (reasons.some(r => r.default_rag === 'amber')) return 'amber';
  return 'green';
}
```

### 5.3 Custom Reason Submission

When tech checks "Submit as new reason for manager review":

```typescript
async function submitCustomReason() {
  // Get item_type if applicable, so manager can decide scope
  const item = await getTemplateItem(currentItem.id);
  
  await api.post('/api/v1/reason-submissions', {
    template_item_id: currentItem.id,
    item_type: item.item_type,  // Included for manager's reference
    reason_text: customNoteText,
    notes: `Submitted during inspection of ${vehicle.registration}`,
    health_check_id: healthCheck.id,
    check_result_id: checkResult.id
  });
  
  showToast('Reason submitted for manager review');
}
```

---

## 6. SERVICE ADVISOR UI

### 6.1 Viewing Reasons on Health Check

Show selected reasons and descriptions, **including green items**:

```
┌─────────────────────────────────────────────────────────────────┐
│ 🟡 Advisory Items (2 items)                             £245.00  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  > Front Left Tyre                                      £89.00  │
│                                                                 │
│    ┌─────────────────────────────────────────────────────────┐  │
│    │ REASONS:                                                │  │
│    │ • Tread depth below 3mm — approaching limit             │  │
│    │                                                         │  │
│    │ TECHNICAL NOTES:                                        │  │
│    │ Front left tyre measuring 2.8mm tread depth. Legal      │  │
│    │ limit is 1.6mm. At current wear rate, estimate 2-3      │  │
│    │ months before reaching minimum. Recommend replacement   │  │
│    │ to maintain safe braking distance in wet conditions.    │  │
│    │                                                         │  │
│    │ CUSTOMER MESSAGE:                           [✏️ Edit]   │  │
│    │ ┌─────────────────────────────────────────────────────┐ │  │
│    │ │ Your front left tyre is getting low on tread.       │ │  │
│    │ │ While it's still legal, we'd recommend replacing    │ │  │
│    │ │ it soon to keep you safe, especially in wet         │ │  │
│    │ │ weather. We can do this today while the car is      │ │  │
│    │ │ with us.                                            │ │  │
│    │ └─────────────────────────────────────────────────────┘ │  │
│    │                                                         │  │
│    │ FOLLOW-UP: Recommend replacement within 3 months        │  │
│    │                                                         │  │
│    │ 📷 Photos (1)  [View]                                   │  │
│    └─────────────────────────────────────────────────────────┘  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ 🟢 All OK (24 items)                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  > Front Right Tyre                                        ✓    │
│    └─ Tread depth within specification (5.2mm)                  │
│                                                                 │
│  > Rear Left Tyre                                          ✓    │
│    └─ Tread depth within specification (4.8mm)                  │
│                                                                 │
│  > Front Brakes                                            ✓    │
│    └─ Pads and discs in good condition                         │
│                                                                 │
│  [Show all 24 items...]                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Multi-Reason Display (Bulleted List)

When multiple reasons selected for an item:

```
┌─────────────────────────────────────────────────────────────────┐
│ CUSTOMER MESSAGE:                                    [✏️ Edit]  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ We identified the following with your front left tyre:       │ │
│ │                                                             │ │
│ │ • The tread is getting low at 2.8mm. While still legal,     │ │
│ │   we recommend replacing soon for best grip in wet weather. │ │
│ │                                                             │ │
│ │ • There's some uneven wear which could indicate an          │ │
│ │   alignment issue. We can check this for you.               │ │
│ │                                                             │ │
│ │ We'd suggest addressing these within the next 3 months.     │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. ADMIN UI — REASON MANAGEMENT

### 7.1 Settings > Reason Library (Grouped View)

```
┌─────────────────────────────────────────────────────────────────┐
│  Settings > Reason Library                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Template: [Full Vehicle Health Check           ▼]              │
│                                                                 │
│  VIEW BY:  [● Item Types]  [○ Individual Items]                │
│                                                                 │
│  🔍 Search...                                                   │
│                                                                 │
│  [🤖 Generate All Missing]    Pending Submissions: 3 ⚠️         │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  GROUPED BY TYPE (reasons apply to all items of this type)      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔵 Tyres (4 items)                                      │   │
│  │    8 reasons  |  156 uses  |  74% approval  |    [Edit] │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔵 Brake Assemblies (2 items)                           │   │
│  │    6 reasons  |  89 uses   |  82% approval  |    [Edit] │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔵 Fluid Levels (4 items)                               │   │
│  │    5 reasons  |  67 uses   |  91% approval  |    [Edit] │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  UNIQUE ITEMS (have their own specific reasons)                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ○ Drive Belt                                            │   │
│  │   8 reasons  |  47 uses   |  78% approval  |     [Edit] │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ○ Battery                                               │   │
│  │   5 reasons  |  23 uses   |  85% approval  |     [Edit] │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  ORGANIZATION TONE: [Friendly ▼]                                │
│  Used for AI-generated descriptions                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Edit Reasons for Item Type

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back    Tyres — Reasons                         [+ Add New]  │
│  Applies to: Front Left, Front Right, Rear Left, Rear Right     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [🤖 Generate with AI]   [Reorder]                             │
│                                                                 │
│  🔴 SAFETY CRITICAL                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☰ Tread depth below legal limit (1.6mm)                 │   │
│  │   🔴 Red  |  ✓ Reviewed  |  12 uses  |  95% approved    │   │
│  │   Follow-up: Immediate replacement                       │   │
│  │                                          [Edit] [Delete] │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  🟡 WEAR ITEMS                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☰ Tread depth below 3mm                                 │   │
│  │   🟡 Amber  |  ✓ Reviewed  |  89 uses  |  74% approved  │   │
│  │   Follow-up: 3 months                                    │   │
│  │                                          [Edit] [Delete] │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☰ Uneven wear pattern                                   │   │
│  │   🟡 Amber  |  🤖 AI  |  34 uses  |  68% approved       │   │
│  │   Follow-up: Check alignment                             │   │
│  │                                          [Edit] [Delete] │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  🟢 POSITIVE                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☰ Tread depth within specification                      │   │
│  │   🟢 Green  |  ✓ Reviewed  |  156 uses                  │   │
│  │                                          [Edit] [Delete] │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ☰ Tyre in good condition                                │   │
│  │   🟢 Green  |  ✓ Reviewed  |  142 uses                  │   │
│  │                                          [Edit] [Delete] │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  ⚠️ 1 reason never used — consider removing                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Add/Edit Reason Modal

```
┌─────────────────────────────────────────────────────────────────┐
│  Add Reason — Tyres                                        ✕    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Applies to: [● All tyre items] [○ Specific item only]         │
│                                                                 │
│  Reason Text (what technician sees) *                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Tread depth below 3mm                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Category                           Default Status              │
│  ┌────────────────────┐            ┌────────────────────┐      │
│  │ Wear Item        ▼ │            │ 🟡 Amber         ▼ │      │
│  └────────────────────┘            └────────────────────┘      │
│                                                                 │
│  Technical Description (for service advisor)                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Tyre tread depth measured at 2.8mm. Legal minimum is    │   │
│  │ 1.6mm. At current wear rate, approximately 2-3 months   │   │
│  │ remaining before reaching legal limit. Reduced tread    │   │
│  │ depth affects braking distance, particularly in wet.    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Customer Description (sent to customer)                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Your tyre is getting low on tread. While it's still     │   │
│  │ legal, we'd recommend replacing it soon to keep you     │   │
│  │ safe, especially in wet weather. Good tread helps your  │   │
│  │ car stop quickly when you need it to.                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│  [🤖 Regenerate with AI]                                       │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  FOLLOW-UP SUGGESTION (tech can override)                       │
│  ┌────────────────────┐  ┌─────────────────────────────────┐   │
│  │  90 days        ▼ │  │ Recommend replacement within 3   │   │
│  └────────────────────┘  │ months                          │   │
│  Presets: [None] [30] [90] [180] [365]                         │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  Usage: 89 times  |  Last used: yesterday  |  74% approved     │
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐                          │
│  │    Cancel     │  │     Save      │                          │
│  └───────────────┘  └───────────────┘                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.4 Pending Submissions Review (Workshop Manager)

```
┌─────────────────────────────────────────────────────────────────┐
│  Settings > Reason Submissions                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PENDING REVIEW (3)                                             │
│  Submitted by technicians — approve to add to reason library    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ "Sidewall damage from kerbing"                          │   │
│  │                                                         │   │
│  │ For: Tyres (all 4 items)    OR    Front Left Tyre only  │   │
│  │ Submitted by: Mike (Technician) — 2 hours ago           │   │
│  │ Context: VHC for AB12 CDE                               │   │
│  │                                                         │   │
│  │ Tech notes: "Customer mentioned hitting kerb. Visible   │   │
│  │ scuff mark on sidewall. Not a common reason in list."   │   │
│  │                                                         │   │
│  │ ┌───────────────┐  ┌───────────────┐                    │   │
│  │ │    Reject     │  │    Approve    │                    │   │
│  │ └───────────────┘  └───────────────┘                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  When approving, you'll be asked to:                            │
│  • Choose if it applies to all items of this type or just one   │
│  • Add technical and customer descriptions                      │
│  • Set the default RAG status and category                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.5 Approval Modal (When Manager Approves)

```
┌─────────────────────────────────────────────────────────────────┐
│  Approve Reason Submission                                 ✕    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Original submission: "Sidewall damage from kerbing"            │
│  Submitted by: Mike (Technician)                                │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  SCOPE                                                          │
│  [● Add to ALL Tyre items]  [○ Add to Front Left Tyre only]    │
│                                                                 │
│  Reason Text (edit if needed)                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Sidewall damage from kerbing                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Category                           Default Status              │
│  ┌────────────────────┐            ┌────────────────────┐      │
│  │ Safety Critical  ▼ │            │ 🟡 Amber         ▼ │      │
│  └────────────────────┘            └────────────────────┘      │
│                                                                 │
│  Technical Description *                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ [🤖 Generate]  or type manually...                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Customer Description *                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ [🤖 Generate]  or type manually...                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐                          │
│  │    Cancel     │  │ Approve & Add │                          │
│  └───────────────┘  └───────────────┘                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. CUSTOMER PORTAL

### 8.1 Display Customer Descriptions (Including Green)

```
┌─────────────────────────────────────────────────────────────────┐
│ 🟡 ADVISORY — WORTH ADDRESSING                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  FRONT LEFT TYRE                                        £89.00  │
│  ───────────────────────────────────────────────────────────── │
│  Your tyre is getting low on tread. While it's still legal,    │
│  we'd recommend replacing it soon to keep you safe, especially │
│  in wet weather. Good tread helps your car stop quickly when   │
│  you need it to.                                               │
│                                                                 │
│  ⏱️ Recommend addressing within 3 months                        │
│                                                                 │
│  📷 View Photo                                                  │
│                                                                 │
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │   ✓ Approve Work    │  │   ✗ Decline         │              │
│  └─────────────────────┘  └─────────────────────┘              │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│ 🟢 CHECKED & ALL OK                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  We've thoroughly inspected these items and they're all in      │
│  good condition:                                                │
│                                                                 │
│  ✓ Front Right Tyre — Good tread depth (5.2mm)                 │
│  ✓ Rear Tyres — Good tread depth                               │
│  ✓ Front Brakes — Pads and discs in good condition             │
│  ✓ Rear Brakes — Pads and discs in good condition              │
│  ✓ Battery — Holding charge well                               │
│  ✓ All Lights — Working correctly                              │
│                                                                 │
│  [See all 24 items checked...]                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. STARTER TEMPLATE SYSTEM

### 9.1 Purpose
Allow new organizations to start with a pre-built library of reasons instead of generating from scratch.

### 9.2 Workflow

1. **Build Master Library:** Generate AI reasons for your org, review and refine them
2. **Mark as Starter:** Super admin marks reviewed reasons as `is_starter_template = true`
3. **New Org Setup:** When new org is created, automatically copy starter reasons
4. **Customization:** New org can edit, add, or remove reasons as needed

### 9.3 Admin UI (Super Admin)

```
┌─────────────────────────────────────────────────────────────────┐
│  Super Admin > Starter Template                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Source Organization: [Leo's Garage              ▼]            │
│                                                                 │
│  Total Reasons: 156                                             │
│  Marked as Starter: 142                                         │
│  Pending Review: 14                                             │
│                                                                 │
│  [Mark All Reviewed as Starter]  [Preview Starter Set]          │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  When new organization is created:                              │
│  ☑ Automatically copy starter reasons                          │
│  ☐ Let org admin choose to copy                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. IMPLEMENTATION CHECKLIST

### Phase 1: Database & API Foundation (25-30 iterations)
- [ ] Add `item_type` column to template_items table
- [ ] Update existing template items with appropriate item_types
- [ ] Create reason_categories table and seed data (including 'positive')
- [ ] Add `reason_tone` to organization_settings
- [ ] Create item_reasons table with dual-link (template_item_id OR item_type)
- [ ] Create reason_submissions table
- [ ] Create check_result_reasons junction table with approval tracking
- [ ] Add custom_reason_text to check_results
- [ ] Create `get_reasons_for_item` function
- [ ] Create triggers for usage_count and approval stats
- [ ] Create starter reasons copy function
- [ ] Add RLS policies
- [ ] Create CRUD API for item_reasons (by item and by type)
- [ ] Create API for reason_submissions workflow
- [ ] Create API for check_result_reasons
- [ ] Create API for recently used reasons
- [ ] Create API for tone setting

### Phase 2: AI Generation Service (15-20 iterations)
- [ ] Create ai-reasons.ts service with tone support
- [ ] Implement generateReasonsForItem (including green reasons)
- [ ] Implement generateReasonsForItemType
- [ ] Implement generateAllReasonsForTemplate
- [ ] Create API endpoints for generation
- [ ] Add Anthropic API key to environment
- [ ] Test generation with both tones

### Phase 3: Technician UI (25-30 iterations)
- [ ] Create ReasonSelector component
- [ ] Show reasons for ALL RAG statuses (red, amber, green)
- [ ] Integrate with inspection flow
- [ ] Auto-RAG from selected reasons
- [ ] Multiple selection support
- [ ] Recently Used section at top
- [ ] Search box (if > 10 reasons)
- [ ] Follow-up interval selector with presets
- [ ] Custom note with submission option
- [ ] Save selected reasons to check_result_reasons

### Phase 4: Advisor UI (20-25 iterations)
- [ ] Display selected reasons on health check view
- [ ] Show green items with positive confirmations
- [ ] Show technical description
- [ ] Show customer description (editable)
- [ ] Multi-reason bullet list display
- [ ] Show follow-up recommendations
- [ ] Edit customer description modal
- [ ] Save description overrides
- [ ] Include in preview

### Phase 5: Admin UI — Reason Management (25-30 iterations)
- [ ] Reason Library page with grouped/individual view toggle
- [ ] List item types with reason counts and approval rates
- [ ] List unique items with reason counts
- [ ] Edit reasons for item type (applies to all items of type)
- [ ] Edit reasons for specific item
- [ ] Add/Edit reason modal with follow-up fields
- [ ] Delete reason (soft delete)
- [ ] Reorder reasons (drag & drop)
- [ ] AI generate button per item/type
- [ ] Bulk generate button
- [ ] Mark as reviewed toggle
- [ ] AI badge indicator
- [ ] Unused reasons warning
- [ ] Tone setting selector

### Phase 6: Admin UI — Submissions Review (15-20 iterations)
- [ ] Pending submissions list
- [ ] Approve flow with scope selection (type vs specific)
- [ ] AI-assist for generating descriptions during approval
- [ ] Reject flow with notes
- [ ] Notification badge for pending count
- [ ] Notify tech of approval/rejection

### Phase 7: Admin UI — Analytics (10-15 iterations)
- [ ] Reason usage statistics page
- [ ] Top used reasons with approval rates
- [ ] Unused reasons list
- [ ] Approval rate trends
- [ ] Usage by technician

### Phase 8: Customer Portal & PDF (15-20 iterations)
- [ ] Display customer descriptions in portal
- [ ] Display green items as "Checked & OK" section
- [ ] Multi-reason bullet format
- [ ] Show follow-up recommendations
- [ ] Include in PDF generation
- [ ] Style appropriately per RAG status
- [ ] Track customer approval/decline

### Phase 9: Starter Template System (10-15 iterations)
- [ ] Super admin UI to mark starter reasons
- [ ] Function to copy reasons to new org
- [ ] Integrate with org creation flow
- [ ] Preview starter set

### Phase 10: Polish (10-15 iterations)
- [ ] UK English spell check on all AI content
- [ ] Test with various template items and types
- [ ] Performance optimization for large reason sets
- [ ] Error handling
- [ ] Mobile UI optimization

---

## 11. PROMPTS

### Phase 1: Database & API
```bash
claude -p "Read docs/vhc-reasons-spec.md. Complete Phase 1:

1. Add item_type VARCHAR(50) to template_items table
2. Update existing template items with item_types: tyre, brake_assembly, wiper, fluid_level, etc.
3. Create reason_categories table with 5 categories including 'positive'
4. Add reason_tone to organization_settings (default 'friendly')
5. Create item_reasons table with dual-link support (template_item_id OR item_type)
6. Create reason_submissions table for tech → manager workflow
7. Create check_result_reasons with approval tracking
8. Create get_reasons_for_item() function that merges specific + type-based reasons
9. Create triggers for usage_count and approval stats
10. Add all RLS policies
11. Create CRUD API endpoints

Seed the standard item_types and reason categories." --dangerously-skip-permissions
```

### Generate Initial Data
```bash
claude -p "Read docs/vhc-reasons-spec.md. Generate reasons for all item types and unique items:

1. Get the organization's tone setting (friendly or premium)
2. For each item_type (tyre, brake_assembly, etc.): Generate 8-12 reasons including RED, AMBER, and GREEN
3. For each unique item (Drive Belt, Battery, etc.): Generate 8-12 reasons
4. Include suggested_follow_up_days and text where appropriate
5. Mark all as ai_generated=true, ai_reviewed=false

Use UK English throughout." --dangerously-skip-permissions
```

---

*Document Version: 2.0*
*Created: January 2026*
*Updated: January 2026*

**Key Changes in v2.0:**
- Green reasons for positive findings
- Item type grouping to reduce duplication
- Tech-selected follow-up intervals
- Approval rate tracking (background analytics)
- Workshop manager approval for tech submissions
- Organization tone setting (premium/friendly)
