-- =============================================================================
-- Onboarding: subscription free-trial tracking
-- =============================================================================
-- Adds trial tracking to organization_subscriptions so every newly provisioned
-- organization starts on a 1-month free trial of its chosen plan
-- (status = 'trialing'). There is NO automatic enforcement yet: when the trial
-- lapses the record simply still reads 'trialing' with a past trial_ends_at;
-- billing / suspension is a later phase.
--
-- Safe / idempotent: additive nullable columns only.
-- =============================================================================

ALTER TABLE organization_subscriptions
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;

ALTER TABLE organization_subscriptions
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

COMMENT ON COLUMN organization_subscriptions.trial_ends_at IS
  'End of the free trial. While status = ''trialing'' and NOW() < trial_ends_at the organization is in trial. No automatic enforcement yet.';
