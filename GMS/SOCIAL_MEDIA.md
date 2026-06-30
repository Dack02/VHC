# GMS — Social Media Analytics (Reach, Engagement & Marketing Spend)

> Branch: work on `dev` · Status: **PLAN — DECISIONS PENDING (Leo); Zernio buy-layer now RECOMMENDED for v1 (2026-06-30, after Zernio API review)** · Author: Leo + Claude
> Proposed lock (Leo, ____): **v1 = Zernio buy-layer** (`docs.zernio.com`) as the connector for **Meta (FB Page + IG + Ads)** and **TikTok (Ads + Organic)** — it removes our biggest blocker (no Meta App Review / Business Verification / TikTok audit) and covers organic **and** ad-spend in one API · **analytics/data only in v1** (no posting/scheduling) · per-org **Zernio profile + scoped read-only key** (no platform tokens to hold) · nightly BullMQ pull · new `social_media` module key · **direct in-house build (rest of this doc) = documented Plan B / future migration if vendor-risk or cost warrant**
> Companion to [`ONLINE_VHC_REPORT.md`](./ONLINE_VHC_REPORT.md) (report patterns), [`BOOKING_FLOW.md`](./BOOKING_FLOW.md) (lead attribution), [`REMINDER_TIMELINES.md`](./REMINDER_TIMELINES.md) (marketing campaigns).
> **Additive only. Multi-tenant. No `supabase db reset` — ever (see `rules.md`).**

---

## 0. TL;DR

A new **Social Media Analytics** module so each dealership can link **their own** Facebook, Instagram and TikTok accounts (organic + paid) and see, in one dashboard, their **reach / views, engagement, follower growth and marketing spend** — plus the dealership-specific value: **spend → leads → bookings ROI**.

- **Per-tenant OAuth, not a first-party pull.** Our one Meta app + one (well, two) TikTok app receives *delegated* access to each org's assets. Tokens stored **encrypted per `organization_id`**, exactly like the DMS/Twilio credential pattern already in the codebase.
- **Two platforms, four "surfaces."** Meta gives **Facebook Page Insights + linked Instagram Business insights + Meta Ads spend** in *one* OAuth grant. TikTok needs **two separate apps/consoles**: TikTok **Marketing API** (ad spend) and TikTok **Login Kit + Display API** (organic followers/video metrics). Design the schema platform-agnostic from day one.
- **Data-first. v1 = BUY via Zernio; in-house build is Plan B.** A focused review of **Zernio** (a unified social API, `docs.zernio.com`) changed the recommendation: unlike the generic aggregators, Zernio covers *both* organic insights **and** ad-spend reporting **and** holds its own Meta/TikTok platform approvals — so it **eliminates the 4–8 week App-Review/Business-Verification blocker entirely**. See **§2.5**. The full in-house direct build (§3–§14) is retained as the documented fallback / migration target. **MCP servers remain the wrong production surface** either way.
- **What used to be the long pole disappears with Zernio.** On a *direct* build, Meta **App Review + Business Verification** and TikTok **app audit** gate reading *any* real tenant's data (4–8 weeks, rejection-prone). **Zernio is an approved Meta Marketing Partner and runs its own platform apps**, so dealerships just OAuth-connect and we skip all of it. (If we ever go direct — Plan B — start that paperwork day 1 and build under Standard Access against Central Garage's own accounts behind a flag.)
- **Metrics are a moving target — treat them as config.** Meta is mid-migration from `impressions` → `views` (Page metrics removed 2025-11-15; a second "Media Views/Viewers" wave ~mid-2026; IG removals Jan 2025). We pin an API version, default to `views`/`reach`/`total_interactions`, and compute follower growth from daily `followers_count` snapshots — never from deprecated `page_fans`/`impressions` metric strings.
- **ROI is the killer feature.** Tie ad spend to VHC's own bookings/jobsheets via UTM-tagged links → **cost-per-lead, cost-per-booking, ROAS**, with **manual spend entry** for non-API channels (radio, print, local sponsorship) so total marketing spend is captured.

---

## 1. DECISIONS NEEDED (Leo) — lock these before building

| # | Decision | Recommendation | Why |
|---|----------|----------------|-----|
| **D1** | **Buy (Zernio) vs in-house direct build** | **Buy via Zernio for v1** (see §2.5); keep the in-house direct build (§3–§14) as the documented Plan B / migration target | **Superseded by the Zernio review.** Earlier we favoured direct-build because the only aggregator assessed (Ayrshare) covered organic only. **Zernio covers organic *and* ad-spend reporting (Meta + TikTok) AND holds its own Meta Marketing Partner + TikTok approvals** — so it removes the 4–8 week App-Review/Business-Verification blocker *and* the per-platform OAuth/token/metric-churn maintenance, for ~$1–6 per connected account/mo. Net: weeks-not-months to ship, far less code. Residual risks (young vendor, no public DPA/SOC2, Zernio-branded consent screen, pooled rate limits) are pilot-gated, not blockers. Go direct later only if cost/vendor-risk demands it — the in-house plan is ready. |
| **D2** | **v1 scope** | Organic insights **+** ad spend across **FB, IG, TikTok**; **no posting/scheduling** | Matches "first purpose is data." Posting/inbox is a large net-new surface — roadmap (§11 P3+). |
| **D3** | **TikTok organic depth** | Ship **Login Kit + Display API** (followers + per-video views/likes/comments/shares). **Defer** audience demographics & profile-views | Demographics/profile-views live only in TikTok's **partner-gated for-Business Accounts API** (needs a Business Account + partner review). Not worth blocking v1. |
| **D4** | **Who can connect / view** | Connect = `org_admin`+ only; view reports = `service_advisor`+ (gated by module) | Tokens are sensitive; reporting is broadly useful. Mirrors existing role gating. |
| **D5** | **Plan gating** | `social_media` module **`defaultOn: false`**, GMS-tier opt-in | Premium add-on; VHC-only tenants don't get it by default. |

