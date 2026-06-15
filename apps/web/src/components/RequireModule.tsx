import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useModules } from '../contexts/ModulesContext'
import type { ModuleKey } from '../lib/modules'

/**
 * Route guard: redirects to the dashboard if the given module is not enabled for
 * the current organisation. Optimistic-on while modules load (the API's
 * requireModule middleware is the real guard); redirects once a disabled module
 * resolves.
 */
export default function RequireModule({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { isEnabled, loading } = useModules()
  if (!loading && !isEnabled(module)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
