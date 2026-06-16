import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// The app's primary session is the custom one issued by our API (stored under the
// vhc_* localStorage keys). This Supabase client is used only transiently for the
// Google OAuth handshake: signInWithOAuth stores a PKCE verifier, then /auth/callback
// lets the client detect the ?code in the URL and exchange it for a session, which we
// hand to POST /api/v1/auth/oauth/exchange. autoRefreshToken is off because we never
// keep this Supabase session alive — we refresh our own session via the API.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
    autoRefreshToken: false,
    flowType: 'pkce',
  },
})
