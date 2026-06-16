# Ollo Inspect ⇄ Ollo Dev — Feedback / Ticketing Integration

In-app feedback (bug / feature request / question) from Ollo Inspect (the VHC web
+ mobile apps) is pushed to **Ollo Dev** (the shared dev/issue tracker). Status
changes and developer replies flow back so reporters track progress in-app. Built
as reusable infrastructure — any SaaS product can plug into Ollo Dev the same way.

## How it flows

```
Ollo Inspect widget ──(multipart)──► Inspect API  POST /api/v1/feedback
   • save feedback_tickets (pending)
   • upload screenshots → ollo-feedback bucket
   • POST {OLLO_DEV}/api/v1/integrations/tickets   (Authorization: ApiKey <key>,
                                                     X-Ollo-Source-App: ollo-inspect)
   • store returned ticket id, mark synced

   ...dev changes status / replies in Ollo Dev...

Ollo Dev webhook dispatcher ──(HMAC-signed)──► Inspect API  POST /api/webhooks/ollo-dev
   • verify X-Ollo-Signature
   • update feedback_tickets.status / insert dev comment
   • Socket.io feedback:updated → reporter (live "My Feedback" update)
```

Idempotency: Ollo Dev dedupes on `(source_app, external_ref)` where `external_ref`
is the local `feedback_tickets.id`, so retries never duplicate. Inbound comments
dedupe on the Ollo Dev comment id; replies that originated in Inspect are never
echoed back (`metadata.origin = 'ingest'` on the Ollo Dev side).

**Where it appears in Ollo Dev:** feedback lands as a **project ticket** in the
project bound to the API key (`permissions.project_id`) — visible on that
project's **Tickets** tab and the Overview "Open tickets" counter. (Internally
it's a `discussions` row with `category='tickets'`; a dev can use Ollo Dev's
existing "convert to bug" flow.) Status mirrored back is coarse — **open /
closed** — since project tickets only have open/closed/archived. Dev replies
reach the reporter only when sent **client-facing** (the same "reply to
requester" action that emails an external requester); internal notes stay
internal.

## One-time setup

### 1. Deploy the migrations (via the normal pipelines)
- **Ollo Dev:** `supabase/migrations/20260406000000_ticket_integration.sql`
  (adds `discussions.source_app/external_ref`, `discussion_replies.metadata`,
  `webhooks.source_app`, `webhook_deliveries` outbox).
- **Ollo Inspect (VHC):** `supabase/migrations/20260617000000_feedback_tickets.sql`
  (feedback tables, `ollo-feedback` storage bucket, `platform_settings` id=`ollo_dev`).

Both are additive/idempotent. They apply through each repo's deploy pipeline
(`supabase db push`) — do not run them by hand against cloud.

### 2. Ollo Dev — issue an API key + register the callback webhook
With an org admin/owner JWT against the Ollo Dev API (replace `:orgId`):

```bash
# Create an API key scoped to this product (returns the raw key ONCE)
curl -X POST "$OLLO_DEV/api/v1/orgs/:orgId/api-keys" \
  -H "Authorization: Bearer <admin-jwt>" -H "Content-Type: application/json" \
  -d '{"name":"Ollo Inspect feedback","permissions":{"source_app":"ollo-inspect","project_id":"<ollo-inspect-project-uuid>"}}'

# Register the callback webhook (use the SAME secret you set on Inspect below)
curl -X POST "$OLLO_DEV/api/v1/orgs/:orgId/webhooks" \
  -H "Authorization: Bearer <admin-jwt>" -H "Content-Type: application/json" \
  -d '{
    "url":"https://<inspect-api-host>/api/webhooks/ollo-dev",
    "events":["ticket.status_changed","ticket.comment_created"],
    "source_app":"ollo-inspect",
    "secret":"<shared-webhook-secret>"
  }'
```

### 3. Ollo Inspect (VHC) — set env vars on Railway `@vhc/api`
Credentials resolve ENV-first (then the encrypted `platform_settings.ollo_dev`
row). Setting env vars is the recommended path and sidesteps the `ENCRYPTION_KEY`
dev gotcha.

| Var | Value |
|-----|-------|
| `OLLO_DEV_API_URL` | Ollo Dev API base origin (no trailing `/api/v1`), e.g. `https://ollo-dev-api.example.com` |
| `OLLO_DEV_API_KEY` | the raw key from step 2 |
| `OLLO_DEV_WEBHOOK_SECRET` | **must equal** the webhook `secret` from step 2 |
| `OLLO_DEV_PROJECT_ID` | optional (informational) |
| `OLLO_DEV_ENABLED` | optional; set `false` to disable without removing creds |
| `OLLO_DEV_SOURCE_APP` | optional; defaults to `ollo-inspect` |

The frontends inject `__APP_VERSION__` / `__BUILD_TIME__` at build time (already
wired in both `vite.config.ts`) for the diagnostics blob — no env needed.

## Verification (end-to-end)

1. **Submit (web):** open the dashboard, click the floating **Feedback** button →
   capture screen → annotate → send. Confirm a `feedback_tickets` row is created
   `synced` with an `ollo_dev_ticket_id`, the screenshot is in the `ollo-feedback`
   bucket, and a ticket appears in Ollo Dev carrying the diagnostics + screenshot URL.
2. **Round-trip:** change the ticket status / post a public comment in Ollo Dev →
   the `webhook_deliveries` row goes `pending → delivered`, the Inspect receiver
   updates the local row + inserts the dev comment, and "My Feedback" reflects it
   live (Socket.io) or on refetch.
3. **Reply up:** reply from "My Feedback" → it appears on the Ollo Dev ticket and
   does **not** echo back (no duplicate comment locally).
4. **Resilience:** with Ollo Dev unreachable, submit → the row stays `failed` and
   the user still sees success; once reachable, the 2-min scheduler sweep flips it
   to `synced` with no duplicate ticket.
5. **Mobile:** repeat via the mobile FAB (camera/annotate); rows are tagged
   `source_app = mobile`.
6. **Diagnostics safety:** trigger a `console.error`, submit, and confirm it shows
   on the ticket — and that no token/JWT/localStorage content leaks into the blob.

## Key files

**Ollo Dev:** `middleware/api-key.ts`, `routes/integrations/ingest.ts`,
`services/webhooks.ts` (dispatcher + outbox), dispatch hooks in
`routes/tickets/index.ts` + `routes/tickets/comments.ts`.

**Ollo Inspect API:** `services/ollo-dev.ts` (client + creds),
`routes/feedback.ts`, `routes/webhooks/ollo-dev.ts`, retry sweep in
`services/scheduler.ts` (`startFeedbackSyncRetrySchedule`).

**Web:** `components/feedback/*`, `lib/feedbackApi.ts`, `lib/diagnostics.ts`,
`lib/consoleBuffer.ts`; mounted in `layouts/DashboardLayout.tsx`.

**Mobile:** `components/feedback/*`, `lib/feedbackApi.ts`, `lib/diagnostics.ts`,
`lib/consoleBuffer.ts`; mounted in `App.tsx`.

## Future enhancements (not built)
- Auto-attach a PostHog session-replay deep link (one field on the diagnostics blob).
- Org-admin "all feedback for my org" view; satisfaction rating on resolution;
  AI auto-triage via the existing Anthropic integration.
- Ollo Dev: promote bug-type ingested tickets into `project_bugs` via the existing
  convert flow (a `source_app → project_id` mapping bridge).
