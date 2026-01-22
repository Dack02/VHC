# VHC API Route Structure Analysis

> Generated for sharing with another Claude instance for OpenAPI documentation advice

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Route Files | 59 |
| Total HTTP Endpoints | ~640+ |
| Framework | Hono v4 (ESM) |
| Validation | Manual inline (no Zod) |
| Response Types | Inline constructed (no unified schema) |
| Database | Supabase PostgreSQL |

---

## 1. Route Inventory

### File Structure Overview

```
src/routes/
├── [28 top-level files]
│   ├── auth.ts, customers.ts, dashboard.ts, dms.ts, dms-settings.ts
│   ├── items.ts, labour-codes.ts, media.ts, notifications.ts
│   ├── onboarding.ts, org-admin.ts, organizations.ts, pricing.ts
│   ├── public.ts, reports.ts, results.ts, sites.ts, suppliers.ts
│   ├── templates.ts, tyres.ts, users.ts, vehicles.ts
│   └── [reason-related: declined-reasons.ts, deleted-reasons.ts, supplier-types.ts]
│
├── admin/ [7 files]
│   ├── organizations.ts (27 endpoints)
│   ├── ai-settings.ts, ai-usage.ts, platform.ts
│   ├── stats.ts, starter-reasons.ts, reason-types.ts
│
├── health-checks/ [10 files]
│   ├── index.ts (aggregator)
│   ├── crud.ts, status.ts, repair-items-hc.ts, deletion.ts
│   ├── pdf.ts, send-customer.ts, check-results.ts, history.ts
│   └── helpers.ts
│
├── repair-items/ [8 files]
│   ├── index.ts (aggregator)
│   ├── repair-items.ts, parts.ts, labour.ts, outcomes.ts
│   ├── options.ts, workflow.ts, helpers.ts
│
└── reasons/ [8 files]
    ├── index.ts (aggregator)
    ├── item-reasons.ts, check-result-reasons.ts, reason-types.ts
    ├── ai.ts, submissions.ts, template-stats.ts, helpers.ts
```

### Endpoint Count by Module

| Route Module | Endpoints | Description |
|--------------|-----------|-------------|
| admin/organizations.ts | 27 | Super admin org management |
| repair-items/repair-items.ts | 24 | Repair item CRUD |
| templates.ts | 21 | Template/section/item management |
| org-admin.ts | 21 | Organization settings |
| repair-items/parts.ts | 21 | Parts allocation |
| tyres.ts | 20 | Tyre measurements |
| dms-settings.ts | 20 | DMS configuration |
| repair-items/labour.ts | 19 | Labour allocation |
| repair-items/outcomes.ts | 18 | Approval workflows |
| admin/ai-usage.ts | 17 | AI usage tracking |
| health-checks/status.ts | 16 | Status transitions |
| onboarding.ts | 16 | Org setup wizard |
| public.ts | 15 | Customer portal (no auth) |
| results.ts | 15 | Check results |
| health-checks/repair-items-hc.ts | 15 | HC-linked repair items |
| reasons/ai.ts | 14 | AI reason generation |
| media.ts | 13 | Photo upload/storage |
| admin/platform.ts | 13 | Platform settings |

---

## 2. Current Pattern - Representative Route Example

**File: `src/routes/items.ts`** (Template items management)

