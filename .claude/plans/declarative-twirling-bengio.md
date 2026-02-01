# Plan: Auto-sync dev migrations from main

## Problem
Pushing to `main` only runs migrations against production Supabase. The dev environment never gets updated unless someone explicitly pushes to the `dev` branch.

## Solution
Add `main` to the trigger branches in `deploy-dev.yml`. This way every push to `main` triggers **both** `deploy-dev.yml` (dev migrations) and `deploy-production.yml` (production migrations), keeping dev in sync automatically.

## File to Modify
- `.github/workflows/deploy-dev.yml` — add `main` to the `on.push.branches` list

## Change
```yaml
# Before
on:
  push:
    branches:
      - dev
  workflow_dispatch:

# After
on:
  push:
    branches:
      - dev
      - main
  workflow_dispatch:
```

That's it — one line added.

## Also Update
- `.claude/CLAUDE.md` — update the Deployment Pipeline section to note that dev auto-syncs from main

## Verification
1. Push a commit to `main`
2. Confirm both `Deploy to Dev` and `Deploy to Production` workflows trigger in GitHub Actions
3. Both should show "Remote database is up to date" (or apply pending migrations)
