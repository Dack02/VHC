import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function DashboardLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold text-primary">VHC</h1>
          <p className="text-xs text-gray-500 mt-1">{user?.organization?.name}</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <Link
            to="/"
            className="block px-3 py-2 text-gray-700 hover:bg-gray-100 font-medium"
          >
            Dashboard
          </Link>
          <Link
            to="/health-checks"
            className="block px-3 py-2 text-gray-700 hover:bg-gray-100 font-medium"
          >
            Health Checks
          </Link>
          {['super_admin', 'org_admin', 'site_admin', 'service_advisor'].includes(user?.role || '') && (
            <>
              <Link
                to="/customers"
                className="block px-3 py-2 text-gray-700 hover:bg-gray-100 font-medium"
              >
                Customers
              </Link>
              <Link
                to="/templates"
                className="block px-3 py-2 text-gray-700 hover:bg-gray-100 font-medium"
              >
                Templates
              </Link>
            </>
          )}
          {['super_admin', 'org_admin', 'site_admin'].includes(user?.role || '') && (
            <Link
              to="/users"
              className="block px-3 py-2 text-gray-700 hover:bg-gray-100 font-medium"
            >
              Users
            </Link>
          )}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <div className="text-sm text-gray-600 mb-2">
            {user?.firstName} {user?.lastName}
          </div>
          <div className="text-xs text-gray-500 mb-3 capitalize">
            {user?.role?.replace('_', ' ')}
          </div>
          <button
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 text-gray-700 hover:bg-gray-100 text-sm"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              {user?.site && (
                <span className="text-sm text-gray-500">{user.site.name}</span>
              )}
            </div>
            <div className="flex items-center space-x-4">
              {/* Notification bell placeholder */}
              <button className="text-gray-500 hover:text-gray-700">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