Everything below assumes the recommended answers. Nothing is built until D1–D5 are locked.

---

## 2. The platform map (do not conflate the surfaces)

```
                         ┌─────────────────────────── META (one app, one OAuth) ───────────────────────────┐
   Dealership ──FB Login─┤  Facebook Page Insights   │  Instagram Business Insights   │   Meta Ads (spend) │
   (org_admin)  for Biz  │  graph.facebook.com/v25.0 │  (IG must be Business + Page-  │  act_<id>/insights │
                         │  scopes: pages_show_list, │   linked) instagram_basic +    │  scope: ads_read    │
                         │  pages_read_engagement,   │   instagram_manage_insights    │                     │
                         │  read_insights            │                                │                     │
                         └────────────────────────────────────────────────────────────────────────────────┘
                                              ▼ durable per-tenant token (System User, non-expiring)

                         ┌──────────── TikTok ADS (app #1, business-api.tiktok.com) ────────────┐
   Dealership ──OAuth────┤  Marketing API v1.3  ·  GET /report/integrated/get/  ·  spend etc.   │
                         │  Access-Token header + advertiser_id  ·  store refresh_token too      │
                         └─────────────────────────────────────────────────────────────────────┘
                         ┌──────────── TikTok ORGANIC (app #2, open.tiktokapis.com) ────────────┐
   Dealership ──OAuth────┤  Login Kit + Display API v2  ·  /v2/user/info/ (user.info.stats)     │
                         │  + /v2/video/list/ (video.list)  ·  24h access + 365d refresh token  │
                         └─────────────────────────────────────────────────────────────────────┘
                                              ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
   │  VHC API (Hono)  ·  encrypted token vault (lib/encryption.ts)  ·  BullMQ nightly sync workers  │
   │  → normalise into social_metrics_daily / social_posts / social_ad_spend_daily (Supabase)       │
   │  → /reports/social-media aggregations  →  Web dashboard (React)                                 │
   └──────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Key facts that drive the design (all fact-checked against current docs, June 2026):**
- **Meta:** one OAuth covers FB Page + linked IG + ad accounts. Current API **v25.0** (released 2026-02-18, ~quarterly cadence, ~2-yr lifecycle). **Insights are poll-only** (no webhook except one-shot `story_insights`).
- **TikTok:** **two physically separate platforms** — different consoles, OAuth, tokens, review. Marketing API **v1.3** ad token is long-lived (but returns a `refresh_token` — store & support refresh). Display API token is **24h access / 365-day refresh** → mandatory refresh job.
- **No MCP in production.** Official Meta Ads MCP (`mcp.facebook.com/ads`) and community ones (pipeboard, gomarble) are agent-facing, per-user/per-session, "no long-lived tokens" — incompatible with headless scheduled multi-tenant polling. Use only for internal exploration with our own dev token.

---

## 2.5 RECOMMENDED v1 PATH — Zernio buy-layer (fact-checked 2026-06-30)

A focused crawl of `docs.zernio.com` + the OpenAPI spec (`zernio.com/openapi.yaml`, v1.0.4) + the full docs dump (`docs.zernio.com/llms-full.txt`), with adversarial verification, settled the five make-or-break questions. **All confirmed in the docs (not just marketing):**

| # | Question | Verdict |
|---|----------|---------|
| 1 | Per-tenant isolation? | **YES (logical).** `Profiles` = one container per dealership; every call scoped by `profileId`. **Per-profile, read-only, scoped API keys** exist (`POST /v1/api-keys` `{scope:'profiles', profileIds:[…], permission:'read'}`) → mint one analytics-only key locked to one dealership. *Caveat: isolation is a scoping construct, no published hard-security guarantee — pilot-test.* |
| 2 | Ad-spend reporting Meta **+** TikTok? | **YES.** `GET /v1/ads/timeline` = daily series of `spend, impressions, reach, clicks, ctr, cpc, cpm, conversions, costPerConversion, roas`. **Auto-imports EXISTING campaigns** on connect (90-day backfill, up to 730d on demand). *TikTok ads return spend/impressions/clicks/CTR/CPM but `conversions`/`roas` are Meta-only for now.* |
| 3 | Organic + follower-growth time-series? | **YES for FB, IG, TikTok** — daily `follower_count` history via Zernio's snapshotter (`/v1/accounts/follower-stats` + per-platform `account-insights`). *TikTok organic **reach/impressions are unavailable on ANY public TikTok API** — a platform limit that blocks a direct build identically. IG account metrics are mostly snapshot (only `reach` is a time-series) — also a platform limit.* Backfill ~89 days → **start polling each tenant early** to accumulate long history. |
| 4 | Do they hold app review? | **YES.** "Zernio is an approved Meta Marketing Partner, so you skip the App Review + ads_management permissions entirely" / "No TikTok Business Center developer onboarding needed." **We register no Meta/TikTok dev app, do no Business Verification, no audit.** |
| 5 | Pricing? | **Per connected account, graduated:** 1–2 free, 3–10 $6 ea, 11–100 $3 ea, 101–2,000 **$1 ea**, 2,001+ custom. Analytics + Ads **bundled** (legacy "add-on" wording is stale). *Each ad-credential account (`metaads`, `tiktokads`) also counts as a billable account — a dealership pulling FB+IG+TikTok organic + Meta+TikTok ads ≈ 4–5 accounts.* Rate limits: 600 rpm / ~10 analytics req/s per key at our band (pooled across tenants) → nightly BullMQ batch. |

### What Zernio REMOVES from the in-house plan (§3–§14)
No Meta app, **no App Review, no Business Verification, no TikTok audits**; no per-platform OAuth flows; no `facebook-nodejs-business-sdk` / TikTok SDKs; no platform token storage or refresh treadmill; no metric-catalogue version-churn handling (Zernio absorbs the Meta v25/v26 `impressions→views` migration); no per-platform rate-limit header parsing; no `story_insights` webhook. **It collapses the heaviest ~60% of the build.**

### What we STILL build (this is the real v1 work)
1. **Module shell** — `social_media` key + gating (unchanged, §9).
2. **Connect UX** — Settings cards that call `GET /v1/connect/{platform}?profileId=…&redirect_url=…` (+ `…/ads` for ad accounts) and handle the redirect back to our domain; create one **Zernio Profile per organization** on first connect; subscribe to `account.connected` / `account.disconnected` webhooks (poll `/v1/accounts/health` for token expiry — no expiry webhook).
3. **Credential vault (simplified)** — store, encrypted, **a per-org scoped Zernio API key + `zernio_profile_id` + linked account ids** — *not* platform tokens. One platform-level `ZERNIO_API_KEY` via Railway env (env-first), plus per-org scoped read-only keys minted via `POST /v1/api-keys`.
4. **Nightly BullMQ pull** — per org, call Zernio's read endpoints (`/v1/analytics/daily-metrics`, `/v1/accounts/follower-stats`, `/v1/analytics/{platform}/account-insights`, `/v1/analytics?postId=…`, `/v1/ads/timeline`) → normalise into our tables (§3) → respect the ~10 analytics-req/s pooled ceiling.
5. **Tables, reports, dashboard, manual spend, ROI attribution** — all **unchanged** from §3/§5/§12. **ROI stays ours** (Zernio doesn't know about VHC bookings) — UTM/lead-source join is still the differentiator.

### Data-model delta for the Zernio path
Use §3 mostly as-is, but `social_connections`/`social_accounts` store **Zernio references instead of platform tokens**: `social_connections` → `{ organization_id, zernio_profile_id, zernio_api_key_encrypted (scoped read-only), status }`; `social_accounts` → `{ …, zernio_account_id, account_type, external_id, currency }`. `social_metrics_daily` / `social_posts` / `social_ad_spend_daily` / `marketing_spend_manual` are identical — we just populate them from Zernio responses.

### Zernio endpoint → our needs
- Followers/growth → `GET /v1/accounts/follower-stats?profileId&granularity=daily` → `social_metrics_daily(metric='followers_count')`.
- Account reach/engagement → `GET /v1/analytics/{facebook|instagram|tiktok}/account-insights` + `GET /v1/analytics/daily-metrics` → `social_metrics_daily`.
- Posts → `GET /v1/analytics?profileId&fromDate&toDate` → `social_posts`.
- Ad spend → `GET /v1/ads/timeline?accountId&fromDate&toDate` → `social_ad_spend_daily`.
- Connect/health → `GET /v1/connect/{platform}`, `GET /v1/accounts/health`; webhooks `account.connected|disconnected`.

### Open questions / pilot gate (before committing — do a paid pilot on ONE dealership)
1. **DPA / GDPR / EU data-residency / SOC2** — *not published.* We'd route UK dealership PII + tokens through Zernio → **get a signed DPA + residency answer before go-live** (hard gate).
2. **Vendor maturity** — rebranded from "Late"/getlate.dev in 2026, indie origin → continuity/concentration risk for a core module. The in-house Plan B (this doc) is our insurance.
3. **Tenant data-isolation** — pen-test that one org's scoped key cannot read another's profile.
4. **Branded consent** — the OAuth dialog the dealership sees says **"Zernio"**, not our brand (Zernio's app). We can build our own account *selector* via `headless=true`, but not rebrand the platform consent screen. Confirm this is acceptable UX.
5. **Billing at scale** — confirm ad-credential accounts count toward per-account billing; model true £/dealership.
6. **Field-level smoke test** — connect one real Meta + one TikTok ad account, inspect actual `/v1/ads/timeline` + `account-insights` JSON (exact keys, TikTok ad fields, backfill depth).

### Revised phasing with Zernio (weeks, not months)
- **Z0** — Zernio account + paid pilot on Central Garage's own FB/IG/TikTok + Meta/TikTok ads; verify pilot-gate items 3–6.
- **Z1** — module shell + connect UX (profile-per-org, scoped key, webhooks) + simplified vault.
- **Z2** — nightly pull + normalise + **overview dashboard** (followers, reach/views, engagement, spend).
- **Z3** — ROI (UTM→bookings) + manual spend + digest.
- **Z4** — demographics/best-time/alerts/benchmarking + CSV/PDF.

Legal/commercial (DPA, item 1) runs in parallel from Z0 and is the only thing resembling a "long pole" now — and it's days/weeks of paperwork, not a platform review.

---

## 3. Data model (additive only, all `IF NOT EXISTS`, all `organization_id`-scoped)

> **Path note:** the tables below are written for the **in-house direct build (Plan B)**. On the **recommended Zernio path (§2.5)**, `social_connections`/`social_accounts` store Zernio refs (profile id + scoped key + account ids) instead of platform tokens; the metric/spend/post/manual-spend tables are used **unchanged** and populated from Zernio responses.

> Long/EAV format for metrics (`metric` + `value`) is deliberate — Meta/TikTok churn metric names constantly, so we store whatever the per-version **metric catalog** (§7) emits rather than hardcoding columns. Aggregate in the DB layer (mind the **PostgREST ~1000-row cap** — paginate or aggregate server-side, never raw multi-row reads).

### 3.1 `social_connections` — one row per platform OAuth grant, per org
```
id uuid pk
organization_id uuid not null fk → organizations(id) on delete cascade
platform           text not null     -- 'meta' | 'tiktok_ads' | 'tiktok_organic'
status             text not null default 'connected'  -- connected | needs_reauth | revoked | error
access_token_encrypted   text        -- via lib/encryption.ts (AES-256-GCM)
refresh_token_encrypted  text        -- TikTok organic (24h/365d); TikTok ads refresh; Meta n/a if system-user
token_expires_at   timestamptz       -- null for non-expiring (Meta system-user / TikTok ads)
scopes             text[]            -- granted scope strings (audit)
external_business_id text            -- Meta business id / TikTok bc_id
connected_by_user_id uuid fk → users(id)
last_synced_at     timestamptz
last_error         text
created_at/updated_at timestamptz default now()
UNIQUE(organization_id, platform)
```

### 3.2 `social_accounts` — each linked asset under a connection
A single Meta grant can expose multiple Pages/IG accounts/ad accounts → one row each.
```
id uuid pk
organization_id uuid not null fk
connection_id  uuid not null fk → social_connections(id) on delete cascade
account_type   text not null   -- 'fb_page' | 'ig_business' | 'meta_ad_account' | 'tiktok_profile' | 'tiktok_ad_account'
external_id    text not null   -- page id / ig user id / act_<id> / open_id / advertiser_id
display_name   text
handle         text            -- @handle / vanity
page_access_token_encrypted text -- Meta Page token (non-expiring, derived) — per-asset
avatar_url     text
currency       text            -- ad accounts: capture account currency, DO NOT assume GBP
is_active      boolean default true
site_id        uuid fk → sites(id)   -- optional: attribute an account to a specific site (multi-site)
created_at/updated_at timestamptz default now()
UNIQUE(organization_id, account_type, external_id)
```

### 3.3 `social_metrics_daily` — account-level daily snapshot (organic)
```
id bigserial pk
organization_id uuid not null fk
social_account_id uuid not null fk → social_accounts(id) on delete cascade
stat_date      date not null
metric         text not null   -- 'reach' | 'views' | 'total_interactions' | 'followers_count' | 'profile_links_taps' ...
value          numeric not null default 0
breakdown      jsonb           -- optional sub-segment (age/gender/country) when metric_type=total_value + breakdown
created_at timestamptz default now()
UNIQUE(organization_id, social_account_id, stat_date, metric, (coalesce(breakdown,'{}')))
```
> **Follower growth** = daily snapshot of the `followers_count` (Meta) / `follower_count` (TikTok) **node field**, deltas computed in the report — NOT the deprecated `page_fans`/`page_fan_adds` insight metrics.

### 3.4 `social_posts` — post/video catalogue + lifetime metrics
```
id uuid pk
organization_id uuid not null fk
social_account_id uuid not null fk
external_post_id text not null
post_type      text            -- 'photo'|'video'|'reel'|'story'|'tiktok_video'|'carousel'
permalink      text
caption        text
thumbnail_url  text            -- NB TikTok cover_image_url has 6h TTL → refresh via /v2/video/query
posted_at      timestamptz
metrics        jsonb           -- {reach, views, likes, comments, shares, saves, total_interactions}
metrics_fetched_at timestamptz
created_at/updated_at timestamptz default now()
UNIQUE(organization_id, social_account_id, external_post_id)
```

### 3.5 `social_ad_spend_daily` — paid spend (Meta Ads + TikTok Ads)
```
id bigserial pk
organization_id uuid not null fk
social_account_id uuid not null fk   -- the ad account
stat_date      date not null
level          text not null default 'account'  -- account|campaign|adset|ad
external_campaign_id text            -- nullable when level=account
campaign_name  text
spend          numeric not null default 0
impressions    bigint default 0
reach          bigint default 0
clicks         bigint default 0
cpc numeric, cpm numeric, ctr numeric
conversions    numeric default 0
actions        jsonb               -- raw action/action_values array (leads, purchases, etc.)
currency       text not null
breakdown      jsonb               -- publisher_platform / age / gender / country when requested
created_at timestamptz default now()
UNIQUE(organization_id, social_account_id, stat_date, level, coalesce(external_campaign_id,''), coalesce(breakdown,'{}'))
```

### 3.6 `marketing_spend_manual` — non-API spend (P1)
```
id uuid pk, organization_id uuid not null fk, site_id uuid fk null
channel        text not null   -- 'radio'|'print'|'sponsorship'|'google_ads'|'other'
amount         numeric not null
period_start date not null, period_end date not null
note text, created_by_user_id uuid fk, created_at/updated_at timestamptz default now()
```

### 3.7 `social_sync_runs` — observability (one row per sync attempt)
```
id uuid pk, organization_id uuid fk, connection_id uuid fk, platform text,
started_at timestamptz, finished_at timestamptz, status text, -- success|partial|error
rows_written int, error text, rate_limit_snapshot jsonb -- X-App-Usage / X-Business-Use-Case-Usage
```

### 3.8 Attribution (ROI) — reuse existing booking/lead tables
- Add `utm_source / utm_medium / utm_campaign / lead_source` to the booking/health-check creation path (online booking + portal links from [`BOOKING_FLOW.md`](./BOOKING_FLOW.md) already carry links we can tag). Store on the booking; the report joins spend ↔ attributed bookings/jobsheet revenue. **Be honest in the UI: last-touch UTM attribution is best-effort**, and platform-reported conversions (from `actions`) will differ from our booking counts — show both.

---

## 4. API routes (`apps/api/src/routes/social-media.ts`, new)

All under `authMiddleware` + `requireModule('social_media')`. Connect/disconnect require `authorizeMinRole('org_admin')`; reports require `service_advisor`+.

**Connection / linking**
- `GET  /api/v1/social-media/connections` → list connections + linked accounts + status + last sync.
- `GET  /api/v1/social-media/oauth/:platform/start` → returns the provider authorize URL (Meta FB-Login-for-Business `config_id` URL / TikTok ads / TikTok organic) with signed `state` (org_id + nonce, CSRF).
- `GET  /api/v1/social-media/oauth/:platform/callback` → exchange `code` server-side → durable token → discover & upsert `social_connections` + `social_accounts` → kick first sync. (Redirect target registered per platform; mirrors `auth.ts` `/auth/oauth/exchange` and `AuthCallback.tsx`.)
- `DELETE /api/v1/social-media/connections/:id` → revoke + null tokens + remove repeatable jobs.
- `POST /api/v1/social-media/connections/:id/sync` → manual "sync now".
- `PATCH /api/v1/social-media/settings` → sync schedule (hour/min), per-account `site_id`, active toggles.

**Manual spend (P1)**
- `GET/POST/PATCH/DELETE /api/v1/social-media/manual-spend`.

**Reports** (in `routes/reports.ts` or a sibling, mirroring `online-vhc`)
- `GET /api/v1/reports/social-media?date_from&date_to&site_id&platform&group_by` → unified overview (per-platform totals, period series, follower growth, spend).
- `GET /api/v1/reports/social-media/posts?...` → top content table.
- `GET /api/v1/reports/social-media/roi?...` → spend vs leads/bookings/revenue (manual + API spend), cost-per-lead, cost-per-booking, ROAS.
- All log `report.view` / `report.export` audit events (existing pattern).

---

## 5. Web UI (`apps/web/src/pages`)

- **`Settings/SocialMediaSettings.tsx`** — "Connect Facebook & Instagram" / "Connect TikTok Ads" / "Connect TikTok Account" cards: status pill (Connected / Needs reconnect / Error), linked-asset list, last-sync time, sync-now, schedule, disconnect. Follow `docs/form-design-guidelines.md` (dark `#16191f` primary, `rounded-[10px]`). Gated link added to `Settings/SettingsHub.tsx` behind `useModules().social_media`.
- **`Reports/SocialMediaAnalytics.tsx`** — the dashboard, mirroring `OnlineVhcPerformance.tsx` (filters bar, date/site/platform, CSV export):
  - **Overview tiles** per platform: followers (+Δ), reach/views, engagement rate, spend.
  - **Trend charts**: follower growth; reach/views over time; **spend vs reach overlay**.
  - **Content table**: top posts/videos by reach/engagement, with thumbnails + permalink.
  - **ROI panel** (P1): spend → leads → bookings → revenue, cost-per-lead, cost-per-booking, ROAS, with the "best-effort attribution" caveat.
  - **Manual spend** mini-form (P1).
