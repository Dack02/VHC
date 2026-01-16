Create a full Supabase backup:

1. DATABASE BACKUP:
   - Get DATABASE_URL from apps/api/.env
   - Use pg_dump to backup all schemas: public, auth, storage
   - Save to ~/VHC_backups/db_backup_YYYYMMDD_HHMMSS.sql
   - Include: tables, data, RLS policies, functions, triggers

2. STORAGE FILES:
   - List all Supabase storage buckets
   - Download all files to ~/VHC_backups/storage/[bucket_name]/
   - Preserve folder structure

3. Create ~/VHC_backups/ directory if it doesn't exist

4. Print summary:
   - Database backup file path and size
   - Number of storage files backed up per bucket
   - Total backup size
