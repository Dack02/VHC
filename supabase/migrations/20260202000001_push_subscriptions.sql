-- Push subscriptions for Web Push API notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  app_type TEXT NOT NULL DEFAULT 'web' CHECK (app_type IN ('web', 'mobile')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  failure_count INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fetching active subscriptions by user
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_active
  ON push_subscriptions (user_id) WHERE is_active = true;

-- Index for cleanup of failed subscriptions
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_failures
  ON push_subscriptions (failure_count) WHERE failure_count > 0;