- Lazy-route in `App.tsx`, wrapped `<RequireModule moduleKey="social_media">`. Register in `Reports/ReportsHub.tsx`.

---

## 6. Background jobs (BullMQ — reuse `services/queue.ts` / `worker.ts` / `scheduler.ts`)

- New queue `SOCIAL_MEDIA_SYNC`; job `{ organizationId, connectionId, platform, mode: 'incremental'|'backfill' }`.
- **Nightly per-connection sync** (default 02:00 Europe/London, staggered per tenant) → pull account insights, post metrics, ad spend for the trailing window (incremental ~last 7–14 days to catch late-attributed conversions) → upsert.
- **Token refresh job** — TikTok organic before 24h expiry; TikTok ads refresh; Meta system-user is non-expiring (alert if invalidated). On refresh failure → set `status='needs_reauth'` + surface in Settings.
- **`story_insights` webhook** (Meta) — optional: capture ephemeral story stats before they vanish.
- `initializeSocialMediaSchedules()` registered on API boot + Redis reconnect (alongside `initializeDmsImportSchedules` — see the DMS scheduler boot re-register fix; same gotcha applies).
- **Rate-limit discipline:** read `X-App-Usage` / `X-Business-Use-Case-Usage` (Meta) and 600/min (TikTok v2) on every response; back off above ~70%; honour `estimated_time_to_regain_access`; use **async report** flows for large Meta (`POST act_/insights` → poll `report_run_id`) and TikTok (`create → poll → download`) pulls.

