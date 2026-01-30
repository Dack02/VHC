# VHC Web Dashboard - Performance Recommendations

## Executive Summary

Three main areas are causing performance issues in the web dashboard:

1. **Bundle size & code splitting** - The entire app ships as a single ~1.3MB monolithic JavaScript bundle. All 50+ page components are eagerly imported in `App.tsx`, meaning users download and parse the entire application on first load regardless of which page they visit.

2. **Dashboard page over-fetching** - The Dashboard component fires 6 API calls on mount, polls every 30 seconds, and triggers full refetches on every WebSocket event. A single status change event causes 3 parallel API calls plus additional fetches for awaiting-arrival and check-in data.

3. **Health Check detail page render overhead** - `RepairItemRow` lacks `React.memo`, so every parent re-render causes all repair item rows to re-render (including their inline modals). Outcome modals (Defer, Decline, Delete) are mounted in the DOM for every row regardless of whether they're open.

---

## 1. Bundle & Build Performance

### Current State

**File:** `apps/web/vite.config.ts`

The Vite config is minimal - only the React plugin, a dev server port, and React alias resolution. There is no:
- Manual chunk splitting (`build.rollupOptions.output.manualChunks`)
- Chunk size warnings configuration
- Compression plugin
- CSS code splitting configuration

**File:** `apps/web/src/App.tsx`

All 50+ page components are imported eagerly at the top of `App.tsx` (lines 1-61). Every route is statically imported:

```typescript
import Dashboard from './pages/Dashboard'
import Users from './pages/Users'
import TemplateList from './pages/Templates/TemplateList'
import TemplateBuilder from './pages/Templates/TemplateBuilder'
// ... 46 more imports
```

This means:
- The login page loads the entire admin portal, all settings pages, template builder, etc.
- The customer portal (`/view/:token`) loads the full dashboard app
- First paint is delayed by parsing ~1.3MB of JavaScript

### Recommended Fix: Route-Level Code Splitting

Convert static imports to `React.lazy()` with `Suspense` boundaries:

```typescript
import { lazy, Suspense } from 'react'

// Eager: only the shell and auth
import Login from './pages/Login'

// Lazy: everything else
const Dashboard = lazy(() => import('./pages/Dashboard'))
const HealthCheckList = lazy(() => import('./pages/HealthChecks/HealthCheckList'))
const HealthCheckDetail = lazy(() => import('./pages/HealthChecks/HealthCheckDetail'))
const TemplateBuilder = lazy(() => import('./pages/Templates/TemplateBuilder'))
const CustomerPortal = lazy(() => import('./pages/CustomerPortal/CustomerPortal'))
// ... etc
```

Wrap route output with a `Suspense` fallback:

```tsx
<Suspense fallback={<PageLoader />}>
  <Routes>
    {/* routes */}
  </Routes>
</Suspense>
```

#### Preloading Frequently-Used Routes

For routes that users navigate between frequently (Dashboard <-> HealthCheckDetail, Dashboard <-> HealthCheckList), preload chunks on hover over navigation links to eliminate perceived delay:

```tsx
const HealthCheckDetail = lazy(() => import('./pages/HealthChecks/HealthCheckDetail'))

// In nav/links that point to health check detail:
<Link
  to={`/health-checks/${id}`}
  onMouseEnter={() => import('./pages/HealthChecks/HealthCheckDetail')}
>
  View Details
</Link>
```

This triggers the chunk download when the user hovers, so by the time they click, the module is already cached. Apply this to the most common navigation paths:
- Dashboard -> Health Check List
- Health Check List -> Health Check Detail
- Dashboard -> Kanban Board

### Recommended Fix: Vite Manual Chunks

Add chunk splitting to `vite.config.ts` to separate vendor code:

```typescript
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['@headlessui/react'],
          'socket': ['socket.io-client'],
        }
      }
    }
  }
})
```

### Impact

- **Login page**: Should drop from ~1.3MB to ~200-300KB (React + auth + login page only)
- **Customer portal**: Loads only portal code, not the full dashboard
- **Admin pages**: Only loaded when admin users navigate there
- **Estimated improvement**: 60-70% reduction in initial bundle size

---

## 2. Dashboard Page Performance

### Current State

**File:** `apps/web/src/pages/Dashboard.tsx`

#### Problem 2a: WebSocket Events Trigger Full Dashboard Refetch