```typescript
import { Hono } from 'hono'
import { supabaseAdmin } from '../lib/supabase.js'
import { authMiddleware, authorize } from '../middleware/auth.js'

const items = new Hono()

// Global auth middleware
items.use('*', authMiddleware)

// GET /api/v1/template-items/:id
items.get('/template-items/:id',
  authorize(['super_admin', 'org_admin', 'site_admin', 'service_advisor', 'technician']),
  async (c) => {
    try {
      const auth = c.get('auth')
      const { id } = c.req.param()

      const { data: item, error } = await supabaseAdmin
        .from('template_items')
        .select(`
          id, name, description, item_type, reason_type, config, is_required, sort_order,
          section:template_sections(
            id, name,
            template:check_templates(id, name, organization_id)
          )
        `)
        .eq('id', id)
        .single()

      if (error || !item) {
        return c.json({ error: 'Template item not found' }, 404)
      }

      // Verify org ownership
      const section = (item.section as { template: { organization_id: string }[] }[] | null)?.[0]
      const template = section?.template?.[0]
      if (!template || template.organization_id !== auth.orgId) {
        return c.json({ error: 'Template item not found' }, 404)
      }

      // Transform snake_case to camelCase in response
      return c.json({
        id: item.id,
        name: item.name,
        description: item.description,
        itemType: item.item_type,
        reasonType: item.reason_type,
        config: item.config,
        isRequired: item.is_required,
        sortOrder: item.sort_order
      })
    } catch (error) {
      console.error('Get template item error:', error)
      return c.json({ error: 'Failed to get template item' }, 500)
    }
  }
)

// POST /api/v1/sections/:sectionId/items
items.post('/sections/:sectionId/items',
  authorize(['super_admin', 'org_admin', 'site_admin']),
  async (c) => {
    try {
      const auth = c.get('auth')
      const { sectionId } = c.req.param()
      const body = await c.req.json()
      const { name, description, itemType, config, isRequired, reasonType } = body

      // Manual validation
      if (!name) {
        return c.json({ error: 'Item name is required' }, 400)
      }

      // Verify section ownership
      const { data: section } = await supabaseAdmin
        .from('template_sections')
        .select('id, template:check_templates(organization_id)')
        .eq('id', sectionId)
        .single()

      const sectionTemplate = (section?.template as { organization_id: string }[] | null)?.[0]
      if (!section || sectionTemplate?.organization_id !== auth.orgId) {
        return c.json({ error: 'Section not found' }, 404)
      }

      // Insert with snake_case
      const { data: item, error } = await supabaseAdmin
        .from('template_items')
        .insert({
          section_id: sectionId,
          name,
          description,
          item_type: itemType || 'rag',
          config: config || {},
          is_required: isRequired ?? true,
          reason_type: reasonType || null
        })
        .select()
        .single()

      if (error) {
        return c.json({ error: error.message }, 500)
      }

      return c.json({ id: item.id, name: item.name, /* ... */ }, 201)
    } catch (error) {
      console.error('Add item error:', error)
      return c.json({ error: 'Failed to add item' }, 500)
    }
  }
)

// PATCH /api/v1/items/:itemId
items.patch('/items/:itemId',
  authorize(['super_admin', 'org_admin', 'site_admin']),
  async (c) => {
    // Partial update pattern
    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    // ...
  }
)

export default items
```

### Key Patterns Observed

| Pattern | Implementation |
|---------|----------------|
| Router creation | `new Hono()` per feature module |
| Auth middleware | `items.use('*', authMiddleware)` global |
| Authorization | `authorize(['role1', 'role2'])` per route |
| Params | `c.req.param()` |
| Query strings | `c.req.query()` |
| Request body | `await c.req.json()` |
| Auth context | `c.get('auth')` returns `{ user, orgId }` |
| DB queries | `supabaseAdmin.from('table').select().eq()` |
| Org filtering | Always `.eq('organization_id', auth.orgId)` |
| Success response | `c.json(data, statusCode?)` |
| Error response | `c.json({ error: string }, statusCode)` |

---

## 3. Validation Approach

### Current State: No Schema Validation Library

**Zod is NOT used anywhere in the API.** All validation is manual inline checks.

### Validation Patterns Found

