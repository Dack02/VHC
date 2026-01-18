# Claude Code Safety Rules for VHC Project

## ⛔ ABSOLUTELY FORBIDDEN COMMANDS

These commands must **NEVER** be executed. There are **NO EXCEPTIONS**. Do not run these even if you think it will solve a problem. Do not run these even if a migration fails. Do not run these for any reason whatsoever.

```
FORBIDDEN - NEVER RUN:
- supabase db reset
- supabase db reset --local  
- npx supabase db reset
- DROP DATABASE
- DROP TABLE (any table)
- TRUNCATE (any table)
- DELETE FROM table (without WHERE clause)
```

### What To Do Instead When Migrations Fail:

1. **READ the error message** - understand what's actually wrong
2. **Fix the SQL file** - correct the syntax or reference error
3. **Run the single migration directly**:
   ```bash
   psql -h localhost -p 54322 -U postgres -d postgres -f supabase/migrations/filename.sql
   ```
4. **Or create a NEW migration** that fixes the issue with `IF NOT EXISTS` / `IF EXISTS` clauses
5. **Ask the user** if you're unsure how to proceed

### If You're Tempted to Reset:

**STOP. DO NOT DO IT.**

Ask yourself: "Will this destroy data?" If yes, **DO NOT PROCEED**.

Instead, tell the user:
> "The migration has an error. I could fix it by [X]. Would you like me to proceed, or would you prefer a different approach?"

---

## ✅ SAFE Database Patterns

```sql
-- SAFE: Add column if not exists
ALTER TABLE table_name ADD COLUMN IF NOT EXISTS column_name TYPE;

-- SAFE: Create table if not exists  
CREATE TABLE IF NOT EXISTS table_name (...);

-- SAFE: Create index if not exists  
CREATE INDEX IF NOT EXISTS idx_name ON table(column);

-- SAFE: Insert with conflict handling
INSERT INTO table (...) VALUES (...) ON CONFLICT DO NOTHING;

-- SAFE: Drop column only if exists
ALTER TABLE table_name DROP COLUMN IF EXISTS column_name;
```

---

## 📁 Migration Rules

1. **Naming**: Use timestamp format `YYYYMMDDHHMMSS_description.sql`
2. **Never delete** existing migration files
3. **Never rename** applied migrations  
4. **Never modify** already-applied migrations - create new ones instead
5. **Use IF NOT EXISTS / IF EXISTS** for all CREATE/DROP statements

---

## 🔄 Applying Migrations Safely

```bash
# SAFE: Apply pending migrations
supabase migration up

# SAFE: Run a specific migration directly
psql -h localhost -p 54322 -U postgres -d postgres -f supabase/migrations/FILENAME.sql

# SAFE: Check migration status
supabase migration list
```

---

## 📜 Incident History

### 2026-01-16: First Reset Incident
`supabase db reset` destroyed all imported DMS bookings, customers, users, vehicles.

### 2026-01-18: Second Reset Incident  
`supabase db reset` run again despite these rules being in place. Rules were not strong enough.

**These incidents are why the rules above are ABSOLUTE with NO EXCEPTIONS.**

---

## 🚨 If You Are Claude Reading This

You have previously run `supabase db reset` TWICE on this project, destroying hours of work and real data both times. 

**DO NOT DO IT AGAIN. THERE IS NEVER A GOOD REASON.**

If a migration fails, FIX THE MIGRATION. Do not reset the database.