Every WebSocket event (`HEALTH_CHECK_STATUS_CHANGED`, `CUSTOMER_AUTHORIZED`, `CUSTOMER_DECLINED`, `TECHNICIAN_CLOCKED_IN`, `TECHNICIAN_CLOCKED_OUT`) calls `fetchDashboard()` which fires 3 parallel API calls (lines 142-146):

```typescript
const [dashboardData, queuesData, techData] = await Promise.all([
  api<DashboardData>(`/api/v1/dashboard?date_from=...&date_to=...`, { token }),
  api<QueuesData>('/api/v1/dashboard/queues', { token }),
  api<TechnicianWorkload[]>('/api/v1/dashboard/technicians', { token })
])
```

A single status change event refetches the entire dashboard, all queues, and all technician data. In a busy dealership with frequent status changes, this creates a cascade of unnecessary network requests.

Additionally, `handleStatusChange` (line 233) calls both `fetchDashboard()` AND conditionally `fetchAwaitingCheckin()`, meaning some events trigger 4+ API calls.

#### Problem 2b: 30-Second Polling Overlaps With WebSocket

The dashboard polls every 30 seconds (lines 217-222):

```typescript
useEffect(() => {
  fetchDashboard()
  const interval = setInterval(fetchDashboard, 30000)
  return () => clearInterval(interval)
}, [fetchDashboard])
```

This polling runs independently of WebSocket events. If a WebSocket event fires at second 29, the poll fires again at second 30 - redundant work. The polling and WebSocket systems are not coordinated.

#### Problem 2c: Six Separate API Calls on Mount

On initial load, the dashboard fires:
1. `GET /api/v1/dashboard` (metrics)
2. `GET /api/v1/dashboard/queues` (queue data)
3. `GET /api/v1/dashboard/technicians` (technician workload)
4. `GET /api/v1/dms-settings/unactioned` (awaiting arrival)
5. `GET /api/v1/health-checks?status=awaiting_checkin` (awaiting check-in)
6. `GET /api/v1/dms-settings/settings` (DMS enabled check)

### Recommended Fixes

**2a - Debounce WebSocket refetches + optimistic local updates:**

Use a 500ms debounce (not 2 seconds - advisors watching the board need near-real-time updates):

```typescript
const debouncedRefresh = useMemo(
  () => debounce(() => fetchDashboard(), 500, { leading: true, trailing: true }),
  [fetchDashboard]
)
```

Additionally, use the WebSocket event payload to apply optimistic local updates immediately, then reconcile with the debounced full refetch. The `HEALTH_CHECK_STATUS_CHANGED` event already includes `healthCheckId`, `status`, and `vehicleReg` - use these to patch local state without waiting for the API:

```typescript
const handleStatusChange = (data: { healthCheckId: string; status: string; vehicleReg: string }) => {
  // Immediate optimistic update from WS payload
  setQueues(prev => {
    if (!prev) return prev
    // Move item between queue lists based on new status
    // ... patch local queue state using data.healthCheckId and data.status
    return updatedQueues
  })

  // Visual feedback
  setLiveUpdate(`${data.vehicleReg} -> ${data.status.replace('_', ' ')}`)
  setTimeout(() => setLiveUpdate(null), 3000)

  // Debounced full refresh for data consistency
  debouncedRefresh()
}
```

This gives users instant visual feedback while keeping the data consistent.

**2b - Disable polling when WebSocket is connected:**

```typescript
useEffect(() => {
  fetchDashboard()
  // Only poll if WebSocket is disconnected (fallback)
  if (!isConnected) {
    const interval = setInterval(fetchDashboard, 30000)
    return () => clearInterval(interval)
  }
}, [fetchDashboard, isConnected])
```

**2c - Keep endpoints separate, consider stale-while-revalidate:**

Rather than consolidating into a single `/api/v1/dashboard/all` endpoint (which couples frontend layout to backend and prevents per-resource caching), keep the endpoints separate but adopt a stale-while-revalidate pattern.

A library like `@tanstack/react-query` or `swr` would handle this well:

```typescript
const { data: metrics } = useQuery({
  queryKey: ['dashboard-metrics', dateRange],
  queryFn: () => api('/api/v1/dashboard?...', { token }),
  staleTime: 5000, // Consider fresh for 5s
})

const { data: queues } = useQuery({
  queryKey: ['dashboard-queues'],
  queryFn: () => api('/api/v1/dashboard/queues', { token }),
  staleTime: 5000,
})
```