```typescript
// 1. Required field check
if (!name || !name.trim()) {
  return c.json({ error: 'Supplier name is required' }, 400)
}

// 2. Type checking
if (!itemIds || !Array.isArray(itemIds)) {
  return c.json({ error: 'itemIds array is required' }, 400)
}

// 3. Length validation
if (!q || q.length < 2) {
  return c.json({ customers: [] })
}

// 4. Enum/value validation
const validStatuses = ['pending', 'approved', 'declined']
if (!validStatuses.includes(status)) {
  return c.json({ error: 'Invalid status' }, 400)
}

// 5. Partial update pattern (undefined checks)
const updateData: Record<string, unknown> = {}
if (name !== undefined) updateData.name = name
if (code !== undefined) updateData.code = code?.toUpperCase()?.trim() || null

// 6. Ownership/access validation
if (orgId !== auth.orgId) {
  return c.json({ error: 'Organization not found' }, 404)
}

// 7. Relationship validation via DB query
const { data: section } = await supabaseAdmin
  .from('template_sections')
  .select('id, template:check_templates(organization_id)')
  .eq('id', sectionId)
  .single()

if (!section || section.template?.organization_id !== auth.orgId) {
  return c.json({ error: 'Section not found' }, 404)
}
```

### Error Handling Infrastructure (Underutilized)

There's a custom error system in `src/lib/errors.ts` but it's not widely used:

```typescript
// Available but rarely used
export const Errors = {
  notFound: (resource: string) => new ApiError(/*...*/),
  unauthorized: () => new ApiError(/*...*/),
  validationFailed: (message: string, details?: Record<string, unknown>) => new ApiError(/*...*/),
  // ...
}

// Most routes use inline instead:
return c.json({ error: 'Not found' }, 404)  // ← This pattern dominates
```

---

## 4. Request/Response Types

### Shared Types Package (`@vhc/shared`)

Located at `packages/shared/src/types/index.ts`:

```typescript
// User roles
export type UserRole = 'super_admin' | 'org_admin' | 'site_admin' | 'service_advisor' | 'technician'

// Health check statuses (28 states)
export type HealthCheckStatus =
  | 'created' | 'assigned' | 'in_progress' | 'paused' | 'tech_completed'
  | 'awaiting_review' | 'awaiting_pricing' | 'awaiting_parts' | 'ready_to_send'
  | 'sent' | 'delivered' | 'opened' | 'partial_response' | 'authorized'
  | 'declined' | 'expired' | 'completed' | 'cancelled'

// RAG status
export type RagStatus = 'green' | 'amber' | 'red' | 'not_checked'

// Core domain types
export interface Organization {
  id: string; name: string; slug: string; settings: Record<string, unknown>
  createdAt: Date; updatedAt: Date
}

export interface User {
  id: string; authId?: string; organizationId: string; siteId?: string
  email: string; firstName: string; lastName: string; phone?: string
  role: UserRole; isActive: boolean; settings: Record<string, unknown>
  createdAt: Date; updatedAt: Date
}

export interface Vehicle {
  id: string; organizationId: string; customerId?: string; registration: string
  vin?: string; make?: string; model?: string; year?: number
  color?: string; fuelType?: string; engineSize?: string
  createdAt: Date; updatedAt: Date
}

// ... more types for Customer, HealthCheck, RepairItem, CheckTemplate, etc.
```

### API-Specific Types

**Auth Context** (`src/middleware/auth.ts`):
```typescript
export interface AuthUser {
  id: string
  authId: string
  email: string
  firstName: string
  lastName: string
  role: string
  organizationId: string
  siteId: string | null
  isActive: boolean
  isOrgAdmin?: boolean
  isSiteAdmin?: boolean
}

export interface AuthContext {
  user: AuthUser
  orgId: string
}
```

**PDF Generator Types** (`src/services/pdf-generator/types.ts`):
```typescript
export interface HealthCheckPDFData {
  id: string
  status: string
  created_at: string
  vehicle: { registration: string; make?: string; model?: string; year?: number }
  customer: { first_name: string; last_name: string; email?: string }
  technician?: { first_name: string; last_name: string }
  results: ResultData[]
  repairItems: RepairItemData[]
  // ... extensive typing for PDF generation
}
```

### Response Patterns (No Unified Schema)

Responses are constructed inline without shared types:

