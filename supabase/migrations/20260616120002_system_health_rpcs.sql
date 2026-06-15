-- =============================================================================
-- System-health RPCs for the Super Admin system dashboard (deep/`all` probes).
-- SECURITY DEFINER so service_role can read pg_database_size + the migration
-- history without broad grants. service_role only.
-- =============================================================================

CREATE OR REPLACE FUNCTION admin_db_stats()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'database_size_bytes', pg_database_size(current_database()),
    'database_size_pretty', pg_size_pretty(pg_database_size(current_database())),
    'top_tables', (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
        SELECT c.relname AS name,
               pg_total_relation_size(c.oid) AS size_bytes,
               pg_size_pretty(pg_total_relation_size(c.oid)) AS size_pretty
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 10
      ) t
    )
  );
$$;

CREATE OR REPLACE FUNCTION admin_migration_status()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'latest_version', (SELECT max(version) FROM supabase_migrations.schema_migrations),
    'count', (SELECT count(*) FROM supabase_migrations.schema_migrations)
  );
$$;

REVOKE ALL ON FUNCTION admin_db_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_migration_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_db_stats() TO service_role;
GRANT EXECUTE ON FUNCTION admin_migration_status() TO service_role;