Benefits:
- **Automatic deduplication** - if two components request the same data, only one fetch fires
- **Stale-while-revalidate** - shows cached data immediately, refreshes in background
- **Per-resource cache TTLs** - DMS settings change rarely (cache longer), queues change often (cache shorter)
- **Built-in refetch** - `queryClient.invalidateQueries(['dashboard-queues'])` from WebSocket handlers

This is a larger change and could be treated as a future improvement. The debounce + conditional polling fixes above deliver most of the value with less effort.

### Impact

- **Network requests**: Reduce from 6+ per event to 1 debounced call
- **Server load**: Significant reduction during busy periods
- **UI responsiveness**: Optimistic updates give instant feedback
- **UI stability**: Fewer state updates means less re-rendering

---

## 3. Health Check Detail Page Performance

### Current State

#### Problem 3a: Sequential API Calls in fetchData

**File:** `apps/web/src/pages/HealthChecks/HealthCheckDetail.tsx`

The `fetchData` function (lines 135-316) makes API calls sequentially rather than in parallel:

1. `GET /api/v1/health-checks/:id?include=advisor` (line 153)
2. `GET /api/v1/templates/:templateId` (line 164) - waits for #1
3. `GET /api/v1/health-checks/:id/timeline` (line 172) - could run parallel with #2
4. `GET /api/v1/health-checks/:id/time-entries` (line 181) - conditional, could run parallel
5. `GET /api/v1/organizations/:orgId/checkin-settings` (line 217) - could run parallel
6. `GET /api/v1/health-checks/:id/repair-items` (line 230) - could run parallel

Calls #3 through #6 only depend on #1 (for the health check ID and template ID), but they run sequentially. They should be parallelised with `Promise.all` after call #1 completes.

#### Problem 3b: RepairItemRow Lacks React.memo AND Parent Callbacks Are Not Memoized

**File:** `apps/web/src/pages/HealthChecks/components/RepairItemRow.tsx`
**File:** `apps/web/src/pages/HealthChecks/components/HealthCheckTabContent.tsx`

`RepairItemRow` is a plain function component (line 34) with no `React.memo` wrapper. Each row is ~1000 lines of JSX including complex conditional rendering. When any state changes in the parent `HealthCheckTabContent`, every `RepairItemRow` re-renders.

For a health check with 20 repair items, a single price edit on one item triggers re-renders of all 20 rows.

**Critical:** Adding `React.memo` alone will not help because the parent creates new function references on every render. In `HealthCheckTabContent`, callbacks like `onManageOptions` are inline arrow functions that create new references each render:

```tsx
// This defeats React.memo entirely - new function reference every render
<RepairItemRow
  onManageOptions={() => {
    setOptionsModalItemId(item.id)
    setOptionsModalItemTitle(item.title)
  }}
/>
```

The `renderSpecialDisplay` function (line 270) is also defined inline and recreated on every render. **Both `React.memo` and callback memoization must be implemented together** - doing one without the other provides no benefit.

#### Problem 3c: Outcome Modals Always Mounted Per Row

**File:** `apps/web/src/pages/HealthChecks/components/RepairItemRow.tsx` (lines 990-1007)

Every `RepairItemRow` mounts 3 modal components unconditionally:

```tsx
<DeferModal isOpen={showDeferModal} ... />
<DeclineModal isOpen={showDeclineModal} ... />
<DeleteModal isOpen={showDeleteModal} ... />
```

With 20 repair items, that's 60 modal component instances in the DOM, each with their own state and event listeners, even though at most 1 modal is ever open at a time.

### Recommended Fixes

**3a - Parallelise API calls:**

