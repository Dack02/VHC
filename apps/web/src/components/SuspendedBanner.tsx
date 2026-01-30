import { useAuth } from '../contexts/AuthContext'

export default function SuspendedBanner() {
  const { user } = useAuth()

  // Check if organization is suspended
  const isSuspended = user?.organization?.status === 'suspended'

  if (!isSuspended) return null

  return (
    <div className="bg-red-600 text-white px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center">
          <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <span className="font-semibold">Account Suspended</span>
            <span className="ml-2 text-red-100">
              Your organization's account has been suspended. Access is limited to read-only mode.
            </span>
          </div>
        </div>
        <a
          href="mailto:support@ollosoft.co.uk"
          className="bg-white text-red-600 px-4 py-1.5 rounded text-sm font-medium hover:bg-red-50 transition-colors"
        >
          Contact Support
        </a>
      </div>
    </div>
  )
}
