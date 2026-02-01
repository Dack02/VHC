-- Create storage bucket for organization assets (logos, favicons)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'organization-assets',
  'organization-assets',
  true,
  2097152, -- 2MB limit
  ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/x-icon']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for organization assets
-- Drop existing policies first to avoid conflicts
DO $$
BEGIN
  DROP POLICY IF EXISTS "Authenticated users can upload organization assets" ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can update organization assets" ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can delete organization assets" ON storage.objects;
  DROP POLICY IF EXISTS "Public read access for organization assets" ON storage.objects;
END $$;

CREATE POLICY "Authenticated users can upload organization assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'organization-assets');

CREATE POLICY "Authenticated users can update organization assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'organization-assets');

CREATE POLICY "Authenticated users can delete organization assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'organization-assets');

CREATE POLICY "Public read access for organization assets"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'organization-assets');
