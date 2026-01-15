import { useState } from 'react'
import { api } from '../../../lib/api'

interface Props {
  token: string
  onNext: () => void
  onBack: () => void
}

interface TeamMember {
  id: string
  firstName: string
  lastName: string
  email: string
  role: 'site_admin' | 'service_advisor' | 'technician'
}

const ROLES = [
  { value: 'site_admin', label: 'Site Admin', description: 'Can manage site settings and users' },
  { value: 'service_advisor', label: 'Service Advisor', description: 'Can create and manage health checks' },
  { value: 'technician', label: 'Technician', description: 'Can perform inspections on mobile' }
]

export default function Step3InviteTeam({ token, onNext, onBack }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [members, setMembers] = useState<TeamMember[]>([])
  const [newMember, setNewMember] = useState({
    firstName: '',
    lastName: '',
    email: '',
    role: 'technician' as const
  })

  const handleAddMember = () => {
    if (!newMember.firstName || !newMember.lastName || !newMember.email) {
      setError('Please fill in all fields')
      return
    }

    if (!newMember.email.includes('@')) {
      setError('Please enter a valid email address')
      return
    }

    // Check for duplicate email
    if (members.some(m => m.email.toLowerCase() === newMember.email.toLowerCase())) {
      setError('This email has already been added')
      return
    }

    setError('')
    setMembers([
      ...members,
      {
        id: Date.now().toString(),
        ...newMember
      }
    ])
    setNewMember({ firstName: '', lastName: '', email: '', role: 'technician' })
  }

  const handleRemoveMember = (id: string) => {
    setMembers(members.filter(m => m.id !== id))
  }

  const handleSubmit = async () => {
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      if (members.length > 0) {
        const response = await api<{ invited: { email: string }[]; errors?: { email: string; error: string }[] }>(
          '/api/v1/onboarding/invite-team',
          {
            method: 'POST',
            token,
            body: {
              invites: members.map(m => ({
                firstName: m.firstName,
                lastName: m.lastName,
                email: m.email,
                role: m.role
              }))
            }
          }
        )

        if (response.errors && response.errors.length > 0) {
          setError(`Some invites failed: ${response.errors.map(e => e.email).join(', ')}`)
        }

        if (response.invited.length > 0) {
          setSuccess(`${response.invited.length} team member(s) invited successfully!`)
        }
      }

      // Move to next step regardless
      setTimeout(() => onNext(), 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite team members')
      setSaving(false)
    }
  }

  const handleSkip = () => {
    onNext()
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Invite Your Team</h2>
        <p className="text-gray-500 mt-1">
          Add team members who will use the system. You can skip this and add people later.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
          {success}
        </div>
      )}

      {/* Add New Member Form */}
      <div className="bg-gray-50 p-4 rounded-lg mb-6">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Add Team Member</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="First Name"
            value={newMember.firstName}
            onChange={(e) => setNewMember({ ...newMember, firstName: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
          <input
            type="text"
            placeholder="Last Name"
            value={newMember.lastName}
            onChange={(e) => setNewMember({ ...newMember, lastName: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
          <input
            type="email"
            placeholder="Email"
            value={newMember.email}
            onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />
          <select
            value={newMember.role}
            onChange={(e) => setNewMember({ ...newMember, role: e.target.value as TeamMember['role'] })}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          >
            {ROLES.map(role => (
              <option key={role.value} value={role.value}>{role.label}</option>
            ))}
          </select>
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={handleAddMember}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
          >
            + Add to List
          </button>
        </div>
      </div>

      {/* Team Members List */}
      {members.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Team Members to Invite ({members.length})</h3>
          <div className="space-y-2">
            {members.map(member => (
              <div
                key={member.id}
                className="flex items-center justify-between bg-white border border-gray-200 p-3 rounded-lg"
              >
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                    <span className="text-primary font-medium">
                      {member.firstName.charAt(0)}{member.lastName.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {member.firstName} {member.lastName}
                    </p>
                    <p className="text-sm text-gray-500">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm">
                    {ROLES.find(r => r.value === member.role)?.label}
                  </span>
                  <button
                    onClick={() => handleRemoveMember(member.id)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Role Descriptions */}
      <div className="bg-blue-50 p-4 rounded-lg mb-6">
        <h4 className="text-sm font-medium text-blue-900 mb-2">About Roles</h4>
        <div className="space-y-2 text-sm text-blue-800">
          {ROLES.map(role => (
            <p key={role.value}>
              <strong>{role.label}:</strong> {role.description}
            </p>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-6 border-t">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={handleSkip}
            className="px-6 py-2 text-gray-500 hover:text-gray-700 transition-colors"
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            {saving ? 'Sending Invites...' : members.length > 0 ? `Invite ${members.length} Member(s)` : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