```typescript
const hcData = await api<FullHealthCheckResponse>(
  `/api/v1/health-checks/${id}?include=advisor`,
  { token: session.accessToken }
)
setHealthCheck(hcData.healthCheck)

// Run remaining calls in parallel
const [templateData, timelineData, timeEntriesData, checkinSettings, repairItemsData] =
  await Promise.allSettled([
    hcData.healthCheck.template_id
      ? api(`/api/v1/templates/${hcData.healthCheck.template_id}`, { token })
      : Promise.resolve({ sections: [] }),
    api(`/api/v1/health-checks/${id}/timeline`, { token }),
    hcData.healthCheck.status === 'in_progress'
      ? api(`/api/v1/health-checks/${id}/time-entries`, { token })
      : Promise.resolve(null),
    user?.organization?.id
      ? api(`/api/v1/organizations/${user.organization.id}/checkin-settings`, { token })
      : Promise.resolve({ checkinEnabled: false }),
    api(`/api/v1/health-checks/${id}/repair-items`, { token })
  ])
```

**3b - Wrap RepairItemRow with React.memo AND memoize parent callbacks (must be done together):**

Step 1 - Memoize callbacks in `HealthCheckTabContent`:

```typescript
const handleManageOptions = useCallback((itemId: string, itemTitle: string) => {
  setOptionsModalItemId(itemId)
  setOptionsModalItemTitle(itemTitle)
}, [])

const handleUngroup = useCallback(async (itemId: string) => {
  if (!session?.accessToken) return
  if (!confirm('Are you sure you want to ungroup these items?')) return
  try {
    await api(`/api/v1/repair-items/${itemId}/ungroup`, {
      method: 'POST',
      token: session.accessToken
    })
    onUpdate()
  } catch (err) {
    console.error('Failed to ungroup:', err)
  }
}, [session?.accessToken, onUpdate])

const renderSpecialDisplay = useCallback((result: CheckResult | null) => {
  // ... existing logic
}, [])
```

Step 2 - Wrap `RepairItemRow` with `React.memo`:

```typescript
export const RepairItemRow = React.memo(function RepairItemRow({
  healthCheckId,
  item: initialItem,
  result,
  // ...
}: RepairItemRowProps) {
  // ... component body unchanged
})
```

**3c - Lift modals to HealthCheckTabContent level (single modal set):**

Rather than conditionally rendering per row (which still means 20 useState hooks for modal state), lift modals entirely to the parent. There is only ever one modal open at a time, so only one set of modals needs to exist:

```tsx
// In HealthCheckTabContent - single modal state for all rows
const [activeModal, setActiveModal] = useState<{
  type: 'defer' | 'decline' | 'delete'
  itemId: string
  itemTitle: string
} | null>(null)

// Pass a trigger function down to RepairItemRow
const openModal = useCallback((type: 'defer' | 'decline' | 'delete', itemId: string, itemTitle: string) => {
  setActiveModal({ type, itemId, itemTitle })
}, [])

// Render ONE set of modals at the parent level
{activeModal?.type === 'defer' && (
  <DeferModal
    isOpen={true}
    itemName={activeModal.itemTitle}
    onClose={() => setActiveModal(null)}
    onConfirm={(deferredUntil, notes) => handleDefer(activeModal.itemId, deferredUntil, notes)}
  />
)}
{activeModal?.type === 'decline' && (
  <DeclineModal
    isOpen={true}
    itemName={activeModal.itemTitle}
    onClose={() => setActiveModal(null)}
    onConfirm={(reasonId, notes) => handleDecline(activeModal.itemId, reasonId, notes)}
  />
)}
{activeModal?.type === 'delete' && (
  <DeleteModal
    isOpen={true}
    itemName={activeModal.itemTitle}
    onClose={() => setActiveModal(null)}
    onConfirm={(reasonId, notes) => handleDelete(activeModal.itemId, reasonId, notes)}
  />
)}
```

This completely removes modal concerns from `RepairItemRow`, making it simpler and lighter. The row just calls `openModal('defer', item.id, item.title)` instead of managing its own modal state.

### Impact

- **API latency**: Parallel calls reduce HealthCheckDetail load from ~1.5-2s to ~500-800ms
- **Re-renders**: `React.memo` + memoized callbacks prevents 19 of 20 rows from re-rendering on single-item edits
- **DOM weight**: Reducing from 60 modal instances to 0-1 frees memory and improves initial render
- **Interaction responsiveness**: Editing prices, toggling checkboxes will feel instantaneous

---

## 4. Additional Considerations

### 4a: Image/Asset Optimization

The health check system captures photos as evidence (technician photos of vehicle issues). If these appear in the web dashboard (e.g., in the Photos tab or expanded repair item rows), they could be a source of performance problems.

