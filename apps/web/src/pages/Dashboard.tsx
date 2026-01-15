import { useAuth } from '../contexts/AuthContext'

export default function Dashboard() {
  const { user } = useAuth()

  return (
    <div>
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
