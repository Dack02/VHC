-- Make cost_price optional on repair_parts
-- Cost price is not always known when adding parts
ALTER TABLE repair_parts ALTER COLUMN cost_price DROP NOT NULL;
ALTER TABLE repair_parts ALTER COLUMN cost_price SET DEFAULT 0;
