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

## 6. Online booking — "the clear next step" (design approved, not yet built)

After approving, the customer knows booking is the next step and can pick a slot **online**.
This is now **built** (design on the canvas: `Estimate Customer View.dc.html`, the three
"Adding online booking" frames). Flow:

1. **Signpost before approval** — a "What happens next" tracker (Approve → Book your slot →
   We do the work) above the action area; approve/submit button reads **"Approve & book your
   slot"**, with an "I'll book later" escape hatch.
2. **Slot picker** — on approval, the portal drops into a day strip + time grid (+ optional
   courtesy-car toggle). Availability is fetched live.
3. **Confirmation** — "You're booked in" with date / courtesy-car summary.

### New files

```
supabase/migrations/20260628120000_estimate_online_booking.sql  NEW  config cols + estimate_bookings table
apps/api/src/services/estimate-booking.ts                       NEW  availability (diary capacity) + create booking
apps/api/src/routes/public-estimate-booking.ts                  NEW  GET /availability, POST /book
apps/api/src/services/estimate-settings.ts                      replace  + booking config fields + buildSettingsUpdate()
apps/api/src/routes/estimate-settings.ts                        replace  uses buildSettingsUpdate()
apps/web/src/pages/EstimatePortal/NextStepTracker.tsx           NEW  the 3-step timeline
apps/web/src/pages/EstimatePortal/BookingFlow.tsx               NEW  slot picker + BookingConfirmation
apps/web/src/pages/EstimatePortal/EstimatePortal.tsx            replace  tracker + booking phases wired in
apps/web/src/pages/Settings/EstimateSettings.tsx                replace  + "Let customers book online" card
```

### ✅ Availability comes from Booking Diary capacity — never invented

`services/estimate-booking.ts > getAvailability()` derives bookable days from the **same**
source the workshop board uses, so customers can never book beyond real capacity:

- Per-day free hours from the **`diary_day_summary`** RPC (`available_hours − booked_hours`).
- Operating weekdays from `workshop_board_config.operating_days` (ISO dow 1–7), mirroring the
  diary's `resolveOperatingDays`.
- A day is bookable only when `freeHours >= slot length (hours)`. Slots are sliced across the
  configured opening hours; past times on today are disabled. Org + site scoped.
- `POST /book` **re-validates** capacity server-side (it can change between load and confirm)
  and records an `estimate_bookings` row (`status 'requested'`) for the garage to confirm.

**Assumptions worth a look:**
- Job duration for the capacity check = the configured **slot length** (`estimate_booking_slot_minutes`).
  If you want it to reflect the *actual* approved labour hours, compute that in
  `getAvailability`/`createEstimateBooking` and pass it in instead of `slotHours`.
- A day with **no diary summary row** (no shifts configured) is treated as **closed** rather
  than over-promising. Orgs using online booking are expected to have technician shifts set.
- `estimate_bookings` is the link record; **converting it into a real diary booking / jobsheet
  is a garage-side step** (left as a follow-up — wire `converted_to_jobsheet_id` when you add it).

### Two manual one-liners (mounting + GET payload)

1. **Mount the booking router** next to the existing public estimate router (wherever
   `publicEstimate` is mounted under `/api/public`, e.g. `routes/public.ts` or app setup):

   ```ts
   import publicEstimateBooking from './routes/public-estimate-booking.js'
   // ...alongside the existing publicEstimate mount, same base path:
   app.route('/api/public', publicEstimateBooking)
   ```

2. **Expose the booking flags + address** on the estimate GET so the portal can show the
   tracker before approval. In `routes/public-estimate.ts`, the `GET /estimate/:token`
   response, `organization` block already gets `usps: settings.usps` — add:

   ```ts
   organization: {
     name: branding.organizationName,
     logoUrl: branding.logoUrl,
     primaryColor: branding.primaryColor,
     phone: branding.phone,
     address: branding.address,            // ← if available, used on the confirmation card
     usps: settings.usps
   },
   booking: {                              // ← add this block
     enabled: settings.onlineBookingEnabled,
     courtesyCar: settings.bookingCourtesyCar
   },
   ```

   (`settings` is already in scope.) The portal treats `booking.enabled` as the switch for the
   tracker + booking step; the picker still calls `/availability` for real slots.

---

## Notes / possible follow-ups

- **Default USPs:** new orgs start empty. If you'd rather seed the three examples, set them in
  the migration's `DEFAULT` or in `DEFAULTS.usps` (service).
- **Icon override:** matching is automatic. If a tenant ever wants to pin a specific icon, the
  cleanest extension is to store `{ text, icon }` objects instead of plain strings and add a
  small icon picker in the editor — `matchUspIcon` stays the default.
- **PDF:** `generateEstimatePDF()` could render the same USP strip from `settings.usps`.
