-- Seed Data for VHC Application
-- This creates test data for development

-- Organization
INSERT INTO organizations (id, name, slug, settings)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Demo Auto Group',
  'demo-auto-group',
  '{"currency": "GBP", "timezone": "Europe/London"}'
);

-- Sites
INSERT INTO sites (id, organization_id, name, address, phone, email, settings)
VALUES
  (
    '22222222-2222-2222-2222-222222222221',
    '11111111-1111-1111-1111-111111111111',
    'Main Workshop',
    '123 High Street, London, SW1A 1AA',
    '+44 20 1234 5678',
    'main@demoauto.com',
    '{"bayCount": 6}'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'North Branch',
    '456 North Road, Manchester, M1 1AA',
    '+44 161 234 5678',
    'north@demoauto.com',
    '{"bayCount": 4}'
  );

-- Note: Users are created via the seed script which handles Supabase Auth
-- The following are placeholder UUIDs that will be updated by the seed script:
-- admin@demo.com - org_admin
-- advisor1@demo.com - service_advisor (Main Workshop)
-- advisor2@demo.com - service_advisor (North Branch)
-- tech1@demo.com - technician (Main Workshop)
-- tech2@demo.com - technician (Main Workshop)
