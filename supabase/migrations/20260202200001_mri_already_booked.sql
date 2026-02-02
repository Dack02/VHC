-- Add "already booked for this visit" option to MRI scan results
ALTER TABLE mri_scan_results ADD COLUMN IF NOT EXISTS already_booked_this_visit BOOLEAN DEFAULT false;
