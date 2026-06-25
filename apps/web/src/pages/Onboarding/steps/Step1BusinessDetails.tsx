import { useState } from 'react'
import { api } from '../../../lib/api'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5180'

interface Props {
  token: string
  orgId: string
  onNext: () => void
  onBack: () => void
}

export default function Step1BusinessDetails({ token, orgId, onNext, onBack }: Props) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState('')
  const [form, setForm] = useState({
    legalName: '',
    companyNumber: '',
    vatNumber: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    county: '',
    postcode: '',
    country: 'GB',
    phone: '',
    email: '',
    website: '',
    timezone: 'Europe/London',
    dateFormat: 'DD/MM/YYYY',
    currency: 'GBP'
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoError('')
    setUploadingLogo(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', 'logo')
      const res = await fetch(`${API_URL}/api/v1/organizations/${orgId}/settings/logo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setLogoUrl(data.url)
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Failed to upload logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!form.legalName.trim() || !form.addressLine1.trim() || !form.city.trim() || !form.postcode.trim()) {
      setError('Please complete your legal business name and address (these appear on customer reports)')
      return
    }

    setSaving(true)

    try {
      await api('/api/v1/onboarding/business-details', {
        method: 'POST',
        token,
        body: form
      })
      onNext()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save business details')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Business Details</h2>
        <p className="text-gray-500 mt-1">Tell us about your business. You can update these later.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* Business Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Legal Business Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="legalName"
              value={form.legalName}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="ABC Motors Ltd"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Company Number
            </label>
            <input
              type="text"
              name="companyNumber"
              value={form.companyNumber}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="12345678"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              VAT Number
            </label>
            <input
              type="text"
              name="vatNumber"
              value={form.vatNumber}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="GB123456789"
            />
          </div>
        </div>

        {/* Address */}
        <div className="border-t pt-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Business Address</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Address Line 1 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="addressLine1"
                value={form.addressLine1}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="123 High Street"
                required
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Address Line 2
              </label>
              <input
                type="text"
                name="addressLine2"
                value={form.addressLine2}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="Industrial Estate"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                City <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="city"
                value={form.city}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="London"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                County
              </label>
              <input
                type="text"
                name="county"
                value={form.county}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="Greater London"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Postcode <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="postcode"
                value={form.postcode}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="SW1A 1AA"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Country
              </label>
              <select
                name="country"
                value={form.country}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="GB">United Kingdom</option>
                <option value="IE">Ireland</option>
              </select>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="border-t pt-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Contact Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone
              </label>
              <input
                type="tel"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="+44 20 1234 5678"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="info@abcmotors.com"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Website
              </label>
              <input
                type="url"
                name="website"
                value={form.website}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                placeholder="https://www.abcmotors.com"
              />
            </div>
          </div>
        </div>

        {/* Logo & Branding */}
        <div className="border-t pt-6">
          <h3 className="text-lg font-medium text-gray-900 mb-1">Logo &amp; Branding</h3>
          <p className="text-sm text-gray-500 mb-4">Add your logo so it appears on customer-facing health check reports. You can change this later in Settings. (optional)</p>
          {logoError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-3 text-sm">{logoError}</div>}
          <div className="flex items-center space-x-4">
            <div className="w-24 h-24 border border-gray-200 rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo preview" className="max-w-full max-h-full object-contain" />
              ) : (
                <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              )}
            </div>
            <div>
              <label className="inline-block px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                {uploadingLogo ? 'Uploading...' : logoUrl ? 'Replace logo' : 'Upload logo'}
                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={handleLogoChange} disabled={uploadingLogo} className="hidden" />
              </label>
              <p className="text-xs text-gray-400 mt-2">PNG, JPEG, SVG or WebP. Max 2MB.</p>
            </div>
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
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  )
}
