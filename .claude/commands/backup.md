# Backup Command

Execute a data-only backup of the VHC database. Do NOT backup schema — only data.

## Steps to Execute:

1. Create backup directory if it doesn't exist:
   ```bash
   mkdir -p ~/VHC_backups/data
   ```

2. Run the backup (ALL tables in public schema, data only):
   ```bash
   pg_dump -h localhost -p 54422 -U postgres -d postgres \
     --data-only \
     --column-inserts \
     --schema=public \
     > ~/VHC_backups/data/vhc_data_$(date +%Y%m%d_%H%M%S).sql
   ```

3. Show the result:
   ```bash
   ls -lah ~/VHC_backups/data/ | tail -5
   ```

4. Print confirmation with file path and size.

## Important:
- Backups save to: `~/VHC_backups/data/` (outside project directory)
- Data-only means no CREATE TABLE statements
- Can be restored into any schema version
- New tables are automatically included

## To Restore (if needed):
```bash
psql -h localhost -p 54322 -U postgres -d postgres < ~/VHC_backups/data/FILENAME.sql
```
