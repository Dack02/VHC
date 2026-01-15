import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Dashboard() {
  const { user } = useAuth()

  // Check if onboarding is incomplete (only show for org admins)
  const showOnboardingReminder =
    user?.isOrgAdmin &&
    user?.organization?.onboardingCompleted === false

  return (
    <div>
      {/* Onboarding Reminder Banner */}
      {showOnboardingReminder && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-amber-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="font-medium text-amber-800">Complete your organization setup</p>
                <p className="text-sm text-amber-700">Finish setting up your organization to unlock all features.</p>
              </div>
            </div>
            <Link
              to="/onboarding"
              className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors text-sm font-medium"
            >
              Continue Setup
            </Link>
          </div>
        </div>
      )}

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white border border-gray-200 shadow-sm p-6">
          <div className="text-3xl font-bold text-gray-900">0</div>
          <div className="text-sm text-gray-500 mt-1">Health Checks Today</div>
        </div>
        <div className="bg-white border border-gray-200 shadow-sm p-6">
          <div className="text-3xl font-bold text-rag-amber">0</div>
          <div className="text-sm text-gray-500 mt-1">Awaiting Pricing</div>
        </div>
        <div className="bg-white border border-gray-200 shadow-sm p-6">
          <div className="text-3xl font-bold text-rag-green">0</div>
          <div className="text-sm text-gray-500 mt-1">Customer Authorized</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 shadow-sm p-6">
        <h2 className="text-lg font-semibold mb-4">Welcome, {user?.firstName}!</h2>
        <p className="text-gray-600">
          You are logged in as <span className="font-medium capitalize">{user?.role?.replace('_', ' ')}</span>
          {user?.site && <> at <span className="font-medium">{user.site.name}</span></>}.
        </p>

        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="bg-rag-green-bg p-4 border-l-4 border-rag-green">
            <div className="text-2xl font-bold text-rag-green">0</div>
            <div className="text-sm text-gray-600">Passed</div>
          </div>
          <div className="bg-rag-amber-bg p-4 border-l-4 border-rag-amber">
            <div className="text-2xl font-bold text-rag-amber">0</div>
            <div className="text-sm text-gray-600">Advisory</div>
          </div>
          <div className="bg-rag-red-bg p-4 border-l-4 border-rag-red">
            <div className="text-2xl font-bold text-rag-red">0</div>
            <div className="text-sm text-gray-600">Urgent</div>
          </div>
        </div>
      </div>
    </div>
  )
}
