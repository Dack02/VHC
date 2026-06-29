/**
 * DEV-ONLY auto-login.
 *
 * Lets an automated/headless browser (and you, during local dev) skip the login
 * screen so the real authenticated UI is visible immediately. It performs a
 * genuine login against the API, so the session carries a valid JWT and all
 * data loads normally — nothing is faked.
 *
 * Triple-gated so it can NEVER run in a production build:
 *   1. `import.meta.env.DEV` is false in any `vite build` output.
 *   2. Requires `VITE_DEV_AUTOLOGIN === '1'` (set only in the gitignored
 *      `apps/web/.env.local`).
 *   3. Requires both credential vars to be present (also gitignored).
 *
 * Credentials live ONLY in `apps/web/.env.local` (gitignored) — never committed.
 * To disable, delete `.env.local` or set `VITE_DEV_AUTOLOGIN=0`.
 */

const SESSION_KEY = 'vhc_session'
const USER_KEY = 'vhc_user'
const ORGS_KEY = 'vhc_organizations'
const ACTIVE_ORG_KEY = 'vhc_active_org_id'

export async function maybeDevAutoLogin(): Promise<void> {
  // Gate 1: stripped from production builds.
  if (!import.meta.env.DEV) return
  // Gate 2: opt-in flag.
  if (import.meta.env.VITE_DEV_AUTOLOGIN !== '1') return

  // Gate 2b: only act on the dedicated preview server (default :5183), so your
  // own manual dev server (e.g. :5181) is never silently logged in as this user.
  // Set VITE_DEV_AUTOLOGIN_PORT='' to allow any port.
  const autoPort = import.meta.env.VITE_DEV_AUTOLOGIN_PORT
  const wantPort = autoPort === undefined ? '5183' : String(autoPort)
  if (wantPort !== '' && location.port !== wantPort) return

  const email = import.meta.env.VITE_DEV_AUTOLOGIN_EMAIL as string | undefined
  const password = import.meta.env.VITE_DEV_AUTOLOGIN_PASSWORD as string | undefined
  // Gate 3: credentials must be configured.
  if (!email || !password) return

  // Don't clobber an existing (possibly different) session.
  if (localStorage.getItem(SESSION_KEY)) return

  const apiUrl = (import.meta.env.VITE_API_URL as string) || 'http://localhost:5180'

  try {
    const res = await fetch(`${apiUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      console.warn(`[devAutoLogin] login failed (${res.status}); falling back to login screen.`)
      return
    }
    const data = await res.json() as {
      user: { organization?: { id?: string } }
      session: unknown
      organizations?: unknown[]
    }

    // Mirror AuthContext.loginWithSessionData() exactly.
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    localStorage.setItem(SESSION_KEY, JSON.stringify(data.session))
    localStorage.setItem(ORGS_KEY, JSON.stringify(data.organizations || []))
    const orgId = data.user?.organization?.id
    if (orgId) localStorage.setItem(ACTIVE_ORG_KEY, orgId)

    console.info('[devAutoLogin] signed in as', email)
  } catch (err) {
    console.warn('[devAutoLogin] error; falling back to login screen.', err)
  }
}
