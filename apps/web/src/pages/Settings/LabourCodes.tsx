import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'
import SettingsBackLink from '../../components/SettingsBackLink'

interface LabourCode {
  id: string
  code: string
  description: string
  hourlyRate: number
  isVatExempt: boolean
  isDefault: boolean
  isActive: boolean
  sortOrder: number
}

interface LabourCodeFormData {
  code: string
  description: string
  hourlyRate: string
  isVatExempt: boolean
  isDefault: boolean
}

const initialFormData: LabourCodeFormData = {
  code: '',
  description: '',
  hourlyRate: '',
  isVatExempt: false,
  isDefault: false,
}

export default function LabourCodes() {
  const { session, user } = useAuth()
  const toast = useToast()
  const [labourCodes, setLabourCodes] = useState<LabourCode[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingCode, setEditingCode] = useState<LabourCode | null>(null)
  const [formData, setFormData] = useState<LabourCodeFormData>(initialFormData)
  const [formError, setFormError] = useState('')

  const organizationId = user?.organization?.id

  useEffect(() => {
    if (organizationId) {
      fetchLabourCodes()
    }
  }, [organizationId])

  const fetchLabourCodes = async () => {
    if (!organizationId) return

    try {
      setLoading(true)
      const data = await api<{ labourCodes: LabourCode[] }>(
        `/api/v1/organizations/${organizationId}/labour-codes`,
        { token: session?.accessToken }
      )
      setLabourCodes(data.labourCodes || [])

      // If no labour codes exist, seed defaults
      if (!data.labourCodes || data.labourCodes.length === 0) {
        await seedDefaultLabourCodes()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load labour codes')
    } finally {
      setLoading(false)
    }
  }

  const seedDefaultLabourCodes = async () => {
    if (!organizationId) return

    try {
      await api(
        `/api/v1/organizations/${organizationId}/labour-codes/seed-defaults`,
        {
          method: 'POST',
          token: session?.accessToken
        }
      )
      toast.success('Default labour codes created')
      await fetchLabourCodes()
    } catch (err) {
      // Silently fail if seeding fails - codes may already exist
      console.error('Failed to seed default labour codes:', err)
    }
  }

  const handleOpenModal = (code?: LabourCode) => {
    if (code) {
      setEditingCode(code)
      setFormData({
        code: code.code,
        description: code.description,
        hourlyRate: code.hourlyRate.toString(),
        isVatExempt: code.isVatExempt,
        isDefault: code.isDefault,
      })
    } else {
      setEditingCode(null)
      setFormData(initialFormData)
    }
    setFormError('')
    setShowModal(true)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingCode(null)
    setFormData(initialFormData)
    setFormError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!organizationId) return

    // Validation
    if (!formData.code.trim()) {
      setFormError('Code is required')
      return
    }
    if (!formData.description.trim()) {
      setFormError('Description is required')
      return
    }
    const rate = parseFloat(formData.hourlyRate)
    if (isNaN(rate) || rate <= 0) {
      setFormError('Hourly rate must be a positive number')
      return
    }

    try {
      setSaving(true)
      setFormError('')

      const payload = {
        code: formData.code.toUpperCase().trim(),
        description: formData.description.trim(),
        hourly_rate: rate,
        is_vat_exempt: formData.isVatExempt,
        is_default: formData.isDefault,
      }

      if (editingCode) {
        // Update existing
        await api(
          `/api/v1/organizations/${organizationId}/labour-codes/${editingCode.id}`,
          {
            method: 'PATCH',
            body: payload,
            token: session?.accessToken
          }
        )
        toast.success('Labour code updated')
      } else {
        // Create new
        await api(
          `/api/v1/organizations/${organizationId}/labour-codes`,
          {
            method: 'POST',
            body: payload,
            token: session?.accessToken
          }
        )
        toast.success('Labour code created')
      }

      handleCloseModal()
      await fetchLabourCodes()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save labour code')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (code: LabourCode) => {
    if (!organizationId) return
    if (!confirm(`Are you sure you want to delete the labour code "${code.code}"?`)) return

    try {
      await api(
        `/api/v1/organizations/${organizationId}/labour-codes/${code.id}`,
        {
          method: 'DELETE',
          token: session?.accessToken
        }
      )
      toast.success('Labour code deleted')
      await fetchLabourCodes()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete labour code')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div>
      <SettingsBackLink />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Labour Codes</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage labour codes and hourly rates for pricing repairs
          </p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add New
        </button>
      </div>

      {/* Labour Codes Table */}
      <div className="bg-white border border-gray-200 shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Code
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Description
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Rate
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                VAT Applicable
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Default
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {labourCodes.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                  No labour codes found. Click "Add New" to create one.
                </td>
              </tr>
            ) : (
              labourCodes.map((code) => (
                <tr key={code.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="font-mono font-medium text-gray-900">{code.code}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                    {code.description}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                    £{code.hourlyRate.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    {code.isVatExempt ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        No VAT
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Yes
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    {code.isDefault ? (
                      <span className="text-primary">
                        <svg className="w-5 h-5 inline" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </span>
                    ) : (
                      <span className="text-gray-300">
                        <svg className="w-5 h-5 inline" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleOpenModal(code)}
                      className="text-primary hover:text-primary-dark mr-4"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(code)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={handleCloseModal} />

            <div className="relative bg-white w-full max-w-md p-6 text-left shadow-xl transform transition-all">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingCode ? 'Edit Labour Code' : 'Add Labour Code'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 mb-4 text-sm">
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    placeholder="LAB"
                    maxLength={20}
                    className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary font-mono uppercase"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Standard Labour"
                    maxLength={255}
                    className="w-full px-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Hourly Rate (£) <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">£</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.hourlyRate}
                      onChange={(e) => setFormData({ ...formData, hourlyRate: e.target.value })}
                      placeholder="85.00"
                      className="w-full pl-8 pr-3 py-2 border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="isVatExempt"
                    checked={formData.isVatExempt}
                    onChange={(e) => setFormData({ ...formData, isVatExempt: e.target.checked })}
                    className="w-4 h-4 text-primary rounded"
                  />
                  <label htmlFor="isVatExempt" className="text-sm font-medium text-gray-700">
                    VAT Exempt
                  </label>
                  <span className="text-xs text-gray-500">(e.g., MOT labour)</span>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="isDefault"
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="w-4 h-4 text-primary rounded"
                  />
                  <label htmlFor="isDefault" className="text-sm font-medium text-gray-700">
                    Set as default
                  </label>
                  <span className="text-xs text-gray-500">(pre-selected when adding labour)</span>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-primary text-white px-4 py-2 font-semibold hover:bg-primary-dark disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : editingCode ? 'Update' : 'Add Labour Code'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