---

## 7. Metric catalogue as config (`apps/api/src/lib/social/metric-catalog.ts`)

Pin `META_API_VERSION = 'v25.0'`; keep per-surface metric lists in one file so a version bump is a config edit, not a code hunt. Defaults:
- **FB Page:** `views` (not `impressions` — removed 2025-11-15), `page_post_engagements`, `followers_count` (node field). Watch the **~mid-2026 "Media Views/Viewers"** wave (`page_media_view` / `page_total_media_view_unique`) — a second metric review is due then.
- **IG Business:** `reach`, `views`, `total_interactions`, `accounts_engaged`, `follower_count`, `profile_links_taps` (all `metric_type=total_value`). Gone since v21 (Jan 2025): `impressions`, non-Reels `video_views`, time-series `profile_views`, `website_clicks`, contact clicks. Demographics hidden <100 followers, top-N segments, ~48h lag.
- **Meta Ads:** `spend, impressions, reach, clicks, cpc, cpm, ctr, frequency, actions, action_values`; `time_increment=1`; note `7d_view`/`28d_view` windows removed 2026-01-12 and tiered retention (13mo unique/hourly, 37mo totals).
- **TikTok Ads:** `report/integrated/get/` metrics `spend, impressions, reach, clicks, cpc, cpm, ctr, conversion, cost_per_conversion`; `dimensions=[stat_time_day, ...]`.
- **TikTok organic:** `/v2/user/info/` → `follower_count, likes_count, video_count` (scope `user.info.stats`); `/v2/video/list/` → per-video `view_count, like_count, comment_count, share_count` (scope `video.list`, max 20/page).

