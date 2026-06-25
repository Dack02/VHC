# Google Sign-In / Sign-Up Setup

"Continue with Google" on the public **sign-up** (`/signup`) and **login** (`/login`)
pages is built in code, but it is inert until the Google provider is enabled in each
Supabase project. This is dashboard configuration — it can't be done from the repo.

## How the flow works (for reference)

1. User clicks the Google button → `supabase.auth.signInWithOAuth({ provider: 'google' })`
   redirects the browser to Google.
2. Google redirects back to **Supabase** at `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Supabase creates/links a verified auth user and redirects to our app at
   `/auth/callback` with a PKCE `?code`.
4. `apps/web/src/pages/AuthCallback.tsx` exchanges the code for a Supabase session and
   POSTs it to `POST /api/v1/auth/oauth/exchange`.
5. The API (`apps/api/src/routes/auth.ts`) verifies the Google identity and either:
   - returns the normal app session for an **existing** user, or
   - for a **new** user, asks for a business name, then provisions the organization via
     `provisionOrganization({ existingAuthUserId })` and returns the app session.

No new environment variables are required — the app reuses `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY`, and the redirect URL is derived from `window.location.origin`.

## 1. Create a Google OAuth client

In the [Google Cloud Console](https://console.cloud.google.com/):

1. **APIs & Services → OAuth consent screen** — configure it (External), add the app
   name, support email, and your domain to *Authorized domains*. Publish it (or add test
   users while in Testing).
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized JavaScript origins**: your app origins, e.g.
     - `http://localhost:5181` (local web dev)
     - `https://app.your-domain.com` (production web)
   - **Authorized redirect URIs**: the **Supabase** callback for each project (NOT the app):
     - `https://abjorenmuxbofdxenhfe.supabase.co/auth/v1/callback` (dev project)
     - `https://<PROD_PROJECT_REF>.supabase.co/auth/v1/callback` (production project)
3. Copy the generated **Client ID** and **Client secret**.

> You can use one Google OAuth client for both Supabase projects by adding both
> redirect URIs, or create a separate client per environment.

## 2. Enable the provider in Supabase (do this for BOTH projects)

For the **dev** project (`abjorenmuxbofdxenhfe`) and the **production** project:

1. **Authentication → Providers → Google** → enable, paste the **Client ID** and
   **Client secret**, save.
2. **Authentication → URL Configuration**:
   - **Site URL**: the app's base URL for that environment
     (`http://localhost:5181` for dev, the production web URL for prod).
   - **Redirect URLs** (allow-list) — must include the app callback for that env:
     - `http://localhost:5181/auth/callback`
     - `https://app.your-domain.com/auth/callback`
3. Leave **"Confirm email"** on so Google identities link to existing accounts by their
   verified email (see below).

## 3. Account linking (existing email/password users)

Supabase links a Google sign-in to an existing auth user when the email is the same and
verified — so someone who originally signed up with email/password can later click
"Continue with Google" and land on the same account. Keep email confirmation enabled for
this to work cleanly.

As a safety net, `POST /api/v1/auth/oauth/exchange` also re-links by verified email: if a
`users` row exists for the Google email under a different `auth_id`, its membership(s) are
re-pointed to the Google auth user (logged as `[oauth] Re-linking …`). This is safe
because Google has proven ownership of the email.

## 4. New-org behaviour

Google provides a name + email but no business name, so a brand-new Google user is shown a
one-field "business name" step on `/auth/callback` (with terms acceptance) before the
organization is provisioned. New-org creation respects the same
`platform_settings.features.allowSelfSignup` kill-switch as the email signup form; when
self-signup is off, existing users can still sign in with Google but new orgs cannot be
created (the page shows "signups are currently closed").

## 5. Verify

1. Enable the provider on the **dev** project per the steps above.
2. Visit `https://<dev-web-url>/signup` (or `http://localhost:5181/signup`).
3. Click **Sign up with Google**, choose a Google account, enter a business name → you
   should land in onboarding as the org admin.
4. Sign out, then use **Sign in with Google** on `/login` with the same account → straight
   to the dashboard.
