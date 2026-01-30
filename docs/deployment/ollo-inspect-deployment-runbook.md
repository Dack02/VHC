# Ollo Inspect - Deployment Runbook

> **This is the actionable deployment guide.** It covers every step needed to get Ollo Inspect running in staging (dev) and production environments. It includes required code changes, infrastructure setup, and configuration.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Pre-Deployment Code Changes](#2-pre-deployment-code-changes-required)
3. [Supabase Cloud Setup](#3-supabase-cloud-setup)
4. [Railway Setup](#4-railway-setup)
5. [GitHub Actions CI/CD](#5-github-actions-cicd)
6. [DNS & Custom Domains](#6-dns--custom-domains)
7. [Environment Variables Reference](#7-environment-variables-reference)
8. [Deployment Execution Steps](#8-deployment-execution-steps)
9. [Post-Deployment Verification](#9-post-deployment-verification)
10. [Ongoing Operations](#10-ongoing-operations)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Architecture Overview

### Environments

| Environment | Branch | URL (Web) | URL (API) | URL (Mobile) |
|---|---|---|---|---|
| **Local** | any | `localhost:5181` | `localhost:5180` | `localhost:5182` |
| **Dev/Staging** | `dev` | `dev.inspect.ollosoft.io` | `api.dev.inspect.ollosoft.io` | `m.dev.inspect.ollosoft.io` |
| **Production** | `main` | `inspect.ollosoft.io` | `api.inspect.ollosoft.io` | `m.inspect.ollosoft.io` |

### Railway Services per Environment (5 services)

```
Railway Project: Ollo Inspect
├── [Production Environment] (branch: main)
│   ├── API Service          (Hono + Node.js)
│   ├── Worker Service       (BullMQ worker process)
│   ├── Web Service          (React SPA - static files)
│   ├── Mobile Service       (React PWA - static files)
│   └── Redis Service        (Railway Redis addon)
│
└── [Dev Environment] (branch: dev)
    ├── API Service
    ├── Worker Service
    ├── Web Service
    ├── Mobile Service
    └── Redis Service
```

### Supabase Cloud (2 separate projects)

```
Supabase Dashboard
├── ollo-inspect-prod    (Production database)
└── ollo-inspect-dev     (Dev/Staging database)
```

### Git Branch Strategy

```
main ──────────────────────────────── Production
  ↑
dev ───────────────────────────────── Dev/Staging
  ↑
feature/xyz ───────────────────────── Feature work (merge to dev)
```

---

## 2. Pre-Deployment Code Changes (Required)

These code changes must be made **before** deploying. They fix deployment-blocking issues found in the current codebase.

### 2.1 Fix WebSocket CORS (Blocking)

**File:** `apps/api/src/services/websocket.ts`

The WebSocket CORS origins are hardcoded to localhost. They must read from `ALLOWED_ORIGINS` like the HTTP CORS does.

**Change the `initializeWebSocket` function:**

```typescript
// BEFORE (hardcoded localhost only):
export function initializeWebSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: [
        'http://localhost:5181',
        // ... etc
      ],
      credentials: true
    },
    // ...
  })

// AFTER (reads from environment):
export function initializeWebSocket(httpServer: HttpServer): Server {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [
        'http://localhost:5181',
        'http://localhost:5182',
        'http://localhost:5183',
        'http://localhost:5184',
        'http://127.0.0.1:5181',
        'http://127.0.0.1:5182',
        'http://127.0.0.1:5183',
        'http://127.0.0.1:5184'
      ]

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true
    },
    // ...
  })
```

### 2.2 Add `serve` Package for Static Hosting (Blocking)

The web and mobile Railway services use `npx serve` to host static files, but `serve` is not a listed dependency. Install it at the root so both apps can use it:

```bash
npm install --save-dev serve
```

> The `railway.toml` start commands referencing `serve` are defined in Section 2.3 below.

### 2.3 Fix Railway Build Commands for Monorepo (Blocking)

Railway needs to build from the monorepo root because `@vhc/shared` must be built first. Each service in Railway should have its **root directory** set to the repo root (`/`), and the build/start commands should reference the specific app.

**`apps/api/railway.toml`** - update:
```toml
[build]
builder = "NIXPACKS"
buildCommand = "npm install && npm run build -w packages/shared && npm run build -w apps/api"
nixpacksConfigPath = "apps/api/nixpacks.toml"

[deploy]
startCommand = "node apps/api/dist/index.js"
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 5
```

**Create `apps/api/nixpacks.toml`** (for Puppeteer/Chromium):
```toml
[phases.setup]
aptPkgs = ["chromium", "fonts-liberation", "libappindicator3-1", "libasound2", "libatk-bridge2.0-0", "libatk1.0-0", "libcups2", "libdbus-1-3", "libdrm2", "libgbm1", "libgtk-3-0", "libnspr4", "libnss3", "libx11-xcb1", "libxcomposite1", "libxdamage1", "libxrandr2", "xdg-utils"]

[variables]
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = "true"
PUPPETEER_EXECUTABLE_PATH = "/usr/bin/chromium"
```

> **Note on Puppeteer:** The `nixpacks.toml` installs system Chromium and tells Puppeteer to use it instead of downloading its own copy. This avoids the 280MB+ download during build.
>
> **Chromium path caveat:** On some Ubuntu versions, Chromium installs to `/usr/bin/chromium-browser` instead of `/usr/bin/chromium`. If PDF generation fails after deploy with "Could not find Chromium", check which path exists in the container (`railway run -- which chromium chromium-browser`) and update `PUPPETEER_EXECUTABLE_PATH` accordingly.

**`apps/web/railway.toml`** - update:
```toml
[build]
builder = "NIXPACKS"
buildCommand = "npm install && npm run build -w packages/shared && npm run build -w apps/web"

[deploy]
startCommand = "npx serve -s apps/web/dist -l $PORT"
healthcheckPath = "/"
healthcheckTimeout = 100
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

**`apps/mobile/railway.toml`** - update:
```toml
[build]
builder = "NIXPACKS"
buildCommand = "npm install && npm run build -w packages/shared && npm run build -w apps/mobile"

[deploy]
startCommand = "npx serve -s apps/mobile/dist -l $PORT"
healthcheckPath = "/"
healthcheckTimeout = 100
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

**Worker service** - configure directly in Railway dashboard (not via toml file):

The worker shares the same codebase as the API but runs a different start command. Since Railway auto-detects `railway.toml` by filename and you can't have two for the same directory, configure the worker service entirely through the Railway dashboard:

- **Build Command:** `npm install && npm run build -w packages/shared && npm run build -w apps/api`
- **Start Command:** `node apps/api/dist/services/worker.js`
- **Restart Policy:** On Failure, max 5 retries
- **Health Check:** None (workers don't serve HTTP)

> **Railway monorepo config:** Each service must have its **Root Directory** set to `/` (repo root) in Railway dashboard under Service > Settings > Source. For the api, web, and mobile services, also set the **Config File Path** to point to the correct `railway.toml` (e.g., `apps/api/railway.toml`). This tells Railway which toml to use when multiple services share the same root directory.

### 2.4 Remove Hardcoded PORT from railway.toml (Blocking)

Remove the `[env]` sections from all `railway.toml` files. Railway assigns its own `$PORT` dynamically. Hardcoding `PORT = "5180"` will conflict.

The API code already reads `process.env.PORT` and falls back to 5180 for local dev - this is correct.

### 2.5 Update .env.example Files

Add missing env vars to `apps/api/.env.example`:

```bash
# Add these lines:
ALLOWED_ORIGINS=http://localhost:5181,http://localhost:5182
WEB_URL=http://localhost:5181
PUBLIC_APP_URL=http://localhost:5183
```

---

## 3. Supabase Cloud Setup

### 3.1 Create Two Supabase Projects

Go to: https://supabase.com/dashboard

Create **two projects** in the same organization:

| Project Name | Purpose | Region |
|---|---|---|
| `ollo-inspect-prod` | Production | London / eu-west |
| `ollo-inspect-dev` | Staging/Dev | London / eu-west (same as prod) |

**For each project, collect these credentials** (you'll need them for Railway and GitHub):

```
From Project Settings > API:
  - Project URL                    → SUPABASE_URL
  - anon/public key                → SUPABASE_ANON_KEY  (also VITE_SUPABASE_ANON_KEY)
  - service_role key               → SUPABASE_SERVICE_KEY

From Project Settings > Database:
  - Database Password              → SUPABASE_DB_PASSWORD
  - Connection String (Pooler)     → DATABASE_URL (for migrations)
  - Project Reference ID           → PROJECT_ID (from URL)

From Account Settings > Access Tokens:
  - Personal Access Token          → SUPABASE_ACCESS_TOKEN (one token, used for both projects)
```

### 3.2 Create a Personal Access Token

Go to: https://supabase.com/dashboard/account/tokens

Create token named: `ollo-inspect-ci-cd`

This is used by the Supabase CLI in GitHub Actions for running migrations.

### 3.3 Initial Schema Migration to Cloud

Once both projects exist, push the existing 51+ migrations to each:

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login
supabase login

# --- Push to DEV project first ---
supabase link --project-ref <DEV_PROJECT_ID>
supabase db push

# Verify
supabase migration list

# --- Then push to PRODUCTION ---
supabase link --project-ref <PROD_PROJECT_ID>
supabase db push

# Verify
supabase migration list
```

> **Important:** Both projects must be fresh (no prior schema). If a project already has tables, you'll need to reset it first via the Supabase dashboard (Settings > General > Delete project, then recreate).

### 3.4 Supabase Auth Configuration

In each Supabase project dashboard, configure:

**Authentication > URL Configuration:**

**Production project:**
- Site URL: `https://inspect.ollosoft.io`
- Redirect URLs:
  - `https://inspect.ollosoft.io/**`
  - `https://m.inspect.ollosoft.io/**`
  - `https://api.inspect.ollosoft.io/**`

**Dev project:**
- Site URL: `https://dev.inspect.ollosoft.io`
- Redirect URLs:
  - `https://dev.inspect.ollosoft.io/**`
  - `https://m.dev.inspect.ollosoft.io/**`
  - `https://api.dev.inspect.ollosoft.io/**`

**Authentication > Email Templates:**
- Customize if needed for your branding

### 3.5 Bootstrap Initial Data

After migrations are applied, both cloud databases will be empty. You need to create the initial organization, site, and admin user to make the app usable.

**Step 1: Create the first admin user via Supabase Auth**

In the Supabase dashboard for each project:
1. Go to Authentication > Users
2. Click "Add User" > "Create New User"
3. Enter the admin email and password
4. Note the generated `user_id` (UUID)

**Step 2: Insert initial organization and site data**

Run the following SQL in the Supabase SQL Editor (adjust values as needed):

```sql
-- Create the organization
INSERT INTO public.organizations (id, name, slug)
VALUES (
  gen_random_uuid(),
  'Your Dealership Name',
  'your-dealership'
);

-- Get the org ID for subsequent inserts
-- (or use the UUID you just generated)

-- Create the first site
INSERT INTO public.sites (id, organization_id, name, slug)
VALUES (
  gen_random_uuid(),
  '<ORGANIZATION_ID>',
  'Main Workshop',
  'main-workshop'
);

-- Link the admin user to the organization with super_admin role
INSERT INTO public.users (id, email, role, organization_id, site_id, first_name, last_name)
VALUES (
  '<AUTH_USER_ID>',
  'admin@yourdomain.com',
  'org_admin',
  '<ORGANIZATION_ID>',
  '<SITE_ID>',
  'Admin',
  'User'
);
```

> **Note:** The exact column names may vary - check your `organizations`, `sites`, and `users` table schemas. Run this on the **dev** project first to verify, then repeat on **production** when ready.

**Step 3: Seed dev environment with test data (optional)**

For the dev environment, you may want additional test data (customers, vehicles, health checks). Create a seed script at `supabase/seed.sql` that can be referenced for populating the dev database.

---

## 4. Railway Setup

### 4.1 Create Railway Project

1. Log into https://railway.app
2. Create a new project or open existing `Ollo Inspect`
3. Connect your GitHub repository

### 4.2 Create Two Environments

Railway supports multiple environments within a single project:

1. Click the environment dropdown (top nav)
2. Ensure you have a **Production** environment (usually the default)
3. Create a **Dev** environment:
   - Click "+ New Environment"
   - Name it `dev`

### 4.3 Create Services (per environment)

In **each environment**, create these 5 services:

| Service Name | Type | Source | Root Dir | Config File | Branch |
|---|---|---|---|---|---|
| `api` | GitHub repo | monorepo | `/` | `apps/api/railway.toml` | `main` (prod) / `dev` (dev) |
| `worker` | GitHub repo | monorepo | `/` | Manual config (see below) | `main` (prod) / `dev` (dev) |
| `web` | GitHub repo | monorepo | `/` | `apps/web/railway.toml` | `main` (prod) / `dev` (dev) |
| `mobile` | GitHub repo | monorepo | `/` | `apps/mobile/railway.toml` | `main` (prod) / `dev` (dev) |
| `redis` | Railway addon | Redis | - | - | - |

**For each GitHub-sourced service:**
1. Go to Service > Settings > Source
2. Set "Root Directory" to `/` (repo root)
3. Set the correct branch trigger (`main` for prod, `dev` for dev)

**For the Worker service** (no railway.toml auto-detection):
- Build Command: `npm install && npm run build -w packages/shared && npm run build -w apps/api`
- Start Command: `node apps/api/dist/services/worker.js`
- No health check path (workers don't serve HTTP)

**For the Redis service:**
- Use Railway's built-in Redis addon
- Note the `REDIS_URL` it provides (automatically injected)

### 4.4 Configure Environment Variables

Set these in Railway dashboard for each service in each environment.

#### API Service

**Production:**
```bash
NODE_ENV=production
SUPABASE_URL=https://<PROD_PROJECT_ID>.supabase.co
SUPABASE_ANON_KEY=<prod_anon_key>
SUPABASE_SERVICE_KEY=<prod_service_role_key>
ENCRYPTION_KEY=<generate_a_32_byte_hex_key>
REDIS_URL=${{redis.REDIS_URL}}
ALLOWED_ORIGINS=https://inspect.ollosoft.io,https://m.inspect.ollosoft.io
WEB_URL=https://inspect.ollosoft.io
PUBLIC_APP_URL=https://inspect.ollosoft.io
API_PUBLIC_URL=https://api.inspect.ollosoft.io
LOG_LEVEL=info
SERVICE_NAME=vhc-api
# Optional integrations:
RESEND_API_KEY=<your_resend_key>
EMAIL_FROM=noreply@inspect.ollosoft.io
TWILIO_ACCOUNT_SID=<your_twilio_sid>
TWILIO_AUTH_TOKEN=<your_twilio_token>
TWILIO_PHONE_NUMBER=<your_twilio_number>
ANTHROPIC_API_KEY=<your_anthropic_key>
SENTRY_DSN=<your_sentry_dsn>
# Puppeteer:
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

**Dev** - same as production but with dev values:
```bash
NODE_ENV=development
SUPABASE_URL=https://<DEV_PROJECT_ID>.supabase.co
SUPABASE_ANON_KEY=<dev_anon_key>
SUPABASE_SERVICE_KEY=<dev_service_role_key>
ENCRYPTION_KEY=<different_key_for_dev>
REDIS_URL=${{redis.REDIS_URL}}
ALLOWED_ORIGINS=https://dev.inspect.ollosoft.io,https://m.dev.inspect.ollosoft.io
WEB_URL=https://dev.inspect.ollosoft.io
PUBLIC_APP_URL=https://dev.inspect.ollosoft.io
API_PUBLIC_URL=https://api.dev.inspect.ollosoft.io
LOG_LEVEL=debug
SERVICE_NAME=vhc-api-dev
```

> **Generating ENCRYPTION_KEY:** Run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` to generate a 32-byte hex key. Use **different keys** for dev and prod.

#### Worker Service

Same environment variables as the API service (it reads the same env vars). Use Railway's variable references to share them:

```bash
NODE_ENV=${{api.NODE_ENV}}
SUPABASE_URL=${{api.SUPABASE_URL}}
SUPABASE_ANON_KEY=${{api.SUPABASE_ANON_KEY}}
SUPABASE_SERVICE_KEY=${{api.SUPABASE_SERVICE_KEY}}
ENCRYPTION_KEY=${{api.ENCRYPTION_KEY}}
REDIS_URL=${{redis.REDIS_URL}}
WEB_URL=${{api.WEB_URL}}
PUBLIC_APP_URL=${{api.PUBLIC_APP_URL}}
RESEND_API_KEY=${{api.RESEND_API_KEY}}
EMAIL_FROM=${{api.EMAIL_FROM}}
TWILIO_ACCOUNT_SID=${{api.TWILIO_ACCOUNT_SID}}
TWILIO_AUTH_TOKEN=${{api.TWILIO_AUTH_TOKEN}}
TWILIO_PHONE_NUMBER=${{api.TWILIO_PHONE_NUMBER}}
```

> **Important:** Railway variable references like `${{api.VARIABLE}}` require the source service to be named exactly `api` and the Redis service named exactly `redis` in Railway. If you name them differently, update the references accordingly.

#### Web Service

```bash
NODE_ENV=production
VITE_SUPABASE_URL=https://<PROJECT_ID>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>
VITE_API_URL=https://api.inspect.ollosoft.io    # (or api.dev.inspect.ollosoft.io for dev)
```

> **Note:** Vite env vars (`VITE_*`) are embedded at **build time**, not runtime. Changing them requires a rebuild.

#### Mobile Service

Same as Web but with appropriate API URL:
```bash
NODE_ENV=production
VITE_SUPABASE_URL=https://<PROJECT_ID>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>
VITE_API_URL=https://api.inspect.ollosoft.io
```

---

## 5. GitHub Actions CI/CD

Create the `.github/workflows/` directory and the following workflow files.

### 5.1 CI Workflow (runs on all PRs)

**File: `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  workflow_dispatch:

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Build shared package
        run: npm run build -w packages/shared

      - name: Type check API
        run: npm run lint -w apps/api
        continue-on-error: true

      - name: Type check Web
        run: npm run lint -w apps/web
        continue-on-error: true

      - name: Type check Mobile
        run: npm run lint -w apps/mobile
        continue-on-error: true
        # NOTE: All three type checks above use continue-on-error: true so that
        # CI doesn't block merges while existing type errors are being resolved.
        # Once all type errors are fixed, remove continue-on-error from each step
        # so CI enforces type safety on all future PRs.

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

### 5.2 Deploy Dev (runs on push to dev branch)

**File: `.github/workflows/deploy-dev.yml`**

```yaml
name: Deploy to Dev

on:
  push:
    branches:
      - dev
  workflow_dispatch:

jobs:
  migrate-dev:
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

      - name: Deployment summary
        run: |
          echo "## Dev Deployment" >> $GITHUB_STEP_SUMMARY
          echo "- Migrations applied to dev Supabase project" >> $GITHUB_STEP_SUMMARY
          echo "- Railway will auto-deploy from dev branch" >> $GITHUB_STEP_SUMMARY
          echo "- Web: https://dev.inspect.ollosoft.io" >> $GITHUB_STEP_SUMMARY
          echo "- API: https://api.dev.inspect.ollosoft.io" >> $GITHUB_STEP_SUMMARY
```

### 5.3 Deploy Production (runs on push to main branch)

**File: `.github/workflows/deploy-production.yml`**

```yaml
name: Deploy to Production

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  migrate-production:
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

      - name: Deployment summary
        run: |
          echo "## Production Deployment" >> $GITHUB_STEP_SUMMARY
          echo "- Migrations applied to production Supabase project" >> $GITHUB_STEP_SUMMARY
          echo "- Railway will auto-deploy from main branch" >> $GITHUB_STEP_SUMMARY
          echo "- Web: https://inspect.ollosoft.io" >> $GITHUB_STEP_SUMMARY
          echo "- API: https://api.inspect.ollosoft.io" >> $GITHUB_STEP_SUMMARY
```

### 5.4 GitHub Secrets Required

Add these in **GitHub repo > Settings > Secrets and variables > Actions**:

| Secret Name | Value | Source |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Personal access token | Supabase account settings |
| `PRODUCTION_PROJECT_ID` | Prod project reference ID | Supabase dashboard URL |
| `PRODUCTION_DB_PASSWORD` | Prod database password | Supabase project settings |
| `DEV_PROJECT_ID` | Dev project reference ID | Supabase dashboard URL |
| `DEV_DB_PASSWORD` | Dev database password | Supabase project settings |

---

## 6. DNS & Custom Domains

### 6.1 DNS Records

Add these DNS records at your domain registrar (for `ollosoft.io`):

**Production:**

| Type | Name | Value | Notes |
|---|---|---|---|
| CNAME | `inspect` | `<railway-web-service>.up.railway.app` | Web dashboard |
| CNAME | `api.inspect` | `<railway-api-service>.up.railway.app` | API server |
| CNAME | `m.inspect` | `<railway-mobile-service>.up.railway.app` | Mobile PWA |

**Dev:**

| Type | Name | Value | Notes |
|---|---|---|---|
| CNAME | `dev.inspect` | `<railway-web-dev-service>.up.railway.app` | Dev web |
| CNAME | `api.dev.inspect` | `<railway-api-dev-service>.up.railway.app` | Dev API |
| CNAME | `m.dev.inspect` | `<railway-mobile-dev-service>.up.railway.app` | Dev mobile |

> Railway provides the `.up.railway.app` domain for each service. Find these in Service > Settings > Networking.

### 6.2 Configure Custom Domains in Railway

For each service, go to **Service > Settings > Networking > Custom Domain** and add the corresponding domain. Railway automatically provisions SSL certificates via Let's Encrypt.

---

## 7. Environment Variables Reference

### Complete API Environment Variables

| Variable | Required | Example Value | Description |
|---|---|---|---|
| `PORT` | No | (Railway assigns) | HTTP port - let Railway manage |
| `NODE_ENV` | Yes | `production` | Environment mode |
| `SUPABASE_URL` | **Yes** | `https://xxx.supabase.co` | Supabase project URL |
| `SUPABASE_ANON_KEY` | **Yes** | `eyJ...` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_KEY` | **Yes** | `eyJ...` | Supabase service role key (secret!) |
| `ENCRYPTION_KEY` | **Yes** | `64-char hex string` | 32-byte hex key for encrypting DMS credentials |
| `REDIS_URL` | **Yes** (prod) | `redis://...` | Redis connection string (from Railway addon) |
| `ALLOWED_ORIGINS` | **Yes** (prod) | `https://inspect.ollosoft.io,https://m.inspect.ollosoft.io` | Comma-separated CORS origins |
| `WEB_URL` | **Yes** (prod) | `https://inspect.ollosoft.io` | Web app URL (for link generation in emails) |
| `PUBLIC_APP_URL` | **Yes** (prod) | `https://inspect.ollosoft.io` | Public-facing URL for customer links |
| `API_PUBLIC_URL` | No | `https://api.inspect.ollosoft.io` | API's own public URL |
| `RESEND_API_KEY` | No | `re_...` | Resend email API key |
| `EMAIL_FROM` | No | `noreply@inspect.ollosoft.io` | From address for emails |
| `TWILIO_ACCOUNT_SID` | No | `AC...` | Twilio SMS account SID |
| `TWILIO_AUTH_TOKEN` | No | `...` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | No | `+44...` | Twilio sender number |
| `ANTHROPIC_API_KEY` | No | `sk-ant-...` | Claude AI API key |
| `SENTRY_DSN` | No | `https://...@sentry.io/...` | Error tracking DSN |
| `LOG_LEVEL` | No | `info` | Logging level (debug/info/warn/error) |
| `SERVICE_NAME` | No | `vhc-api` | Service identifier in logs |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | Yes (prod) | `true` | Use system Chromium |
| `PUPPETEER_EXECUTABLE_PATH` | Yes (prod) | `/usr/bin/chromium` | Path to system Chromium |

### Frontend Environment Variables (Web & Mobile)

| Variable | Required | Example Value | Description |
|---|---|---|---|
| `VITE_SUPABASE_URL` | **Yes** | `https://xxx.supabase.co` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | **Yes** | `eyJ...` | Supabase anonymous key |
| `VITE_API_URL` | **Yes** | `https://api.inspect.ollosoft.io` | API base URL |

> `VITE_*` variables are baked into the JS bundle at build time. Changing them requires a rebuild/redeploy.

---

## 8. Deployment Execution Steps

Follow these steps in order.

### Phase 1: Code Changes

- [ ] Apply WebSocket CORS fix (Section 2.1)
- [ ] Add `serve` dependency at root level (Section 2.2)
- [ ] Update all `railway.toml` files (Section 2.3)
- [ ] Create `apps/api/nixpacks.toml` for Chromium (Section 2.3)
- [ ] Remove hardcoded PORT from railway.toml env sections (Section 2.4)
- [ ] Update `.env.example` files (Section 2.5)
- [ ] Create GitHub Actions workflow files (Section 5)
- [ ] Commit all changes to `dev` branch

### Phase 2: Supabase Cloud

- [ ] Create `ollo-inspect-prod` Supabase project
- [ ] Create `ollo-inspect-dev` Supabase project
- [ ] Generate personal access token for CI/CD
- [ ] Record all credentials (see Section 3.1 table)
- [ ] Push migrations to dev project: `supabase link --project-ref <DEV_ID> && supabase db push`
- [ ] Push migrations to prod project: `supabase link --project-ref <PROD_ID> && supabase db push`
- [ ] Verify migration count matches on both projects
- [ ] Configure auth settings (redirect URLs) on both projects
- [ ] Bootstrap initial data: create admin user, organization, and site (Section 3.5)
- [ ] Seed dev environment with test data if desired (Section 3.5)

### Phase 3: Railway

- [ ] Create Railway project (or open existing)
- [ ] Create `dev` environment
- [ ] Add Redis addon to both environments
- [ ] Create API service (both environments)
- [ ] Create Worker service (both environments)
- [ ] Create Web service (both environments)
- [ ] Create Mobile service (both environments)
- [ ] Set root directory to `/` for all GitHub services
- [ ] Configure branch triggers (main for prod, dev for dev)
- [ ] Set all environment variables (Section 4.4)
- [ ] Trigger first deploy on dev environment

### Phase 4: DNS & Domains

- [ ] Add CNAME records for all 6 domains
- [ ] Configure custom domains in Railway for each service
- [ ] Wait for SSL certificate provisioning
- [ ] Verify all domains resolve correctly

### Phase 5: GitHub

- [ ] Add all GitHub secrets (Section 5.4)
- [ ] Set up branch protection rules for `main` (require PR review)
- [ ] Set up branch protection rules for `dev` (require CI pass)
- [ ] Test CI workflow by opening a PR

### Phase 6: Verification

- [ ] Run full post-deployment verification (Section 9)

---

## 9. Post-Deployment Verification

### API Health Check

```bash
# Dev
curl https://api.dev.inspect.ollosoft.io/health
# Expected: {"status":"ok","timestamp":"...","service":"vhc-api"}

# Production
curl https://api.inspect.ollosoft.io/health
```

### API Version Endpoint

```bash
curl https://api.inspect.ollosoft.io/api/v1
# Expected: {"message":"VHC API v1","version":"1.0.0"}
```

### Web App

- Visit `https://inspect.ollosoft.io` - should load the login page
- Verify Supabase auth works (sign in)
- Check browser console for CORS errors
- Check Network tab for API calls resolving correctly

### Mobile App

- Visit `https://m.inspect.ollosoft.io` on a mobile device
- Verify PWA install prompt appears
- Test login flow

### WebSocket Connectivity

- Open browser dev tools > Network > WS tab
- After login, verify a WebSocket connection is established to the API
- Check for no CORS errors in the console

### Worker Verification

- Check Railway logs for the worker service
- Look for "Worker started" or similar initialization messages
- Verify Redis connection is established (check worker logs)

### End-to-End Test

1. Log in as a service advisor
2. Create a new health check
3. Assign to a technician
4. Switch to technician view (mobile app)
5. Complete an inspection
6. Verify real-time status updates via WebSocket
7. Test customer notification (email/SMS)
8. Generate a PDF report

---

## 10. Ongoing Operations

### Migration Workflow

```
1. Create migration locally:
   supabase migration new <description>

2. Edit the SQL file in supabase/migrations/

3. Test locally:
   psql -h localhost -p 54422 -U postgres -d postgres -f supabase/migrations/<file>.sql

4. Commit and push to dev branch

5. GitHub Actions automatically pushes migration to dev Supabase

6. After testing on dev, merge dev → main via PR

7. GitHub Actions automatically pushes migration to production Supabase
```

### Rollback Strategy

Supabase migrations are **forward-only**. To "rollback":

1. Create a NEW migration that reverses the changes
2. Test locally first
3. Push through the normal dev → prod pipeline

### Monitoring

- **Railway Dashboard:** CPU, memory, network metrics per service
- **Supabase Dashboard:** Query performance, connection pooling, storage usage
- **Sentry** (if configured): Error tracking and alerting
- **Railway Logs:** Real-time log streaming per service

### Scaling

- Increase Railway service replicas via dashboard
- Upgrade Supabase plan for more database connections/storage
- Redis scaling via Railway addon settings

---

## 11. Troubleshooting

### "CORS error" in browser console

**Cause:** `ALLOWED_ORIGINS` env var is missing or incorrect on the API service.

**Fix:** Verify the `ALLOWED_ORIGINS` value in Railway includes your exact domain (with `https://`, no trailing slash). Both HTTP and WebSocket CORS must be configured.

### Railway build fails with "Cannot find module @vhc/shared"

**Cause:** The shared package isn't built before the app.

**Fix:** Ensure the build command is: `npm install && npm run build -w packages/shared && npm run build -w apps/<app>`

### Puppeteer fails with "Could not find Chromium"

**Cause:** Chromium isn't installed in the container, or the path is wrong.

**Fix:**
1. Ensure `apps/api/nixpacks.toml` exists with the apt packages listed in Section 2.3
2. Ensure env vars `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` and `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` are set
3. If still failing, the binary may be at `/usr/bin/chromium-browser` instead (varies by Ubuntu version). Check with `railway run -- which chromium chromium-browser` and update the env var

### Migrations fail in GitHub Actions

**Cause:** Usually a missing or incorrect secret.

**Fix:**
1. Verify `SUPABASE_ACCESS_TOKEN` is set in GitHub secrets
2. Verify the project ID matches the Supabase dashboard URL
3. Verify the database password is correct
4. Run `supabase db push --dry-run` locally to test

### Worker not processing jobs

**Cause:** Redis connection failed or REDIS_URL is wrong.

**Fix:**
1. Check worker logs in Railway for connection errors
2. Verify `REDIS_URL` is set correctly (use Railway's `${{redis.REDIS_URL}}` reference)
3. Check Redis service is running in Railway

### Frontend shows blank page after deploy

**Cause:** Usually a missing `VITE_*` env var at build time.

**Fix:** `VITE_*` variables must be set BEFORE the build runs. After changing them in Railway, trigger a redeploy (not just a restart - the app needs to rebuild).

### "supabase db push" applies no migrations

**Cause:** All migrations already applied, or schema mismatch.

**Fix:** Run `supabase migration list` to see which migrations are pending. If the remote has manual schema changes not tracked in migrations, you may need to `supabase db pull` first.

### WebSocket connections fail silently

**Cause:** Railway may be terminating WebSocket connections if they're not on the correct port or path.

**Fix:** Ensure the API service uses Railway's dynamic `$PORT`. Socket.io connects on the same port as HTTP. Check that no proxy/CDN is stripping WebSocket upgrade headers.

---

## Credentials Tracking Sheet

Use this to track credentials as you collect them. **Do not commit this file with real values.**

```
=== SUPABASE ===
Personal Access Token:      ___________________________________

--- Production Project ---
Project Name:               ollo-inspect-prod
Project Ref ID:             ___________________________________
Project URL:                https://___________.supabase.co
Anon Key:                   ___________________________________
Service Role Key:           ___________________________________
DB Password:                ___________________________________

--- Dev Project ---
Project Name:               ollo-inspect-dev
Project Ref ID:             ___________________________________
Project URL:                https://___________.supabase.co
Anon Key:                   ___________________________________
Service Role Key:           ___________________________________
DB Password:                ___________________________________

=== RAILWAY ===
Project Name:               Ollo Inspect
Redis URL (prod):           (auto-injected by Railway)
Redis URL (dev):            (auto-injected by Railway)

=== THIRD-PARTY SERVICES ===
Resend API Key:             ___________________________________
Twilio Account SID:         ___________________________________
Twilio Auth Token:          ___________________________________
Twilio Phone Number:        ___________________________________
Anthropic API Key:          ___________________________________
Sentry DSN:                 ___________________________________
Encryption Key (prod):      ___________________________________
Encryption Key (dev):       ___________________________________
```

---

## Summary

**Total Railway services per environment:** 5 (API, Worker, Web, Mobile, Redis)
**Total Railway services across both environments:** 10
**Total Supabase projects:** 2 (dev, prod) - Pro plan
**GitHub Actions workflows:** 3 (CI, deploy-dev, deploy-production)
**DNS records to create:** 6 CNAME records
**GitHub secrets to add:** 5
**Code changes required before deploy:** 5 items (Section 2)

**Note on third-party services:** Resend (email) and Twilio (SMS) credentials are configured per-organization through the application UI by org admins, not at the infrastructure level. The `RESEND_API_KEY` and `TWILIO_*` env vars serve as platform-level fallbacks only.
