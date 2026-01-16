/**
 * Phase 10 Migration: Audit Logs Table + Performance Indexes
 * Run with: npx tsx src/scripts/apply-phase10-migration.ts
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function applyMigration() {
  console.log('Applying Phase 10 migration...\n')

  // 1. Create audit_logs table
  console.log('1. Creating audit_logs table...')
  const { error: auditError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        action VARCHAR(100) NOT NULL,
        actor_id UUID,
        actor_type VARCHAR(20) NOT NULL DEFAULT 'user',
        organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
        resource_type VARCHAR(50),
        resource_id UUID,
        metadata JSONB,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Index for querying by organization
      CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(organization_id, created_at DESC);

      -- Index for querying by actor
      CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id, created_at DESC);

      -- Index for querying by action type
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC);

      -- Index for querying by resource
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

      COMMENT ON TABLE audit_logs IS 'Audit trail for sensitive actions in the system';
    `
  })

  if (auditError) {
    console.log('  Note: audit_logs table may already exist or error occurred:', auditError.message)
  } else {
    console.log('  ✓ audit_logs table created')
  }

  // 2. Add performance indexes to health_checks
  console.log('\n2. Adding performance indexes to health_checks...')
  const healthCheckIndexes = [
    {
      name: 'idx_health_checks_org_status',
      sql: 'CREATE INDEX IF NOT EXISTS idx_health_checks_org_status ON health_checks(organization_id, status);'
    },
    {
      name: 'idx_health_checks_org_created',
      sql: 'CREATE INDEX IF NOT EXISTS idx_health_checks_org_created ON health_checks(organization_id, created_at DESC);'
    },
    {
      name: 'idx_health_checks_technician',
      sql: 'CREATE INDEX IF NOT EXISTS idx_health_checks_technician ON health_checks(technician_id, status);'
    },
    {
      name: 'idx_health_checks_advisor',
      sql: 'CREATE INDEX IF NOT EXISTS idx_health_checks_advisor ON health_checks(advisor_id, status);'
    },
    {
      name: 'idx_health_checks_customer',
      sql: 'CREATE INDEX IF NOT EXISTS idx_health_checks_customer ON health_checks(customer_id, created_at DESC);'
    },
    {
      name: 'idx_health_checks_vehicle',
      sql: 'CREATE INDEX IF NOT EXISTS idx_health_checks_vehicle ON health_checks(vehicle_id, created_at DESC);'
    },
    {
      name: 'idx_health_checks_site',
      sql: 'CREATE INDEX IF NOT EXISTS idx_health_checks_site ON health_checks(site_id, status);'
    },
    {
      name: 'idx_health_checks_promise_time',
      sql: 'CREATE INDEX IF NOT EXISTS idx_health_checks_promise_time ON health_checks(promise_time) WHERE promise_time IS NOT NULL;'
    },
    {
      name: 'idx_health_checks_token',
      sql: 'CREATE INDEX IF NOT EXISTS idx_health_checks_token ON health_checks(public_token) WHERE public_token IS NOT NULL;'
    },
    {
      name: 'idx_health_checks_token_expires',
      sql: 'CREATE INDEX IF NOT EXISTS idx_health_checks_token_expires ON health_checks(public_expires_at) WHERE public_expires_at IS NOT NULL;'
    }
  ]

  for (const idx of healthCheckIndexes) {
    const { error } = await supabase.rpc('exec_sql', { sql: idx.sql })
    if (error && !error.message.includes('already exists')) {
      console.log(`  Warning: ${idx.name}:`, error.message)
    } else {
      console.log(`  ✓ ${idx.name}`)
    }
  }

  // 3. Add performance indexes to check_results
  console.log('\n3. Adding performance indexes to check_results...')
  const resultIndexes = [
    {
      name: 'idx_check_results_health_check',
      sql: 'CREATE INDEX IF NOT EXISTS idx_check_results_health_check ON check_results(health_check_id);'
    },
    {
      name: 'idx_check_results_rag',
      sql: 'CREATE INDEX IF NOT EXISTS idx_check_results_rag ON check_results(health_check_id, rag_status);'
    }
  ]

  for (const idx of resultIndexes) {
    const { error } = await supabase.rpc('exec_sql', { sql: idx.sql })
    if (error && !error.message.includes('already exists')) {
      console.log(`  Warning: ${idx.name}:`, error.message)
    } else {
      console.log(`  ✓ ${idx.name}`)
    }
  }

  // 4. Add performance indexes to repair_items
  console.log('\n4. Adding performance indexes to repair_items...')
  const repairIndexes = [
    {
      name: 'idx_repair_items_health_check',
      sql: 'CREATE INDEX IF NOT EXISTS idx_repair_items_health_check ON repair_items(health_check_id);'
    },
    {
      name: 'idx_repair_items_approved',
      sql: 'CREATE INDEX IF NOT EXISTS idx_repair_items_approved ON repair_items(health_check_id, is_approved);'
    }
  ]

  for (const idx of repairIndexes) {
    const { error } = await supabase.rpc('exec_sql', { sql: idx.sql })
    if (error && !error.message.includes('already exists')) {
      console.log(`  Warning: ${idx.name}:`, error.message)
    } else {
      console.log(`  ✓ ${idx.name}`)
    }
  }

  // 5. Add performance indexes to status_history
  console.log('\n5. Adding performance indexes to status_history...')
  const statusIndexes = [
    {
      name: 'idx_status_history_health_check',
      sql: 'CREATE INDEX IF NOT EXISTS idx_status_history_health_check ON status_history(health_check_id, created_at DESC);'
    }
  ]

  for (const idx of statusIndexes) {
    const { error } = await supabase.rpc('exec_sql', { sql: idx.sql })
    if (error && !error.message.includes('already exists')) {
      console.log(`  Warning: ${idx.name}:`, error.message)
    } else {
      console.log(`  ✓ ${idx.name}`)
    }
  }

  // 6. Add performance indexes to notifications
  console.log('\n6. Adding performance indexes to notifications...')
  const notifIndexes = [
    {
      name: 'idx_notifications_user_unread',
      sql: 'CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);'
    },
    {
      name: 'idx_notifications_org',
      sql: 'CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications(organization_id, created_at DESC);'
    }
  ]

  for (const idx of notifIndexes) {
    const { error } = await supabase.rpc('exec_sql', { sql: idx.sql })
    if (error && !error.message.includes('already exists')) {
      console.log(`  Warning: ${idx.name}:`, error.message)
    } else {
      console.log(`  ✓ ${idx.name}`)
    }
  }

  // 7. Add composite index for dashboard queries
  console.log('\n7. Adding composite indexes for dashboard queries...')
  const dashboardIndexes = [
    {
      name: 'idx_health_checks_dashboard',
      sql: `CREATE INDEX IF NOT EXISTS idx_health_checks_dashboard
            ON health_checks(organization_id, status, created_at DESC)
            INCLUDE (vehicle_id, customer_id, technician_id, advisor_id, promise_time);`
    }
  ]

  for (const idx of dashboardIndexes) {
    const { error } = await supabase.rpc('exec_sql', { sql: idx.sql })
    if (error && !error.message.includes('already exists')) {
      console.log(`  Warning: ${idx.name}:`, error.message)
    } else {
      console.log(`  ✓ ${idx.name}`)
    }
  }

  // 8. Add index for users
  console.log('\n8. Adding performance indexes to users...')
  const userIndexes = [
    {
      name: 'idx_users_org_role',
      sql: 'CREATE INDEX IF NOT EXISTS idx_users_org_role ON users(organization_id, role, is_active);'
    },
    {
      name: 'idx_users_site',
      sql: 'CREATE INDEX IF NOT EXISTS idx_users_site ON users(site_id, is_active) WHERE site_id IS NOT NULL;'
    },
    {
      name: 'idx_users_auth_id',
      sql: 'CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);'
    }
  ]

  for (const idx of userIndexes) {
    const { error } = await supabase.rpc('exec_sql', { sql: idx.sql })
    if (error && !error.message.includes('already exists')) {
      console.log(`  Warning: ${idx.name}:`, error.message)
    } else {
      console.log(`  ✓ ${idx.name}`)
    }
  }

  // 9. Add index for customers and vehicles
  console.log('\n9. Adding performance indexes to customers and vehicles...')
  const custVehIndexes = [
    {
      name: 'idx_customers_org',
      sql: 'CREATE INDEX IF NOT EXISTS idx_customers_org ON customers(organization_id);'
    },
    {
      name: 'idx_vehicles_customer',
      sql: 'CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);'
    },
    {
      name: 'idx_vehicles_registration',
      sql: 'CREATE INDEX IF NOT EXISTS idx_vehicles_registration ON vehicles(organization_id, registration);'
    }
  ]

  for (const idx of custVehIndexes) {
    const { error } = await supabase.rpc('exec_sql', { sql: idx.sql })
    if (error && !error.message.includes('already exists')) {
      console.log(`  Warning: ${idx.name}:`, error.message)
    } else {
      console.log(`  ✓ ${idx.name}`)
    }
  }

  console.log('\n✅ Phase 10 migration complete!')
}

applyMigration().catch(console.error)
