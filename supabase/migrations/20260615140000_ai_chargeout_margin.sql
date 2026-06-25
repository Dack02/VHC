-- =============================================================================
-- AI chargeout pricing (platform-wide): margin + USD→GBP conversion
-- =============================================================================
-- Organisations are billed in GBP. The chargeout price is derived from the raw
-- AI cost (USD) by applying a markup and converting to GBP:
--   chargeout_gbp = cost_usd * (1 + ai_margin_percent / 100) * usd_to_gbp_rate
-- Both values are platform-wide and configured in Super Admin → AI Configuration.
-- ai_margin_percent defaults to 0 (no markup); usd_to_gbp_rate defaults to an
-- editable estimate (admin-maintained). Chargeout is computed on-read in the
-- admin usage endpoints, so changing either value re-prices the dashboards
-- immediately.
-- =============================================================================

INSERT INTO platform_ai_settings (key, value, is_encrypted, description) VALUES
  ('ai_margin_percent', '0', false, 'Markup percentage applied to AI cost price before currency conversion'),
  ('usd_to_gbp_rate', '0.79', false, 'USD->GBP exchange rate (GBP per $1) used to convert AI chargeout to the billing currency')
ON CONFLICT (key) DO NOTHING;
