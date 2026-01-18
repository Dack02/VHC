-- =============================================================================
-- Set reason_type values for template_items
-- Groups similar items so they can share the same reasons
-- =============================================================================

-- First, reset all reason_type to NULL to start fresh
UPDATE template_items SET reason_type = NULL;

-- =============================================================================
-- TYRES - All tyre items share the same reasons
-- =============================================================================
UPDATE template_items SET reason_type = 'tyre'
WHERE name IN (
  'Front Left Tyre',
  'Front Right Tyre',
  'Rear Left Tyre',
  'Rear Right Tyre',
  'Spare Tyre'
);

-- =============================================================================
-- BRAKE ASSEMBLY - Front/Rear brakes share reasons
-- =============================================================================
UPDATE template_items SET reason_type = 'brake_assembly'
WHERE name IN (
  'Front Brakes',
  'Rear Brakes'
);

-- =============================================================================
-- WIPERS - All wiper items share reasons
-- =============================================================================
UPDATE template_items SET reason_type = 'wiper'
WHERE name IN (
  'Wiper Blades',
  'Wipers & Washers'
);

-- =============================================================================
-- FLUID LEVELS - All fluid level items share reasons
-- =============================================================================
UPDATE template_items SET reason_type = 'fluid_level'
WHERE name IN (
  'Brake Fluid',
  'Coolant Level',
  'Engine Oil Level',
  'Power Steering Fluid',
  'Washer Fluid Level'
);

-- =============================================================================
-- SHOCK ABSORBERS - Front/Rear shock absorbers share reasons
-- =============================================================================
UPDATE template_items SET reason_type = 'shock_absorber'
WHERE name IN (
  'Front Shock Absorbers',
  'Rear Shock Absorbers'
);

-- =============================================================================
-- LIGHTS - All light items share reasons
-- =============================================================================
UPDATE template_items SET reason_type = 'light_cluster'
WHERE name IN (
  'Brake Lights',
  'Front Indicators',
  'Headlights (Dipped)',
  'Headlights (Main Beam)',
  'Number Plate Lights',
  'Rear Indicators',
  'Reverse Lights',
  'Tail Lights'
);

-- =============================================================================
-- EXHAUST - All exhaust items share reasons
-- =============================================================================
UPDATE template_items SET reason_type = 'exhaust'
WHERE name IN (
  'Catalytic Converter',
  'Exhaust Manifold',
  'Exhaust Mountings',
  'Exhaust Pipes',
  'Silencer/Muffler'
);

-- =============================================================================
-- SUSPENSION - Suspension components share reasons
-- =============================================================================
UPDATE template_items SET reason_type = 'suspension'
WHERE name IN (
  'Anti-Roll Bar Links',
  'Ball Joints',
  'Springs',
  'Track Rod Ends'
);

-- =============================================================================
-- STEERING - Steering components share reasons
-- =============================================================================
UPDATE template_items SET reason_type = 'steering'
WHERE name IN (
  'Steering Feel',
  'Steering Rack'
);

-- =============================================================================
-- WHEELS - Wheel items share reasons
-- =============================================================================
UPDATE template_items SET reason_type = 'wheel'
WHERE name IN (
  'Wheel Condition',
  'Wheel Nuts/Bolts'
);

-- =============================================================================
-- UNIQUE ITEMS - These remain NULL (each has its own specific reasons)
-- =============================================================================
-- The following items will have reason_type = NULL:
-- - Air Filter
-- - Battery Condition
-- - Boot/Tailgate
-- - Brake Lines & Hoses
-- - Brake Performance
-- - Clutch Operation
-- - Door Operation
-- - Drive Belts
-- - Engine Performance
-- - Fuel Filler Cap
-- - Gearbox Operation
-- - Handbrake Operation
-- - Horn
-- - Hoses & Pipes
-- - Mirrors
-- - Seatbelts
-- - Suspension Noise
-- - Tyre Details (special input type)
-- - Warning Lights
-- - Windscreen

-- =============================================================================
-- Verify the updates
-- =============================================================================
DO $$
DECLARE
  tyre_count INTEGER;
  brake_count INTEGER;
  wiper_count INTEGER;
  fluid_count INTEGER;
  shock_count INTEGER;
  light_count INTEGER;
  exhaust_count INTEGER;
  suspension_count INTEGER;
  steering_count INTEGER;
  wheel_count INTEGER;
  unique_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO tyre_count FROM template_items WHERE reason_type = 'tyre';
  SELECT COUNT(*) INTO brake_count FROM template_items WHERE reason_type = 'brake_assembly';
  SELECT COUNT(*) INTO wiper_count FROM template_items WHERE reason_type = 'wiper';
  SELECT COUNT(*) INTO fluid_count FROM template_items WHERE reason_type = 'fluid_level';
  SELECT COUNT(*) INTO shock_count FROM template_items WHERE reason_type = 'shock_absorber';
  SELECT COUNT(*) INTO light_count FROM template_items WHERE reason_type = 'light_cluster';
  SELECT COUNT(*) INTO exhaust_count FROM template_items WHERE reason_type = 'exhaust';
  SELECT COUNT(*) INTO suspension_count FROM template_items WHERE reason_type = 'suspension';
  SELECT COUNT(*) INTO steering_count FROM template_items WHERE reason_type = 'steering';
  SELECT COUNT(*) INTO wheel_count FROM template_items WHERE reason_type = 'wheel';
  SELECT COUNT(*) INTO unique_count FROM template_items WHERE reason_type IS NULL;

  RAISE NOTICE 'Reason type assignment complete:';
  RAISE NOTICE '  tyre: % items', tyre_count;
  RAISE NOTICE '  brake_assembly: % items', brake_count;
  RAISE NOTICE '  wiper: % items', wiper_count;
  RAISE NOTICE '  fluid_level: % items', fluid_count;
  RAISE NOTICE '  shock_absorber: % items', shock_count;
  RAISE NOTICE '  light_cluster: % items', light_count;
  RAISE NOTICE '  exhaust: % items', exhaust_count;
  RAISE NOTICE '  suspension: % items', suspension_count;
  RAISE NOTICE '  steering: % items', steering_count;
  RAISE NOTICE '  wheel: % items', wheel_count;
  RAISE NOTICE '  unique (NULL): % items', unique_count;
END $$;
