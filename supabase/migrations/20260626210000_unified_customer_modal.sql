-- =============================================================================
-- Unified Customer Modal
-- Created: 2026-06-26
--
-- Backs the single shared "create/edit customer" modal used across the
-- Customers list, Jobsheet, Estimate and New Health Check flows.
--   1. customers.company_name  — business name (distinct from contact_name).
--   2. customer_contacts        — additional emails / phone numbers per customer.
--      The PRIMARY email/mobile/phone stay denormalised on customers (every
--      existing read keys off them); this table holds the EXTRA ones the user
--      adds in the modal, typed and optionally labelled.
-- All additive + idempotent (IF NOT EXISTS) per the project's safe-migration rules.
-- =============================================================================

-- =============================================================================
-- 1. COMPANY NAME
-- =============================================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name TEXT;

-- =============================================================================
-- 2. ADDITIONAL CONTACTS (extra emails / phone numbers)
-- =============================================================================
CREATE TABLE IF NOT EXISTS customer_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- 'email' or 'phone' (covers mobile + landline; the label disambiguates)
  contact_type TEXT NOT NULL CHECK (contact_type IN ('email', 'phone')),
  value TEXT NOT NULL,
  -- Optional free-text label, e.g. 'work', 'home', 'mobile', 'accounts'
  label TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer
  ON customer_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_org
  ON customer_contacts(organization_id);
-- Speeds up matching a customer by an additional phone/email (e.g. inbound SMS)
CREATE INDEX IF NOT EXISTS idx_customer_contacts_value
  ON customer_contacts(organization_id, contact_type, value);

-- RLS — mirror the customers org-isolation policy.
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_contacts'
      AND policyname = 'customer_contacts_isolation'
  ) THEN
    CREATE POLICY customer_contacts_isolation ON customer_contacts
      FOR ALL USING (organization_id = current_setting('app.current_org_id', true)::uuid);
  END IF;
END $$;