---

## 8. SDKs / dependencies

- **Meta:** `facebook-nodejs-business-sdk` (official, covers Graph **and** Marketing API) — pin `^25` (note the npm SDK sometimes lags the live API by a version; pin the API version explicitly in the URL/version config regardless). Thin `fetch`/`undici` calls are an acceptable lighter alternative for read-only insights.
- **TikTok ads:** `tiktok-business-api-sdk-official` exists but is lumpy (pins Node 13–18, `type:module`, clone-and-link README) — **prefer direct `fetch`** against `business-api.tiktok.com/open_api/v1.3/`.
- **TikTok organic:** no official v2 SDK — direct `fetch` against `open.tiktokapis.com/v2/`.
- **Env/secrets:** `ENCRYPTION_KEY` (already used), plus per-platform app creds via Railway env (`META_APP_ID/SECRET`, `META_CONFIG_ID`, `TIKTOK_ADS_APP_ID/SECRET`, `TIKTOK_ORGANIC_CLIENT_KEY/SECRET`) — env-first then DB, mirroring the comms/DMS resolution pattern.

---

## 9. Settings, module, seeding

- Add `social_media` to **both** `apps/api/src/lib/modules.ts` and `apps/web/src/lib/modules.ts` (`{ key:'social_media', label:'Social Media Analytics', description:'Reach, engagement, follower growth & marketing spend across Facebook, Instagram and TikTok', defaultOn:false }`). The admin enablement panel (`AdminOrganizationDetail.tsx` → Modules tab) and `module_overrides`/plan-feature gating pick it up automatically.
- Add `requireModule('social_media')` to the route group; wrap web routes in `<RequireModule>`.
- No per-org seeding needed (connections are user-initiated).