Consider:
- **Lazy loading images below the fold** - photos in collapsed repair items or off-screen tabs should not load until needed
- **Serve thumbnails in list views** - show small previews in RepairItemRow, load full resolution only on click/expand
- **Modern formats** - serve WebP with JPEG fallback for smaller file sizes

### 4b: List Virtualization for Long Lists

If health checks can have 30+ repair items, or the Kanban board shows 50+ vehicles, rendering all items to the DOM at once becomes a bottleneck even with `React.memo`. Consider `react-window` or `@tanstack/virtual` for lists that could grow large.

This is lower priority since most health checks have 10-25 items, but worth keeping in mind if dealerships with large inspections report sluggishness.

---

## Priority Order

| Priority | Area | Fix | Impact | Notes |
|----------|------|-----|--------|-------|
| 1 | Bundle | Add `React.lazy` code splitting to `App.tsx` | High | Biggest bang for buck, add preloading on hover for common routes |
| 2 | Dashboard | Debounce WebSocket refetches (500ms) + optimistic updates | High | Eliminates request storms, keeps UI responsive |
| 3a | Health Check | Wrap `RepairItemRow` in `React.memo` | High | **Must pair with 3b** - useless without memoized callbacks |
| 3b | Health Check | Memoize callbacks in `HealthCheckTabContent` | High | **Must pair with 3a** - not an optional follow-up |
| 4 | Health Check | Lift modals to parent level | Medium | Simplifies RepairItemRow, removes 60 DOM instances |
| 5 | Health Check | Parallelise `fetchData` API calls | Medium | Easy win, cuts page load latency in half |
| 6 | Dashboard | Disable polling when WebSocket connected | Medium | Eliminates redundant polling |
| 7 | Bundle | Add Vite manual chunks config | Low-Medium | Improves long-term caching |
| 8 | Future | Consider `@tanstack/react-query` for data fetching | Low | Future-proofs data fetching, adds stale-while-revalidate |
| 9 | Future | Image lazy loading + thumbnails | Low | Only relevant if photo-heavy HCs cause issues |
| 10 | Future | List virtualization (`react-window`) | Low | Only relevant if 30+ item HCs are common |

**Key dependency: Priorities 3a and 3b must be implemented together.** Adding `React.memo` without memoizing callbacks will have zero effect because every render creates new function references, causing `React.memo`'s shallow comparison to always detect changes.

---

## Verification Steps

### Bundle Size

```bash
cd apps/web && npx vite build
# Check dist/assets/ for chunk files
# Before: single .js file ~1.3MB
# After: multiple chunks, largest < 400KB
```

Use `npx vite-bundle-visualizer` to inspect chunk composition.

### Dashboard Network Requests

1. Open browser DevTools Network tab
2. Navigate to Dashboard
3. Count XHR requests on initial load (target: reduce from 6 to 1-3)
4. Trigger a status change via mobile app
5. Verify optimistic UI update happens immediately (< 100ms)
6. Verify only 1 debounced refetch fires after 500ms (not 3-4 immediate calls)
7. Verify no polling requests while WebSocket is connected

### RepairItemRow Re-renders

1. Install React DevTools Profiler
2. Navigate to a health check with 10+ repair items
3. Edit price on one item
4. Check Profiler: only the edited row should re-render
5. Before fix: all rows re-render. After fix: 1 row re-renders

### Modal DOM Weight

1. Open DevTools Elements panel
2. Search for modal-related elements (e.g., portal roots, overlay divs)
3. Before fix: 3 modals per row (60 for 20 items)
4. After fix: 0-1 modal instances in DOM

---

## Files to Modify

| File | Changes |
|------|---------|
| `apps/web/vite.config.ts` | Add `build.rollupOptions.output.manualChunks` |
| `apps/web/src/App.tsx` | Convert imports to `React.lazy`, add `Suspense`, add hover preloading |
| `apps/web/src/pages/Dashboard.tsx` | Debounce WS handlers (500ms), optimistic updates, conditional polling |
| `apps/web/src/pages/HealthChecks/HealthCheckDetail.tsx` | Parallelise API calls in `fetchData` |
| `apps/web/src/pages/HealthChecks/components/RepairItemRow.tsx` | Add `React.memo`, remove modal rendering |
| `apps/web/src/pages/HealthChecks/components/HealthCheckTabContent.tsx` | Memoize callbacks, lift modals to this level |
