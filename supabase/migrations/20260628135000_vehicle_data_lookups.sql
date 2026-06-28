-- Per-call usage log for the paid VehicleDetails (Vehicle Data Global) lookup.
-- Mirrors ai_usage_logs: one row per real API hit, capturing our ACTUAL cost
-- (VDGL billingInformation.transactionCost, GBP). Powers per-tenant usage +
-- billing in the super-admin Usage dashboard. See docs/vehicle-details-billing-plan.md.

CREATE TABLE IF NOT EXISTS vehicle_data_lookups (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid REFERENCES organizations(id) ON DELETE SET NULL, -- null = platform/admin test
  user_id                uuid REFERENCES users(id) ON DELETE SET NULL,
  registration           varchar(20),
  context                varchar(20) NOT NULL,        -- 'lookup' | 'create' | 'refresh' | 'admin_test'
  success                boolean NOT NULL DEFAULT false,
  found                  boolean NOT NULL DEFAULT false,
  billed                 boolean NOT NULL DEFAULT false, -- billingTransactionId present (an actual charge)
  cost                   numeric(10,4),               -- our cost (transactionCost), GBP; null if not billed
  currency               varchar(3) DEFAULT 'GBP',
  billing_transaction_id varchar(64),
  response_id            varchar(64),                 -- responseInformation.responseId (support queries)
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vdl_org_created ON vehicle_data_lookups(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_vdl_created ON vehicle_data_lookups(created_at);

-- Service-role only, like ai_usage_logs (the API uses the service key; no tenant RLS access).
ALTER TABLE vehicle_data_lookups ENABLE ROW LEVEL SECURITY;
