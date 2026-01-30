import { Link } from 'react-router-dom'

export default function SettingsBackLink() {
  return (
    <Link
      to="/settings"
      className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
    >
      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      Settings
    </Link>
  )
}
