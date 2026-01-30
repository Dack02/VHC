# Ollo Inspect - Multi-Environment Deployment Implementation Guide

## Overview

This document provides a complete implementation specification for setting up a professional multi-environment deployment pipeline for Ollo Inspect, a multi-tenant SaaS Vehicle Health Check platform.

### Target Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     LOCAL       │    │       DEV       │    │   PRODUCTION    │
│                 │    │                 │    │                 │
│ Docker Supabase │    │ Supabase Cloud  │    │ Supabase Cloud  │
│ localhost:5180  │    │ Dev Project     │    │ Prod Project    │
│                 │    │                 │    │                 │
│ Local Dev Only  │    │ Railway Dev Env │    │ Railway Prod    │
│                 │    │ dev.inspect...  │    │ inspect.ollosoft│
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                      │                      │
         │                      │                      │
         ▼                      ▼                      ▼
    git commit            push to dev             push to main
                          branch                  branch
```

### Git Branch Strategy

- `main` → Production (inspect.ollosoft.io)
- `dev` → Development/Staging (dev.inspect.ollosoft.io)
- Feature branches → Created from `dev`, merged back to `dev`

---

## Part 1: Supabase Cloud Projects Setup

### 1.1 Create Two Supabase Projects

You need to create **two separate Supabase projects** in your Supabase dashboard:

1. **Production Project**: `ollo-inspect-prod`
   - Region: Choose closest to UK (London if available, or eu-west)
   - This will be used for production at `inspect.ollosoft.io`

2. **Development Project**: `ollo-inspect-dev`
   - Same region as production
   - This will be used for testing at `dev.inspect.ollosoft.io`

> ⚠️ **Important**: The dev project must be created fresh. Don't use an existing project that already has schema changes applied, as the CLI would try to reapply those changes.

### 1.2 Gather Project Credentials

For each project, collect the following from the Supabase Dashboard:

```
Project Settings → API:
- Project URL (SUPABASE_URL)
- anon/public key (SUPABASE_ANON_KEY)
- service_role key (SUPABASE_SERVICE_ROLE_KEY)