---

## 10. Migrations

Latest applied is `20260701160000_*`. Use timestamps **after** it:
- `20260702100000_social_connections.sql` — §3.1 + §3.2
- `20260702100100_social_metrics.sql` — §3.3 + §3.4 + §3.5
- `20260702100200_social_manual_spend_and_runs.sql` — §3.6 + §3.7
- `20260702100300_booking_utm_attribution.sql` — §3.8 columns (all `ADD COLUMN IF NOT EXISTS`)

All `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`; every table `organization_id NOT NULL REFERENCES organizations(id) ON DELETE CASCADE` + index on `(organization_id, …)`. Apply via `psql -h localhost -p 54422 …` or `supabase migration up` — **never** reset.

---

## 11. Phasing

- **P0 — Foundation + approvals kickoff (the unblocker).**
  - Start **Meta Business Verification + App Review** (`pages_show_list, pages_read_engagement, read_insights, instagram_basic, instagram_manage_insights, business_management, ads_read`) and **TikTok app audits** (ads + organic) — *day 1*, longest pole.
  - Module registry + gating; migrations §3.1–§3.5; encrypted token vault; `social-media.ts` routes; OAuth connect/callback for **Meta** + **TikTok ads** + **TikTok organic**; Settings linking UI. Build/test against **Central Garage's own** accounts under Standard Access, behind a feature flag.
