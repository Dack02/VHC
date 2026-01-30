# Ollo Inspect - Manual Setup Checklist

What I need from you to complete deployment. Work through each section in order.

---

## 1. Supabase Cloud (2 projects needed)

Go to https://supabase.com/dashboard and create two **Pro plan** projects:

| Project | Name | Region |
|---|---|---|
| Production | `ollo-inspect-prod` | London / eu-west |
| Dev | `ollo-inspect-dev` | London / eu-west |

Then go to https://supabase.com/dashboard/account/tokens and create a **Personal Access Token** named `ollo-inspect-ci-cd`.

**What I need from you:**

For **each** project, go to Project Settings and copy:

```
PRODUCTION
──────────
Project Reference ID:    ______________________________
Project URL:             https://____________.supabase.co
Anon Key:                ______________________________
Service Role Key:        ______________________________
Database Password:       ______________________________

DEV
──────────
Project Reference ID:    ______________________________
Project URL:             https://____________.supabase.co
Anon Key:                ______________________________
Service Role Key:        ______________________________
Database Password:       ______________________________

SHARED
──────────
Personal Access Token:   ______________________________
```

**Where to find these:**
- Project Reference ID: it's in the URL when you open the project (`supabase.com/dashboard/project/<THIS_PART>`)
- Project URL + Anon Key + Service Role Key: Project Settings > API
- Database Password: Project Settings > Database

---

## 2. Railway (1 project, 2 environments)

Go to https://railway.app and either open your existing project or create a new one called `Ollo Inspect`.

**Step 1: Connect GitHub repo**
- Link the project to your GitHub repository

**Step 2: Create environments**
- You should have a default environment (rename it to `production` if needed)
- Create a second environment called `dev`

**Step 3: Create services in EACH environment**

Create these 5 services:

| # | Service Name | Type | How to create |
|---|---|---|---|
| 1 | `api` | GitHub repo | Add service > GitHub repo > select your repo |
| 2 | `worker` | GitHub repo | Add service > GitHub repo > select your repo |
| 3 | `web` | GitHub repo | Add service > GitHub repo > select your repo |
| 4 | `mobile` | GitHub repo | Add service > GitHub repo > select your repo |
| 5 | `redis` | Redis addon | Add service > Database > Redis |

**Step 4: Configure each GitHub service**

For **each** of the 4 GitHub services (api, worker, web, mobile), go to Service > Settings > Source and set:

- **Root Directory:** `/` (leave empty or set to repo root)
- **Branch:** `main` for production environment, `dev` for dev environment

For the **api**, **web**, and **mobile** services, also set the **Config File Path**:
- api: `apps/api/railway.toml`
- web: `apps/web/railway.toml`
- mobile: `apps/mobile/railway.toml`