Project Settings → Database:
- Database Password (SUPABASE_DB_PASSWORD)
- Connection String (Transaction Pooler) - for migrations
- Project Reference ID (from URL: https://supabase.com/dashboard/project/<PROJECT_ID>)

Account Settings → Access Tokens:
- Personal Access Token (SUPABASE_ACCESS_TOKEN) - same for both projects
```

### 1.3 Generate Personal Access Token

Go to: https://supabase.com/dashboard/account/tokens

Create a new access token with a descriptive name like `ollo-inspect-ci-cd`. This token is used by the CLI for authentication in CI/CD pipelines.

---

## Part 2: Railway Multi-Environment Setup

### 2.1 Railway Project Configuration

Railway supports multiple environments within a single project. Here's how to set it up:

1. **Log into Railway Dashboard** (https://railway.app)

2. **Open your existing Ollo Inspect project** (or create one if it doesn't exist)

3. **Create a Dev Environment**:
   - Click the environment dropdown in the top navigation
   - Select "+ New Environment"
   - Choose "Duplicate Environment" to copy from production
   - Name it `dev` or `development`

4. **Configure Branch Triggers**:
   For each service (api, web, mobile) in each environment:
   
   **Production Environment**:
   - Go to Service → Settings → Source
   - Set "Branch connected" to `main`
   
   **Dev Environment**:
   - Go to Service → Settings → Source
   - Set "Branch connected" to `dev`

### 2.2 Environment Variables per Environment

Each Railway environment needs its own set of environment variables. Configure these in Railway's dashboard:

**Production Environment Variables**:
```bash
NODE_ENV=production
SUPABASE_URL=https://<PROD_PROJECT_ID>.supabase.co
SUPABASE_ANON_KEY=<PROD_ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<PROD_SERVICE_ROLE_KEY>
DATABASE_URL=postgresql://postgres:<PROD_DB_PASSWORD>@db.<PROD_PROJECT_ID>.supabase.co:5432/postgres
VITE_API_URL=https://api.inspect.ollosoft.io
```

**Dev Environment Variables**:
```bash
NODE_ENV=development
SUPABASE_URL=https://<DEV_PROJECT_ID>.supabase.co
SUPABASE_ANON_KEY=<DEV_ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<DEV_SERVICE_ROLE_KEY>
DATABASE_URL=postgresql://postgres:<DEV_DB_PASSWORD>@db.<DEV_PROJECT_ID>.supabase.co:5432/postgres
VITE_API_URL=https://api.dev.inspect.ollosoft.io
```

### 2.3 Custom Domains

Configure custom domains in Railway for each environment:

**Production**:
- api service: `api.inspect.ollosoft.io`
- web service: `inspect.ollosoft.io`

**Dev**:
- api service: `api.dev.inspect.ollosoft.io`
- web service: `dev.inspect.ollosoft.io`

### 2.4 Create Railway Project Tokens

For each environment, you need a project token for GitHub Actions:

1. Go to Project Settings → Tokens
2. Create token for production environment
3. Create token for dev environment

> Note: Project tokens are scoped to a specific environment.

---

## Part 3: GitHub Repository Configuration

### 3.1 GitHub Secrets

Add the following secrets to your GitHub repository (Settings → Secrets and variables → Actions):

```bash
# Supabase Access Token (same for all projects)
SUPABASE_ACCESS_TOKEN=<your_personal_access_token>

# Production Supabase
PRODUCTION_PROJECT_ID=<prod_project_reference_id>
PRODUCTION_DB_PASSWORD=<prod_database_password>
PRODUCTION_SUPABASE_URL=https://<PROD_PROJECT_ID>.supabase.co
PRODUCTION_SUPABASE_ANON_KEY=<prod_anon_key>
PRODUCTION_SUPABASE_SERVICE_ROLE_KEY=<prod_service_role_key>

# Dev Supabase
DEV_PROJECT_ID=<dev_project_reference_id>
DEV_DB_PASSWORD=<dev_database_password>
DEV_SUPABASE_URL=https://<DEV_PROJECT_ID>.supabase.co
DEV_SUPABASE_ANON_KEY=<dev_anon_key>
DEV_SUPABASE_SERVICE_ROLE_KEY=<dev_service_role_key>

# Railway Tokens (if using GitHub Actions to deploy)
RAILWAY_TOKEN_PRODUCTION=<production_environment_token>
RAILWAY_TOKEN_DEV=<dev_environment_token>
```

### 3.2 Branch Protection Rules (Recommended)

Set up branch protection for `main` and `dev`:

1. Go to Settings → Branches → Add rule
2. For `main` branch:
   - Require pull request reviews before merging
   - Require status checks to pass (CI workflow)
   - Require branches to be up to date before merging
3. For `dev` branch:
   - Require status checks to pass (CI workflow)

---

## Part 4: GitHub Actions Workflows

Create the following workflow files in `.github/workflows/`:

### 4.1 CI Workflow (ci.yml)

This runs on all pull requests to test migrations and code quality.

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      
      - name: Start Supabase local development setup
        run: supabase db start
      
      - name: Run database linting
        run: supabase db lint
      
      - name: Run database tests
        run: supabase test db
        continue-on-error: true  # Remove this once you have tests
      
      - name: Verify generated types are checked in
        run: |
          supabase gen types typescript --local > types.gen.ts
          if ! git diff --ignore-space-at-eol --exit-code --quiet types.gen.ts; then
            echo "Detected uncommitted changes after build. See status below:"
            git diff
            exit 1
          fi

  lint-and-test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linting
        run: npm run lint
        continue-on-error: true  # Remove once linting is clean
      
      - name: Run type checking
        run: npm run typecheck
        continue-on-error: true  # Remove once types are clean
      
      - name: Run tests
        run: npm test
        continue-on-error: true  # Remove once you have tests

  migration-dryrun:
    runs-on: ubuntu-latest
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ github.base_ref == 'main' && secrets.PRODUCTION_DB_PASSWORD || secrets.DEV_DB_PASSWORD }}
      SUPABASE_PROJECT_ID: ${{ github.base_ref == 'main' && secrets.PRODUCTION_PROJECT_ID || secrets.DEV_PROJECT_ID }}
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      
      - name: Link to Supabase project
        run: supabase link --project-ref $SUPABASE_PROJECT_ID
      
      - name: Dry run migrations
        run: supabase db push --dry-run
```

### 4.2 Dev Deployment Workflow (deploy-dev.yml)

This deploys to the dev environment when code is pushed to the `dev` branch.

```yaml
# .github/workflows/deploy-dev.yml
name: Deploy to Dev

on:
  push:
    branches:
      - dev
  workflow_dispatch:

jobs:
  migrate:
    runs-on: ubuntu-latest
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.DEV_DB_PASSWORD }}
      SUPABASE_PROJECT_ID: ${{ secrets.DEV_PROJECT_ID }}
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      
      - name: Link to Dev Supabase project
        run: supabase link --project-ref $SUPABASE_PROJECT_ID
      
      - name: Push database migrations
        run: supabase db push
      
      - name: Deploy Edge Functions (if any)
        run: supabase functions deploy --project-ref $SUPABASE_PROJECT_ID
        continue-on-error: true  # Skip if no functions exist

  notify:
    needs: migrate
    runs-on: ubuntu-latest
    steps:
      - name: Deployment notification
        run: |
          echo "✅ Dev environment deployed successfully!"
          echo "🌐 URL: https://dev.inspect.ollosoft.io"
          echo "📊 Supabase: https://supabase.com/dashboard/project/${{ secrets.DEV_PROJECT_ID }}"
```

### 4.3 Production Deployment Workflow (deploy-production.yml)

This deploys to production when code is pushed to the `main` branch.

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  migrate:
    runs-on: ubuntu-latest
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.PRODUCTION_DB_PASSWORD }}
      SUPABASE_PROJECT_ID: ${{ secrets.PRODUCTION_PROJECT_ID }}
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      
      - name: Link to Production Supabase project
        run: supabase link --project-ref $SUPABASE_PROJECT_ID
      
      - name: Push database migrations
        run: supabase db push
      
      - name: Deploy Edge Functions (if any)
        run: supabase functions deploy --project-ref $SUPABASE_PROJECT_ID
        continue-on-error: true  # Skip if no functions exist

  notify:
    needs: migrate
    runs-on: ubuntu-latest
    steps:
      - name: Production deployment notification
        run: |
          echo "🚀 Production environment deployed successfully!"
          echo "🌐 URL: https://inspect.ollosoft.io"
          echo "📊 Supabase: https://supabase.com/dashboard/project/${{ secrets.PRODUCTION_PROJECT_ID }}"
