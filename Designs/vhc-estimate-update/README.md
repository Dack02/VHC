# Estimate module redesign + tenant USPs

Drop-in update for the **customer-facing online estimate** (redesigned, premium/brand-led)
plus a new **tenant USP** feature: garages add short selling points in Settings → Estimates,
and they render as an auto-iconed trust strip on every estimate the customer sees.

Files mirror the repo layout — copy each over its counterpart (one is new).

```
apps/web/src/lib/uspIcons.tsx                         NEW  shared icon matcher + <UspIcon>
apps/web/src/pages/EstimatePortal/EstimatePortal.tsx  replace  redesigned portal + USP strip
apps/web/src/pages/Settings/EstimateSettings.tsx      replace  adds "Your selling points" editor
apps/api/src/services/estimate-settings.ts            replace  adds `usps` to settings
apps/api/src/routes/estimate-settings.ts              replace  accepts `usps` on PATCH
supabase/migrations/20260627120000_estimate_usps.sql  NEW  estimate_usps jsonb column
```

Plus **one line** in `apps/api/src/routes/public-estimate.ts` (below).

---

## 1. Migration

`estimate_usps jsonb NOT NULL DEFAULT '[]'` on `organization_settings`. Additive + idempotent,
no backfill. Deploy via the normal pipeline (`supabase db push`) — same as the other estimate
settings migrations.

## 2. API — expose USPs on the public portal payload

`getEstimateSettings()` now returns `usps: string[]`. The public route already loads
`settings`, so the only change is to include it in the `organization` block of
`GET /api/public/estimate/:token`:

```ts
// apps/api/src/routes/public-estimate.ts  →  in the GET '/estimate/:token' response
organization: {
  name: branding.organizationName,
  logoUrl: branding.logoUrl,
  primaryColor: branding.primaryColor,
  phone: branding.phone,
  usps: settings.usps            // ← add this line
},
```

(`settings` is already in scope from the existing
`const [lines, branding, settings] = await Promise.all([...])`.)

USPs are factual, customer-facing marketing copy, so unlike the staff-only insight banners
they are safe to expose on the portal (and could later go on the PDF).

## 3. API — accept USPs on save

`routes/estimate-settings.ts` PATCH now accepts `body.usps` (array of strings) and stores the
normalised list (`normaliseUsps`: trim, drop empties, cap at 6 × 80 chars). No new route.

## 4. Web — Settings editor

`EstimateSettings.tsx` gains a **"Your selling points"** card: up to 6 rows, each with an
auto-matched icon chip, a text input (saves on blur), and a remove button — plus a **live
preview** of the customer trust strip. Saves through the existing
`PATCH …/estimate-settings/settings` with `{ usps }`.

## 5. Web — Customer portal

`EstimatePortal.tsx` is redesigned (brand-led hero, "Why choose us" trust strip from the
tenant USPs, per-line approve/decline, clearer totals & actions). All existing behaviour is
preserved: token load, per-line decisions, `/submit` `/approve-all` `/decline-all`, the
signature flow, expiry + responded states. Branding still comes from
`organization.primaryColor`; accents are derived with CSS `color-mix` (evergreen browsers —
precompute server-side if you need legacy support).

The icon matcher (`lib/uspIcons.tsx`) is shared by the portal and the settings preview, so a
given USP always gets the same icon in both places. It maps keywords → icon (genuine/approved
→ shield-check, finance/0% → percent, courtesy/loan car → car, warranty → badge-check,
MOT → gauge, …) and falls back to a tick.

---

## Notes / possible follow-ups

- **Default USPs:** new orgs start empty. If you'd rather seed the three examples, set them in
  the migration's `DEFAULT` or in `DEFAULTS.usps` (service).
- **Icon override:** matching is automatic. If a tenant ever wants to pin a specific icon, the
  cleanest extension is to store `{ text, icon }` objects instead of plain strings and add a
  small icon picker in the editor — `matchUspIcon` stays the default.
- **PDF:** `generateEstimatePDF()` could render the same USP strip from `settings.usps`.
