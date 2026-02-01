# VHC (Vehicle Health Check) - Monorepo

## Project Overview
Multi-tenant SaaS platform for automotive dealerships to manage vehicle health checks/inspections. Built as a Turborepo monorepo with three apps sharing a PostgreSQL database via Supabase.

## App-Specific Guides
For detailed conventions when working in specific apps, see:
- **API Backend:** `apps/api/.claude`
- **Web Dashboard:** `apps/web/.claude`
- **Mobile PWA:** `apps/mobile/.claude`

## Monorepo Structure
```
VHC_v2/
├── apps/
│   ├── api/          # Hono/Node.js backend (port 5180)
│   ├── web/          # React dashboard for advisors/managers (port 5181)
│   └── mobile/       # React PWA for technicians (port 5182)
├── packages/
│   └── shared/       # Shared TypeScript types (vhc-shared)
├── supabase/
│   ├── migrations/   # SQL migrations (timestamp format)
│   └── config.toml   # Local dev config
├── docs/             # Feature specs, implementation plans
└── turbo.json        # Build configuration
```

## Technology Stack
| Layer | Technology |
|-------|------------|
| API | Hono v4 + Node.js (ESM) |
| Web | React 18 + Vite + Tailwind |
| Mobile | React 18 + Vite + Tailwind (PWA) |
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth (JWT) |
| Real-time | Socket.io |
| Queue | BullMQ + Redis |
| AI | Anthropic Claude API |

## Shared Types Package
Import types from `vhc-shared`:
```typescript
import type { User, HealthCheck, RepairItem } from 'vhc-shared/types'
```

Key types: Organization, Site, User, Customer, Vehicle, HealthCheck, RepairItem, CheckTemplate

## User Role Hierarchy
```
super_admin (5) - Platform admin, cross-org access
org_admin (4)   - Organization admin
site_admin (3)  - Site-level admin
service_advisor (2) - Creates/manages health checks
technician (1)  - Performs inspections
```

Authorization pattern (API):
```typescript
import { authorizeMinRole } from '../middleware/auth.js'
router.delete('/:id', authorizeMinRole('org_admin'), handler)
```

## Health Check Workflow
28 status states tracking inspection → pricing → customer → completion:
- `inspection_pending` → `inspection_in_progress` → `inspection_complete`
- `pricing_pending` → `pricing_in_progress` → `pricing_complete`
- `advisor_review` → `customer_pending` → `customer_viewed`
- `customer_approved` / `customer_partial` / `customer_declined`
- `work_authorized` → `work_in_progress` → `work_complete`
- Final states: `closed`, `archived`, `cancelled`

## Multi-Tenancy
**CRITICAL:** Always filter by organization_id:
```typescript
// API queries
.eq('organization_id', auth.user.organization_id)

// Frontend - use session context
const { session } = useAuth()
```

## Database Rules (CRITICAL)
**FORBIDDEN:** `supabase db reset` - This has destroyed data twice before.
See `rules.md` for complete database safety rules.

Safe migration pattern:
```sql
-- Use IF NOT EXISTS for safety
ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar TEXT;
CREATE TABLE IF NOT EXISTS baz (...);
```

Create new migrations only - never modify applied ones:
```bash
# Apply migration
psql -h localhost -p 54422 -U postgres -d postgres -f supabase/migrations/YYYYMMDDHHMMSS_name.sql
```

## RAG Status Convention
Red/Amber/Green status used across all apps:
```tsx
// Colors
bg-rag-red text-white      // Urgent/Pending
bg-rag-amber text-white    // In Progress
bg-rag-green text-white    // Complete/Good

// Item condition status
type RagStatus = 'red' | 'amber' | 'green' | 'na'
```

## Styling Convention
Automotive aesthetic - square edges, no rounded corners:
```tsx
className="rounded-none"  // Apply to buttons, cards, inputs
```

## Error Handling
API uses structured errors:
```typescript
import { Errors } from '../lib/errors.js'
throw Errors.notFound('Customer')
throw Errors.unauthorized()
throw Errors.validationFailed('Invalid email')
```

Frontend uses toast notifications:
```tsx
const toast = useToast()
toast.success('Saved')
toast.error('Failed to save')
```

## Local Development

### Start all apps:
```bash
# Terminal 1 - Supabase (if not running)
cd supabase && supabase start

# Terminal 2 - API
cd apps/api && pnpm dev

# Terminal 3 - Web
cd apps/web && npm run dev

# Terminal 4 - Mobile (optional)
cd apps/mobile && npm run dev
```

### Ports:
- API: http://localhost:5180
- Web: http://localhost:5181
- Mobile: http://localhost:5182
- Supabase Studio: http://localhost:54423
- PostgreSQL: localhost:54422

### Turbo commands:
```bash
npm run dev     # Start all apps
npm run build   # Build all apps
npm run lint    # Type check all apps
```

## Deployment Pipeline
- Push to `dev` → GitHub Actions runs `supabase db push` on dev Supabase → Railway auto-deploys dev services
- Push to `main` → GitHub Actions runs `supabase db push` on production Supabase → Railway auto-deploys production services
- PRs trigger a migration dry-run check (`supabase db push --dry-run`) plus type checking
- GitHub secrets managed via `gh secret set --repo Dack02/VHC` (5 secrets: `SUPABASE_ACCESS_TOKEN`, `DEV_PROJECT_ID`, `DEV_DB_PASSWORD`, `PRODUCTION_PROJECT_ID`, `PRODUCTION_DB_PASSWORD`)
- Workflow files: `.github/workflows/deploy-dev.yml`, `deploy-production.yml`, `ci.yml`

## Key Documentation
- `docs/FEATURE_SPEC.md` - Master feature specification
- `docs/vhc-multi-tenant-spec.md` - Multi-tenancy design
- `docs/repair-groups-pricing-spec.md` - Pricing/labour calculations
- `docs/gemini-dms-integration-plan.md` - DMS integration

## Testing Changes
1. Run relevant app with `npm run dev` or `pnpm dev`
2. For API changes: test with REST client or frontend
3. For frontend changes: test in browser
4. For database changes: verify via Supabase Studio
5. Run `npm run build` before committing to catch TypeScript errors