```typescript
// Success - manual camelCase transformation
return c.json({
  id: item.id,
  name: item.name,
  itemType: item.item_type,  // snake_case → camelCase
  createdAt: item.created_at
})

// Error - inconsistent structure
return c.json({ error: 'Customer not found' }, 404)
return c.json({ error: error.message }, 500)

// Paginated
return c.json({
  customers: data?.map(transformCustomer),
  total: count,
  limit: parseInt(limit),
  offset: parseInt(offset)
})
```

---

## 5. File Structure Analysis

### Architectural Pattern

**Feature-based routing with nested subdirectories for complex features.**

### Router Mounting (`src/index.ts`)

```typescript
import auth from './routes/auth.js'
import healthChecks from './routes/health-checks/index.js'
import repairItems from './routes/repair-items/index.js'
import reasons from './routes/reasons/index.js'
import adminRoutes from './routes/admin/index.js'

const app = new Hono()

// Mount feature routers
app.route('/api/v1/auth', auth)
app.route('/api/v1/health-checks', healthChecks)
app.route('/api/v1', repairItems)           // Multiple paths within
app.route('/api/v1/reasons', reasons)
app.route('/api/v1/admin', adminRoutes)

// Public routes (no auth)
app.route('/api/public', publicRoutes)
```

### Sub-router Aggregation Pattern

`health-checks/index.ts`:
```typescript
import { Hono } from 'hono'
import { authMiddleware } from '../../middleware/auth.js'

import crudRouter from './crud.js'
import statusRouter from './status.js'
import pdfRouter from './pdf.js'
import deletionRouter from './deletion.js'

const healthChecks = new Hono()
healthChecks.use('*', authMiddleware)

// Mount sub-routers (order matters for param routes!)
healthChecks.route('/', pdfRouter)        // /:id/pdf
healthChecks.route('/', statusRouter)     // /:id/status/*
healthChecks.route('/', deletionRouter)   // /:id/delete
healthChecks.route('/', crudRouter)       // GET /, POST /, GET /:id, PATCH /:id

export default healthChecks
```

### Key Design Decisions

1. **Feature-based organization**: Each domain area gets its own file/folder
2. **Nested routers**: Complex features (health-checks, repair-items, reasons) use sub-files
3. **Helper modules**: Shared logic in `helpers.ts` files (no endpoints)
4. **Single responsibility**: Most files handle one resource type
5. **Order-dependent mounting**: Specific routes before generic ones to avoid conflicts
6. **Auth middleware**: Applied at router level, not app level (allows public routes)

---

## Recommendations for OpenAPI Documentation

Based on this analysis, here are considerations for implementing OpenAPI:

### Challenges

1. **No schema validation**: No Zod means no automatic schema generation
2. **Inline response types**: No unified response interfaces to document
3. **Manual validation**: Validation rules scattered across handlers
4. **640+ endpoints**: Large surface area to document
5. **Snake/camel case**: Transformation happens in handlers, not consistently

### Suggested Approaches

1. **Incremental adoption**: Start with high-traffic routes (health-checks, repair-items)
2. **Zod introduction**: Add Zod schemas per-route to enable `@hono/zod-openapi`
3. **Response standardization**: Create wrapper types for success/error responses
4. **Code generation**: Consider generating types from OpenAPI spec (design-first)

### Hono-Compatible Options

- `@hono/zod-openapi` - Zod schemas → OpenAPI (requires Zod adoption)
- `hono-openapi` - Decorator-based approach
- Manual OpenAPI spec with code references

---

## Quick Reference

### API Base URLs
- Development: `http://localhost:5180/api/v1/`
- Public endpoints: `http://localhost:5180/api/public/`

### Common Query Parameters
- `limit` / `offset` - Pagination
- `status` - Filter by status (comma-separated)
- `q` - Search query
- `include` - Related data to include

### Auth Header
```
Authorization: Bearer <supabase_jwt_token>
```

### Multi-tenant Filtering
All queries must include organization filtering:
```typescript
.eq('organization_id', auth.orgId)
```
