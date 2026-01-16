-- Add new item types for brake fluid selector and tyre details input

ALTER TYPE item_type ADD VALUE IF NOT EXISTS 'brake_fluid';
ALTER TYPE item_type ADD VALUE IF NOT EXISTS 'tyre_details';