```

### 4.4 Type Generation Workflow (generate-types.yml)

Optional: Automatically generate and commit TypeScript types when schema changes.

```yaml
# .github/workflows/generate-types.yml
name: Generate Database Types

on:
  workflow_dispatch:
  schedule:
    # Run nightly at midnight UTC
    - cron: '0 0 * * *'

jobs:
  generate:
    runs-on: ubuntu-latest
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_PROJECT_ID: ${{ secrets.PRODUCTION_PROJECT_ID }}
    
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
          fetch-depth: 0
      
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      
      - name: Link to Supabase project
        run: supabase link --project-ref $SUPABASE_PROJECT_ID
      
      - name: Generate TypeScript types
        run: supabase gen types typescript --linked > src/types/database.types.ts
      
      - name: Check for changes
        id: git_status
        run: |
          if git diff --quiet src/types/database.types.ts; then
            echo "changes=false" >> $GITHUB_OUTPUT
          else
            echo "changes=true" >> $GITHUB_OUTPUT
          fi
      
      - name: Commit and push changes
        if: steps.git_status.outputs.changes == 'true'
        run: |
          git config --local user.email "github-actions[bot]@users.noreply.github.com"
          git config --local user.name "github-actions[bot]"
          git add src/types/database.types.ts
          git commit -m "chore: update database types"
          git push
