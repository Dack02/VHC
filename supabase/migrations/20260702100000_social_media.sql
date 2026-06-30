-- ============================================================================
-- Social Media Analytics module (v1 — Zernio buy-layer path)
-- Plan: GMS/SOCIAL_MEDIA.md (§2.5 recommended path)
--
-- v1 is DATA/ANALYTICS ONLY. Each dealership (organization) links its own
-- Facebook / Instagram / TikTok (organic + ads) through Zernio
-- (docs.zernio.com). We store ZERNIO REFERENCES (profile id + a per-org
-- scoped read-only API key + account ids) — NOT platform OAuth tokens.
-- Metrics/spend/posts are pulled nightly and normalised into the tables below.
--
-- Additive only. Multi-tenant (every table organization_id-scoped). All
-- statements IF NOT EXISTS. No supabase db reset — ever (see rules.md).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. social_connections — one row per organization = its Zernio profile + key
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_connections (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id          UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,

  -- Zernio refs (see GMS/SOCIAL_MEDIA.md §2.5). The scoped key is read-only,
  -- locked to this org's profile, and stored encrypted via lib/encryption.ts.
  zernio_profile_id        TEXT,
  zernio_api_key_encrypted TEXT,

  status                   TEXT NOT NULL DEFAULT 'pending',  -- pending | connected | needs_reauth | error | disabled

  -- nightly sync schedule (Europe/London)
  sync_hour                INTEGER NOT NULL DEFAULT 2,   -- 0-23
  sync_minute              INTEGER NOT NULL DEFAULT 0,   -- 0-59

  last_synced_at           TIMESTAMPTZ,
  last_error               TEXT,

  created_by_user_id       UUID REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. social_accounts — each linked account under the org's Zernio profile
--    (a Zernio profile groups many accounts: organic + ad-credential accounts)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_accounts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  zernio_account_id TEXT NOT NULL,
  platform          TEXT NOT NULL,                 -- facebook | instagram | tiktok
  account_type      TEXT NOT NULL DEFAULT 'organic', -- organic | metaads | tiktokads

  external_id       TEXT,                          -- platform-side id (page id / ig id / advertiser id)
  display_name      TEXT,
  handle            TEXT,
  avatar_url        TEXT,
  currency          TEXT,                          -- ad accounts: account currency (do NOT assume GBP)

  site_id           UUID REFERENCES sites(id),     -- optional multi-site attribution
  status            TEXT NOT NULL DEFAULT 'connected', -- connected | disconnected | error
  token_expires_at  TIMESTAMPTZ,                   -- from Zernio account health
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, zernio_account_id)
);

-- ----------------------------------------------------------------------------
-- 3. social_metrics_daily — account-level daily organic snapshot (long format)
--    Long (metric/value) on purpose: platform metric names churn; we store
--    whatever the normaliser emits. Follower growth = daily followers_count
--    snapshots, deltas computed in the report.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_metrics_daily (
  id                BIGSERIAL PRIMARY KEY,
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  social_account_id UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,

  stat_date         DATE NOT NULL,
  metric            TEXT NOT NULL,                 -- followers_count | reach | views | total_interactions | ...
  value             NUMERIC NOT NULL DEFAULT 0,
  breakdown         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- '{}' = no sub-segment (age/gender/country)

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, social_account_id, stat_date, metric, breakdown)
);

-- ----------------------------------------------------------------------------
-- 4. social_posts — post/video catalogue + lifetime metrics snapshot
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_posts (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  social_account_id  UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,

  external_post_id   TEXT NOT NULL,
  post_type          TEXT,                         -- photo | video | reel | story | tiktok_video | carousel
  permalink          TEXT,
  caption            TEXT,
  thumbnail_url      TEXT,                          -- NB TikTok cover URLs have a short TTL
  posted_at          TIMESTAMPTZ,

  metrics            JSONB,                         -- {reach, views, likes, comments, shares, saves, total_interactions, engagementRate}
  metrics_fetched_at TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, social_account_id, external_post_id)
);

-- ----------------------------------------------------------------------------
-- 5. social_ad_spend_daily — paid spend (Meta Ads + TikTok Ads), daily series
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_ad_spend_daily (
  id                   BIGSERIAL PRIMARY KEY,
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  social_account_id    UUID NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,

  stat_date            DATE NOT NULL,
  level                TEXT NOT NULL DEFAULT 'account', -- account | campaign
  external_campaign_id TEXT NOT NULL DEFAULT '',        -- '' for account-level rows
  campaign_name        TEXT,

  spend                NUMERIC NOT NULL DEFAULT 0,
  impressions          BIGINT  NOT NULL DEFAULT 0,
  reach                BIGINT  NOT NULL DEFAULT 0,
  clicks               BIGINT  NOT NULL DEFAULT 0,
  cpc                  NUMERIC,
  cpm                  NUMERIC,
  ctr                  NUMERIC,
  conversions          NUMERIC,                     -- Meta-only on Zernio today; TikTok may be null
  roas                 NUMERIC,                     -- Meta-only on Zernio today
  actions              JSONB,                       -- raw action/action_values
  currency             TEXT,
  breakdown            JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, social_account_id, stat_date, level, external_campaign_id, breakdown)
);

-- ----------------------------------------------------------------------------
-- 6. marketing_spend_manual — non-API spend (radio/print/sponsorship/etc.)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing_spend_manual (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id            UUID REFERENCES sites(id),

  channel            TEXT NOT NULL,                 -- radio | print | sponsorship | google_ads | other
  amount             NUMERIC NOT NULL,
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  note               TEXT,

  created_by_user_id UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 7. social_sync_runs — observability (one row per sync attempt)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_sync_runs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform            TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at         TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'running', -- running | success | partial | error
  rows_written        INTEGER NOT NULL DEFAULT 0,
  error               TEXT,
  rate_limit_snapshot JSONB
);

-- ----------------------------------------------------------------------------
-- Indexes — every table queried by organization_id; time-series by (account, date)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_social_connections_org      ON social_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_org         ON social_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_org_active  ON social_accounts(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_social_metrics_acct_date    ON social_metrics_daily(organization_id, social_account_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_social_metrics_org_metric   ON social_metrics_daily(organization_id, metric, stat_date);
CREATE INDEX IF NOT EXISTS idx_social_posts_org_account    ON social_posts(organization_id, social_account_id, posted_at);
CREATE INDEX IF NOT EXISTS idx_social_ad_spend_acct_date   ON social_ad_spend_daily(organization_id, social_account_id, stat_date);
CREATE INDEX IF NOT EXISTS idx_marketing_spend_manual_org  ON marketing_spend_manual(organization_id, period_start);
CREATE INDEX IF NOT EXISTS idx_social_sync_runs_org        ON social_sync_runs(organization_id, started_at);