For the **worker** service, set these directly in Settings (no config file):
- Build Command: `npm install && npm run build -w packages/shared && npm run build -w apps/api`
- Start Command: `node apps/api/dist/services/worker.js`
- Health Check: leave empty (workers don't serve HTTP)

**What I need from you:**

Once the services are created, I need the Railway-generated domain for each service (found in Service > Settings > Networking). These look like `xxx.up.railway.app`.

```
PRODUCTION
──────────
API domain:      ______________________.up.railway.app
Web domain:      ______________________.up.railway.app
Mobile domain:   ______________________.up.railway.app
Redis URL:       (Railway provides this automatically via ${{redis.REDIS_URL}})

DEV
──────────
API domain:      ______________________.up.railway.app
Web domain:      ______________________.up.railway.app
Mobile domain:   ______________________.up.railway.app
Redis URL:       (Railway provides this automatically via ${{redis.REDIS_URL}})
```

---

## 3. Environment Variables (Railway)

Once you have the Supabase credentials from Step 1, set these variables in the Railway dashboard for each service.

### API service (both environments)

**Production:**
```
NODE_ENV=production
SUPABASE_URL=<prod Project URL from Step 1>
SUPABASE_ANON_KEY=<prod Anon Key>
SUPABASE_SERVICE_KEY=<prod Service Role Key>
ENCRYPTION_KEY=<see below>
REDIS_URL=${{redis.REDIS_URL}}
ALLOWED_ORIGINS=https://inspect.ollosoft.io,https://m.inspect.ollosoft.io
WEB_URL=https://inspect.ollosoft.io
PUBLIC_APP_URL=https://inspect.ollosoft.io
API_PUBLIC_URL=https://api.inspect.ollosoft.io
LOG_LEVEL=info
SERVICE_NAME=vhc-api
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

**Dev:** Same keys but with dev values:
```
NODE_ENV=development
SUPABASE_URL=<dev Project URL>
SUPABASE_ANON_KEY=<dev Anon Key>
SUPABASE_SERVICE_KEY=<dev Service Role Key>
ENCRYPTION_KEY=<different key - see below>
REDIS_URL=${{redis.REDIS_URL}}
ALLOWED_ORIGINS=https://dev.inspect.ollosoft.io,https://m.dev.inspect.ollosoft.io
WEB_URL=https://dev.inspect.ollosoft.io
PUBLIC_APP_URL=https://dev.inspect.ollosoft.io
API_PUBLIC_URL=https://api.dev.inspect.ollosoft.io
LOG_LEVEL=debug
SERVICE_NAME=vhc-api-dev
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

**To generate ENCRYPTION_KEY** (run this twice, use different keys for prod and dev):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Worker service (both environments)

Use Railway variable references so it mirrors the API:
```
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

> These `${{api.VARIABLE}}` references only work if the API service is named exactly `api` and the Redis service is named exactly `redis` in Railway.

### Web service (both environments)

**Production:**
```
VITE_SUPABASE_URL=<prod Project URL>
VITE_SUPABASE_ANON_KEY=<prod Anon Key>
VITE_API_URL=https://api.inspect.ollosoft.io
```

**Dev:**
```
VITE_SUPABASE_URL=<dev Project URL>
VITE_SUPABASE_ANON_KEY=<dev Anon Key>
VITE_API_URL=https://api.dev.inspect.ollosoft.io
```

### Mobile service (both environments)

Same as Web service (same variables, same values per environment).

---

## 4. DNS Records

At your domain registrar for `ollosoft.io`, add these CNAME records.

Use the Railway domains you collected in Step 2.

**Production:**

| Type | Name | Points to |
|---|---|---|
| CNAME | `inspect` | `<web production domain>.up.railway.app` |
| CNAME | `api.inspect` | `<api production domain>.up.railway.app` |
| CNAME | `m.inspect` | `<mobile production domain>.up.railway.app` |

**Dev:**

| Type | Name | Points to |
|---|---|---|
| CNAME | `dev.inspect` | `<web dev domain>.up.railway.app` |
| CNAME | `api.dev.inspect` | `<api dev domain>.up.railway.app` |
| CNAME | `m.dev.inspect` | `<mobile dev domain>.up.railway.app` |

Then go back to Railway and add the custom domain to each service:
- Service > Settings > Networking > Custom Domain
- Railway handles SSL automatically

---

## 5. GitHub Secrets

Go to your GitHub repo > Settings > Secrets and variables > Actions.

Add these 5 secrets:

| Secret Name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Personal Access Token from Step 1 |
| `PRODUCTION_PROJECT_ID` | Production Project Reference ID |
| `PRODUCTION_DB_PASSWORD` | Production Database Password |
| `DEV_PROJECT_ID` | Dev Project Reference ID |
| `DEV_DB_PASSWORD` | Dev Database Password |

---

## 6. Supabase Auth Settings

In **each** Supabase project dashboard, go to Authentication > URL Configuration:

**Production project:**
- Site URL: `https://inspect.ollosoft.io`
- Add redirect URLs:
  - `https://inspect.ollosoft.io/**`
  - `https://m.inspect.ollosoft.io/**`
  - `https://api.inspect.ollosoft.io/**`

**Dev project:**
- Site URL: `https://dev.inspect.ollosoft.io`
- Add redirect URLs:
  - `https://dev.inspect.ollosoft.io/**`
  - `https://m.dev.inspect.ollosoft.io/**`
  - `https://api.dev.inspect.ollosoft.io/**`

---

## Summary

| Step | Where | What you're doing |
|---|---|---|
| 1 | Supabase | Create 2 projects, collect credentials |
| 2 | Railway | Create services, collect domains |
| 3 | Railway | Paste environment variables |
| 4 | DNS registrar + Railway | Add CNAME records + custom domains |
| 5 | GitHub | Add 5 secrets |
| 6 | Supabase | Set auth redirect URLs |

Once all 6 steps are done, push the `dev` branch to trigger the first deployment.