```

---

## Part 5: Local Development Setup Updates

### 5.1 Update Supabase Configuration

Ensure your `supabase/config.toml` is properly configured:

```toml
# supabase/config.toml
[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
shadow_port = 54320
major_version = 15

[studio]
enabled = true
port = 54323
api_url = "http://localhost"

[inbucket]
enabled = true
port = 54324

[storage]
enabled = true

[auth]
enabled = true
site_url = "http://localhost:3000"

[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false

# Add additional auth configuration as needed for your multi-tenant setup
```

### 5.2 Migration Workflow Commands

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "db:start": "supabase start",
    "db:stop": "supabase stop",
    "db:reset": "supabase db reset",
    "db:diff": "supabase db diff",
    "db:new": "supabase migration new",
    "db:push:dev": "supabase db push --db-url $DEV_DATABASE_URL",
    "db:push:prod": "supabase db push --db-url $PROD_DATABASE_URL",
    "db:types": "supabase gen types typescript --local > src/types/database.types.ts",
    "db:types:linked": "supabase gen types typescript --linked > src/types/database.types.ts"
  }
}
```

### 5.3 Environment Files Structure

Create environment-specific configuration (these are for local reference, not committed):

```bash
# .env.local (for local development - gitignored)
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=<local_anon_key>
SUPABASE_SERVICE_ROLE_KEY=<local_service_role_key>
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres
VITE_API_URL=http://localhost:5180

# .env.example (committed to repo as template)
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
VITE_API_URL=
```

---

## Part 6: Migration Management Strategy

### 6.1 Creating Migrations

**Option A: Manual Migrations** (Recommended for complex changes)

```bash
# Create a new migration file
supabase migration new add_repair_groups_table

# This creates: supabase/migrations/<timestamp>_add_repair_groups_table.sql
# Edit the file manually with your SQL
```

**Option B: Auto Schema Diff** (Good for simple changes)

```bash
# Make changes in local Studio (localhost:54323)
# Then generate a diff
supabase db diff -f add_repair_groups_table

# This creates the migration with auto-generated SQL
```

### 6.2 Migration File Best Practices

```sql
-- supabase/migrations/20240130120000_add_repair_groups_table.sql

-- Always include comments explaining the migration
-- Migration: Add repair groups table for grouping related inspection findings

-- Create the table
CREATE TABLE IF NOT EXISTS public.repair_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes
CREATE INDEX idx_repair_groups_tenant_id ON public.repair_groups(tenant_id);

-- Enable RLS
ALTER TABLE public.repair_groups ENABLE ROW LEVEL SECURITY;

-- RLS Policies (critical for multi-tenant!)
CREATE POLICY "Tenant isolation for repair_groups"
    ON public.repair_groups
    FOR ALL
    USING (tenant_id = auth.jwt() ->> 'tenant_id');

-- Grant permissions
GRANT ALL ON public.repair_groups TO authenticated;
GRANT ALL ON public.repair_groups TO service_role;

-- Add trigger for updated_at
CREATE TRIGGER set_repair_groups_updated_at
    BEFORE UPDATE ON public.repair_groups
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
```

### 6.3 Migration Flow

```
1. Local Development
   └── Make changes locally
   └── Test thoroughly
   └── Create migration file
   └── Run `supabase db reset` to verify

2. Push to Dev Branch
   └── Create PR from feature branch to `dev`
   └── CI runs migration dry-run
   └── Review and merge
   └── GitHub Actions applies to Dev Supabase

3. Push to Production
   └── Create PR from `dev` to `main`
   └── CI validates migrations
   └── Review and merge
   └── GitHub Actions applies to Production Supabase
```

### 6.4 Handling Migration Conflicts

If a teammate's migration conflicts with yours:

```bash
# Pull latest changes
git pull origin dev

# Check current migrations
supabase migration list

# If conflicts exist, rename your migration with a new timestamp
mv supabase/migrations/<old_timestamp>_my_migration.sql \
   supabase/migrations/<new_timestamp>_my_migration.sql

# Reset local to verify all migrations apply cleanly
supabase db reset

# Commit the renamed migration
git add supabase/migrations/
git commit -m "fix: rebase migration timestamp"
```

---

## Part 7: Initial Setup Commands

### 7.1 First-Time Supabase CLI Setup

```bash
# Install Supabase CLI (if not already installed)
npm install -g supabase

# Login to Supabase
supabase login

# Link to your production project first (to pull existing schema)
supabase link --project-ref <PRODUCTION_PROJECT_ID>

# Pull existing schema from production (if you have one)
supabase db pull

# This creates: supabase/migrations/<timestamp>_remote_schema.sql
```

### 7.2 Sync Dev Project with Production Schema

```bash
# Link to dev project
supabase link --project-ref <DEV_PROJECT_ID>

# Push all migrations to dev
supabase db push

# Verify migrations are in sync
supabase migration list
```

### 7.3 Seed Data (Optional)

Create a seed file for development data:

```sql
-- supabase/seed.sql
-- This runs after migrations during `supabase db reset`

-- Insert test tenant
INSERT INTO public.tenants (id, name, slug) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Test Workshop', 'test-workshop');

-- Insert test users
INSERT INTO auth.users (id, email) VALUES
    ('00000000-0000-0000-0000-000000000002', 'admin@test-workshop.com');

-- Add more seed data as needed for development
```

---

## Part 8: Railway Configuration Files

### 8.1 Update railway.toml Files

Update each app's `railway.toml` to support multiple environments:

**apps/api/railway.toml**:
```toml
[build]
builder = "NIXPACKS"

[deploy]
numReplicas = 1
healthcheckPath = "/health"
healthcheckTimeout = 100
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

**apps/web/railway.toml**:
```toml
[build]
builder = "NIXPACKS"

[deploy]
numReplicas = 1
healthcheckPath = "/"
healthcheckTimeout = 100
```

### 8.2 Railway Environment Variables

Configure these in Railway dashboard for each environment:

**Both Environments**:
```bash
# API Service
PORT=5180
NODE_ENV=<production|development>

# Web Service
VITE_API_URL=<environment-specific-api-url>
```

---

## Part 9: Multi-Tenant Considerations

### 9.1 RLS Policy Testing

Before deploying migrations, test RLS policies locally:

```sql
-- Test that RLS works correctly
SET request.jwt.claim.tenant_id = '00000000-0000-0000-0000-000000000001';

-- This should return only tenant's data
SELECT * FROM public.repair_groups;

-- This should fail or return empty
SET request.jwt.claim.tenant_id = 'different-tenant-id';
SELECT * FROM public.repair_groups;
```

### 9.2 Database Backups

For production, enable Point-in-Time Recovery in Supabase:
1. Go to Project Settings → Database
2. Enable "Point-in-Time Recovery"
3. Configure backup retention (default: 7 days)

### 9.3 Rate Limiting

Configure different rate limits per environment:

**Dev**: More lenient for testing
**Production**: Stricter for security

---

## Part 10: Monitoring and Observability

### 10.1 Error Tracking (Recommended: Sentry)

Add Sentry for error tracking:

```bash
npm install @sentry/node
```

Configure in your API:
```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

### 10.2 Uptime Monitoring

Set up uptime monitoring for production:
- Use Railway's built-in metrics
- Consider external monitoring (e.g., UptimeRobot, Better Uptime)

### 10.3 Database Monitoring

Monitor database performance in Supabase Dashboard:
- Query performance
- Connection pooling
- Storage usage

---

## Part 11: Deployment Checklist

### Pre-Deployment Checklist

- [ ] All tests pass locally
- [ ] Migrations tested with `supabase db reset`
- [ ] RLS policies verified for multi-tenant security
- [ ] TypeScript types generated and up-to-date
- [ ] Environment variables documented
- [ ] PR reviewed and approved

### Post-Deployment Checklist

- [ ] Verify migrations applied (check Supabase dashboard)
- [ ] Test critical user flows
- [ ] Monitor error tracking for new issues
- [ ] Check API response times
- [ ] Verify multi-tenant data isolation

---

## Part 12: Troubleshooting

### Common Issues

**Migration fails in CI but works locally**:
```bash
# Ensure your local schema matches remote
supabase db pull --schema public
supabase db reset
```

**Permission denied errors**:
```sql
-- Grant postgres permissions to graphql schema
GRANT ALL ON ALL TABLES IN SCHEMA graphql TO postgres, anon, authenticated, service_role;
```

**Type generation fails**:
```bash
# Ensure you're linked to the correct project
supabase link --project-ref <PROJECT_ID>
supabase gen types typescript --linked
```

**Railway deployment not triggering**:
- Verify branch is connected in Railway settings
- Check GitHub integration permissions
- Manually trigger via Railway dashboard

---

## Implementation Order

Execute these steps in order:

1. **Create Supabase Projects** (30 mins)
   - Create dev and production projects
   - Collect all credentials

2. **Configure Railway Environments** (30 mins)
   - Create dev environment
   - Set environment variables
   - Configure branch triggers

3. **Set Up GitHub Secrets** (15 mins)
   - Add all required secrets
   - Configure branch protection

4. **Create GitHub Workflows** (30 mins)
   - Create all workflow files
   - Test CI workflow on a PR

5. **Sync Initial Schema** (30 mins)
   - Pull schema from production
   - Push to dev project
   - Verify migrations are in sync

6. **Test Full Pipeline** (1 hour)
   - Create test migration locally
   - Push to dev branch
   - Verify dev deployment
   - Merge to main
   - Verify production deployment

7. **Configure Domains** (30 mins)
   - Set up DNS for inspect.ollosoft.io
   - Set up DNS for dev.inspect.ollosoft.io
   - Configure SSL certificates

---

## Summary

This setup provides:

- ✅ **Local Development**: Docker-based Supabase for isolated development
- ✅ **Automated Dev Deployments**: Push to `dev` branch auto-deploys
- ✅ **Automated Production Deployments**: Push to `main` branch auto-deploys
- ✅ **Migration Safety**: CI validates migrations before deployment
- ✅ **Multi-Tenant Security**: RLS policies tested and enforced
- ✅ **Type Safety**: Auto-generated TypeScript types
- ✅ **Audit Trail**: All changes tracked in Git history

Total estimated implementation time: **4-5 hours**

---

## References

- [Supabase Managing Environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Railway Environments](https://docs.railway.com/reference/environments)
- [Supabase GitHub Actions Example](https://github.com/supabase/supabase-action-example)
- [Railway GitHub Actions](https://blog.railway.com/p/github-actions)