- **P1 — Sync + overview dashboard.** BullMQ sync + refresh + scheduler; metric catalogue; `social_metrics_daily` / `social_posts` / `social_ad_spend_daily` population; **unified overview report + UI** (followers, reach/views, engagement, spend, trends); content table.
- **P2 — ROI + manual spend.** UTM/lead-source on bookings; `marketing_spend_manual`; **spend→leads→bookings ROI** report (cost-per-lead/booking, ROAS); spend-vs-reach overlay; weekly **digest** via the existing email/SMS rail.
- **P3 — Depth.** Audience demographics (Meta where available); best-time-to-post; **anomaly alerts** (spend spike / engagement drop) via existing notifications; **site-vs-site benchmarking** + period-over-period; CSV/PDF export polish; `social_sync_runs` admin view.
- **P4+ — Roadmap (explicitly out of v1).** Posting & scheduling / content calendar; unified inbox & comments; paid-campaign management (write scopes); more connectors (Google Business Profile, LinkedIn, YouTube); AI content/insight suggestions (reuse Claude); competitor tracking; TikTok partner Accounts API (demographics/profile-views).

---

## 12. Recommended data features (the "what else would you build" answer)

| Feature | Pri | Source | Dealership value |
|---|---|---|---|
| Unified cross-platform overview (followers, reach/views, engagement, spend) + date/site/platform filters | P1 | All surfaces | One screen instead of 3 native apps |
| Follower-growth & engagement-rate trends | P1 | `followers_count` daily Δ | Is our audience actually growing? |
| Top-performing content table (thumb + permalink + metrics) | P1 | `social_posts` | What to post more of |
| **Marketing-spend tracker incl. manual entry** | P2 | Ads API + `marketing_spend_manual` | **Total** marketing spend, not just digital |
| **Spend → leads → bookings ROI (cost-per-lead/booking, ROAS)** | P2 | Ad spend ⨯ UTM-attributed bookings/revenue | The number a dealer principal actually cares about |
| Weekly social digest (email/SMS) | P2 | Reuse digest rail | Passive visibility, no login needed |
| Audience demographics (Meta) | P3 | IG/FB insights | Targeting / content fit |
| Best-time-to-post | P3 | Post performance | Practical posting guidance |
| Anomaly alerts (spend spike / engagement drop) | P3 | Reuse notifications | Catch runaway ad spend / dead campaigns |
| Site-vs-site benchmarking (multi-site groups) | P3 | All | Which branch's social is working |

---

## 13. Gotchas (carry into the build)

