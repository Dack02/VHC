interface OnboardingStatus {
  organizationId: string
  organizationName: string
  onboardingCompleted: boolean
  currentStep: number
  hasSettings: boolean
  hasSites: boolean
  hasTeamMembers: boolean
  sitesCount: number
  teamMembersCount: number
}

interface Props {
  status: OnboardingStatus | null
  onComplete: () => void
}

export default function Step5Ready({ status, onComplete }: Props) {
  const checkmarks = [
    {
      label: 'Business details configured',
      completed: status?.hasSettings || false
    },
    {
      label: 'First site created',
      completed: status?.hasSites || false
    },
    {
      label: 'Team members invited',
      completed: status?.hasTeamMembers || false,
      optional: true
    },
    {
      label: 'Notifications configured',
      completed: true,
      optional: true
    }
  ]

  return (
    <div className="text-center">
      {/* Success Icon */}
      <div className="mx-auto w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
        <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-2">You're All Set!</h2>
      <p className="text-gray-500 mb-8 max-w-md mx-auto">
        Your organization is ready to start creating vehicle health checks.
        Here's what we've set up for you:
      </p>

      {/* Checklist */}
      <div className="bg-gray-50 rounded-lg p-6 mb-8 max-w-md mx-auto text-left">
        <ul className="space-y-3">
          {checkmarks.map((item, index) => (
            <li key={index} className="flex items-center space-x-3">
              {item.completed ? (
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <span className={item.completed ? 'text-gray-900' : 'text-gray-500'}>
                {item.label}
                {item.optional && !item.completed && (
                  <span className="text-xs text-gray-400 ml-1">(optional)</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-8 max-w-sm mx-auto">
        <div className="bg-primary/5 rounded-lg p-4">
          <div className="text-3xl font-bold text-primary">{status?.sitesCount || 0}</div>
          <div className="text-sm text-gray-600">Site{(status?.sitesCount || 0) !== 1 ? 's' : ''}</div>
        </div>
        <div className="bg-primary/5 rounded-lg p-4">
          <div className="text-3xl font-bold text-primary">{status?.teamMembersCount || 0}</div>
          <div className="text-sm text-gray-600">Team Member{(status?.teamMembersCount || 0) !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {/* Next Steps */}
      <div className="bg-blue-50 rounded-lg p-6 mb-8 max-w-lg mx-auto text-left">
        <h3 className="text-lg font-medium text-blue-900 mb-3">What's Next?</h3>
        <ul className="space-y-2 text-sm text-blue-800">
          <li className="flex items-start space-x-2">
            <span className="text-blue-500">1.</span>
            <span>Create your first health check from the dashboard</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="text-blue-500">2.</span>
            <span>Customize your check template with items relevant to your business</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="text-blue-500">3.</span>
            <span>Add your company logo in Settings to personalize reports</span>
          </li>
          <li className="flex items-start space-x-2">
            <span className="text-blue-500">4.</span>
            <span>Invite more team members as your business grows</span>
          </li>
        </ul>
      </div>

      {/* Action Button */}
      <button
        onClick={onComplete}
        className="px-8 py-3 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors text-lg font-medium"
      >
        Go to Dashboard
      </button>

      {/* Help Link */}
      <p className="mt-6 text-sm text-gray-500">
        Need help? Check out our{' '}
        <a href="#" className="text-primary hover:underline">
          getting started guide
        </a>{' '}
        or{' '}
        <a href="mailto:support@vhc.com" className="text-primary hover:underline">
          contact support
        </a>
      </p>
    </div>
  )
}
