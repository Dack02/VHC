import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

/**
 * Safety net for Supabase password-recovery links.
 *
 * Recovery links generated without an explicit `redirectTo` (e.g. older staff
 * invites) land on the app root with the recovery session in the URL hash.
 * supabase-js parses that hash and fires a PASSWORD_RECOVERY event; this listener
 * forwards the user to /reset-password where they can set a new password.
 */
export default function RecoveryRedirect() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && location.pathname !== '/reset-password') {
        navigate('/reset-password')
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [navigate, location.pathname])

  return null
}