1. **Approvals are the schedule.** Nothing reads real tenant data until Meta App Review + Business Verification and TikTok audits clear (4–8 wks, rejection-prone). Start day 1; build under Standard Access against our own assets; ship the UI behind a feature flag. A **privacy policy URL + working data-deletion/deauth callback** are *prerequisites* for review, not extras.
2. **Metric deprecation is live.** `impressions`→`views` (Meta Pages 2025-11-15; second wave ~mid-2026), IG removals (Jan 2025). Hardcoding metric strings = hard "invalid metric" errors. Use the §7 catalogue; default to `views`/`reach`/`total_interactions`; follower growth from node-field snapshots.
3. **Tokens differ per surface.** Meta → Facebook **Login for Business** + **System-User** (non-expiring) tokens via a `config_id` (avoids the 60-day user-token treadmill); derive non-expiring **Page** tokens. TikTok **ads** token is long-lived *but returns a refresh_token — store & support refresh*. TikTok **organic** = 24h access / 365-day refresh → **mandatory** refresh job; surface `needs_reauth`.
4. **Poll-only.** No insights webhooks except one-shot `story_insights`. Freshness = polling cadence within rate budget.
5. **Rate limits scale with usage** (active ads / engaged users), not flat. Parse usage headers, back off, stagger tenants, prefer async reports for big pulls. App-level Meta limit is shared across tenants — schedule accordingly.
6. **TikTok = two apps.** Ads (`business-api.tiktok.com`) and organic (`open.tiktokapis.com/v2`) are separate consoles/credentials/reviews. Open Display API has **no demographics / no profile-views** — that's the partner Accounts API (deferred).
7. **Currency:** capture ad-account currency; don't assume GBP.
8. **PostgREST 1000-row cap** (project memory) — aggregate in DB / paginate; never raw multi-row insight reads in reports.
9. **MCP servers are not the integration.** Don't wire production against `mcp.facebook.com/ads`, pipeboard, or gomarble — per-session/per-user tokens, "no long-lived tokens." Fine as an internal dev REPL with our own token only.
10. **SDK ↔ API version lag** — the Node SDK can trail the live Graph/Marketing API; pin the API version explicitly regardless of SDK version.

---

## 14. Appendix — verified endpoint/scope cheat-sheet (June 2026)

**Meta (`graph.facebook.com/v25.0`)** — one OAuth (Facebook Login for Business, `config_id`, System-User token):
- Page insights: `GET /{page-id}/insights?metric=views,page_post_engagements&period=day` (Page token); live followers: `GET /{page-id}?fields=followers_count`.
- IG (Business + Page-linked; discover via `GET /{page-id}?fields=instagram_business_account`): `GET /{ig-user-id}/insights?metric=reach,views,total_interactions&metric_type=total_value`; `GET /{ig-user-id}?fields=followers_count`.
- Ads: `GET /act_{ad-account-id}/insights?fields=spend,impressions,reach,clicks,cpc,cpm,ctr,actions&level=campaign&time_increment=1` (scope `ads_read`); async via `POST` → poll `report_run_id`.
- Token exchange (server-side, app secret): `GET /oauth/access_token?grant_type=fb_exchange_token&...`.
- Scopes needing Advanced Access (App Review + Business Verification): `pages_show_list, pages_read_engagement, read_insights, instagram_basic, instagram_manage_insights, business_management, ads_read`.
- SDK: `facebook-nodejs-business-sdk` (`npm i facebook-nodejs-business-sdk`, pin `^25`).

**TikTok Ads (`business-api.tiktok.com/open_api/v1.3`)**:
- OAuth: `POST /oauth2/access_token/` `{app_id, secret, auth_code}` → `access_token` + `advertiser_ids`; enumerate via `GET /oauth2/advertiser/get/`. Header `Access-Token`. Store `refresh_token`.
- Spend: `GET /report/integrated/get/?advertiser_id&report_type=BASIC&data_level=AUCTION_AD&dimensions=["stat_time_day","ad_id"]&metrics=["spend","impressions","reach","clicks","cpc","cpm","ctr"]&start_date&end_date&page_size=1000`.

**TikTok Organic (`open.tiktokapis.com/v2`)** — Login Kit + Display API:
- Authorize `https://www.tiktok.com/v2/auth/authorize/?client_key&scope=user.info.basic,user.info.stats,video.list&response_type=code&redirect_uri&state`; token `POST /v2/oauth/token/` (access 24h, refresh 365d; refresh may rotate).
- `GET /v2/user/info/?fields=follower_count,likes_count,video_count` (scope `user.info.stats`); `POST /v2/video/list/` `{fields in query: view_count,like_count,comment_count,share_count; max_count≤20}` (scope `video.list`); `POST /v2/video/query/` to refresh 6h-TTL cover images. 600 req/min/endpoint.

---

## 15. Key files to follow (existing patterns)

- Modules: `apps/api/src/lib/modules.ts` + `apps/web/src/lib/modules.ts`; resolution `apps/api/src/services/modules.ts`; gate `apps/api/src/middleware/require-module.ts`; web `contexts/ModulesContext.tsx` + `components/RequireModule.tsx`.
- Encryption: `apps/api/src/lib/encryption.ts` (`encrypt`/`decrypt`/`maskString`). Credential-table model: `supabase/migrations/20260115000001_dms_integration.sql`.
- OAuth pattern: `apps/api/src/routes/auth.ts` (`/auth/oauth/exchange`) + `apps/web/src/pages/AuthCallback.tsx`.
- Reports: `apps/api/src/routes/reports.ts` + `apps/web/src/pages/Reports/OnlineVhcPerformance.tsx` (data shape, filters, CSV).
- Jobs: `apps/api/src/services/queue.ts` / `worker.ts` / `scheduler.ts` (DMS import = the template; mind the boot re-register fix).
- Form/UI standard: `docs/form-design-guidelines.md`; canonical `apps/web/src/components/customers/CustomerFormModal.tsx`.
```
