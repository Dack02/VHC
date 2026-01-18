import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'

interface OrganizationSettingsData {
  id: string
  organizationId: string
  // Branding
  logoUrl: string | null
  logoDarkUrl: string | null
  faviconUrl: string | null
  primaryColor: string | null
  secondaryColor: string | null
  // Business
  legalName: string | null
  companyNumber: string | null
  vatNumber: string | null
  // Address
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  county: string | null
  postcode: string | null
  country: string | null
  // Contact
  phone: string | null
  email: string | null
  website: string | null
  // Preferences
  timezone: string | null
  dateFormat: string | null
  currency: string | null
}

export default function OrganizationSettings() {
  const { user, session } = useAuth()
  const [settings, setSettings] = useState<OrganizationSettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const logoInputRef = useRef<HTMLInputElement>(null)
  const logoDarkInputRef = useRef<HTMLInputElement>(null)
  const faviconInputRef = useRef<HTMLInputElement>(null)

  const orgId = user?.organization?.id

  useEffect(() => {
    if (orgId) {
      fetchSettings()
    }
  }, [orgId])

  const fetchSettings = async () => {
    if (!orgId) return

    try {
      const response = await fetch(`/api/v1/organizations/${orgId}/settings`, {
        headers: { Authorization: `Bearer ${session?.accessToken}` }
      })

      if (!response.ok) throw new Error('Failed to fetch settings')

      const data = await response.json()
      setSettings(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!orgId || !settings) return

    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/v1/organizations/${orgId}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.accessToken}`
        },
        body: JSON.stringify({
          // Branding
          primaryColor: settings.primaryColor,
          secondaryColor: settings.secondaryColor,
          // Business
          legalName: settings.legalName,
          companyNumber: settings.companyNumber,
          vatNumber: settings.vatNumber,
          // Address
          addressLine1: settings.addressLine1,
          addressLine2: settings.addressLine2,
          city: settings.city,
          county: settings.county,
          postcode: settings.postcode,
          country: settings.country,
          // Contact
          phone: settings.phone,
          email: settings.email,
          website: settings.website,
          // Preferences
          timezone: settings.timezone,
          dateFormat: settings.dateFormat,
          currency: settings.currency
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save settings')
      }

      setSuccess('Settings saved successfully')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleLogoUpload = async (file: File, type: 'logo' | 'logo_dark' | 'favicon') => {
    if (!orgId) return

    setUploadingLogo(type)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', type)

      const response = await fetch(`/api/v1/organizations/${orgId}/settings/logo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.accessToken}` },
        body: formData
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to upload')
      }

      const data = await response.json()

      // Update local state with new URL
      setSettings(prev => {
        if (!prev) return prev
        const key = type === 'logo' ? 'logoUrl' : type === 'logo_dark' ? 'logoDarkUrl' : 'faviconUrl'
        return { ...prev, [key]: data.url }
      })

      setSuccess(`${type === 'favicon' ? 'Favicon' : 'Logo'} uploaded successfully`)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload')
    } finally {
      setUploadingLogo(null)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'logo_dark' | 'favicon') => {
    const file = e.target.files?.[0]
    if (file) {
      handleLogoUpload(file, type)
    }
  }

  const updateField = (field: keyof OrganizationSettingsData, value: string) => {
    setSettings(prev => prev ? { ...prev, [field]: value || null } : prev)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Organization Settings</h1>
        <p className="text-gray-600 mt-1">
          Manage your organization's branding, business details, and preferences.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
          {success}
        </div>
      )}

      <div className="space-y-6">
        {/* Branding Section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Branding</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            {/* Logo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Logo</label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
                {settings?.logoUrl ? (
                  <img src={settings.logoUrl} alt="Logo" className="h-16 mx-auto mb-2 object-contain" />
                ) : (
                  <div className="h-16 flex items-center justify-center text-gray-400 mb-2">
                    No logo
                  </div>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={(e) => handleFileSelect(e, 'logo')}
                  className="hidden"
                />
                <button
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo === 'logo'}
                  className="text-sm text-primary hover:text-primary-dark disabled:opacity-50"
                >
                  {uploadingLogo === 'logo' ? 'Uploading...' : 'Upload Logo'}
                </button>
              </div>
            </div>

            {/* Dark Logo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Logo (Dark Mode)</label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center bg-gray-800">
                {settings?.logoDarkUrl ? (
                  <img src={settings.logoDarkUrl} alt="Dark Logo" className="h-16 mx-auto mb-2 object-contain" />
                ) : (
                  <div className="h-16 flex items-center justify-center text-gray-500 mb-2">
                    No logo
                  </div>
                )}
                <input
                  ref={logoDarkInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={(e) => handleFileSelect(e, 'logo_dark')}
                  className="hidden"
                />
                <button
                  onClick={() => logoDarkInputRef.current?.click()}
                  disabled={uploadingLogo === 'logo_dark'}
                  className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50"
                >
                  {uploadingLogo === 'logo_dark' ? 'Uploading...' : 'Upload Dark Logo'}
                </button>
              </div>
            </div>

            {/* Favicon */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Favicon</label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
                {settings?.faviconUrl ? (
                  <img src={settings.faviconUrl} alt="Favicon" className="h-16 w-16 mx-auto mb-2 object-contain" />
                ) : (
                  <div className="h-16 w-16 mx-auto flex items-center justify-center text-gray-400 mb-2 border border-gray-300 rounded">
                    ?
                  </div>
                )}
                <input
                  ref={faviconInputRef}
                  type="file"
                  accept="image/png,image/svg+xml,image/x-icon"
                  onChange={(e) => handleFileSelect(e, 'favicon')}
                  className="hidden"
                />
                <button
                  onClick={() => faviconInputRef.current?.click()}
                  disabled={uploadingLogo === 'favicon'}
                  className="text-sm text-primary hover:text-primary-dark disabled:opacity-50"
                >
                  {uploadingLogo === 'favicon' ? 'Uploading...' : 'Upload Favicon'}
                </button>
              </div>
            </div>
          </div>

          {/* Brand Colors */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Primary Color</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings?.primaryColor || '#3B82F6'}
                  onChange={(e) => updateField('primaryColor', e.target.value)}
                  className="h-10 w-14 rounded border border-gray-300 cursor-pointer"
                />
                <input
                  type="text"
                  value={settings?.primaryColor || ''}
                  onChange={(e) => updateField('primaryColor', e.target.value)}
                  placeholder="#3B82F6"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Secondary Color</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={settings?.secondaryColor || '#10B981'}
                  onChange={(e) => updateField('secondaryColor', e.target.value)}
                  className="h-10 w-14 rounded border border-gray-300 cursor-pointer"
                />
                <input
                  type="text"
                  value={settings?.secondaryColor || ''}
                  onChange={(e) => updateField('secondaryColor', e.target.value)}
                  placeholder="#10B981"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Business Details Section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Business Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Legal Name</label>
              <input
                type="text"
                value={settings?.legalName || ''}
                onChange={(e) => updateField('legalName', e.target.value)}
                placeholder="Company Ltd"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Number</label>
              <input
                type="text"
                value={settings?.companyNumber || ''}
                onChange={(e) => updateField('companyNumber', e.target.value)}
                placeholder="12345678"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">VAT Number</label>
              <input
                type="text"
                value={settings?.vatNumber || ''}
                onChange={(e) => updateField('vatNumber', e.target.value)}
                placeholder="GB123456789"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Address Section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Address</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1</label>
              <input
                type="text"
                value={settings?.addressLine1 || ''}
                onChange={(e) => updateField('addressLine1', e.target.value)}
                placeholder="123 Main Street"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label>
              <input
                type="text"
                value={settings?.addressLine2 || ''}
                onChange={(e) => updateField('addressLine2', e.target.value)}
                placeholder="Suite 100"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input
                type="text"
                value={settings?.city || ''}
                onChange={(e) => updateField('city', e.target.value)}
                placeholder="London"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">County</label>
              <input
                type="text"
                value={settings?.county || ''}
                onChange={(e) => updateField('county', e.target.value)}
                placeholder="Greater London"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Postcode</label>
              <input
                type="text"
                value={settings?.postcode || ''}
                onChange={(e) => updateField('postcode', e.target.value)}
                placeholder="SW1A 1AA"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
              <select
                value={settings?.country || 'United Kingdom'}
                onChange={(e) => updateField('country', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="United Kingdom">United Kingdom</option>
                <option value="Ireland">Ireland</option>
                <option value="United States">United States</option>
                <option value="Canada">Canada</option>
                <option value="Australia">Australia</option>
              </select>
            </div>
          </div>
        </div>

        {/* Contact Section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={settings?.phone || ''}
                onChange={(e) => updateField('phone', e.target.value)}
                placeholder="+44 20 1234 5678"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={settings?.email || ''}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder="info@company.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
              <input
                type="url"
                value={settings?.website || ''}
                onChange={(e) => updateField('website', e.target.value)}
                placeholder="https://www.company.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Preferences Section */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Preferences</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
              <select
                value={settings?.timezone || 'Europe/London'}
                onChange={(e) => updateField('timezone', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Europe/Dublin">Europe/Dublin (GMT/IST)</option>
                <option value="America/New_York">America/New York (EST/EDT)</option>
                <option value="America/Los_Angeles">America/Los Angeles (PST/PDT)</option>
                <option value="America/Chicago">America/Chicago (CST/CDT)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date Format</label>
              <select
                value={settings?.dateFormat || 'DD/MM/YYYY'}
                onChange={(e) => updateField('dateFormat', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="DD/MM/YYYY">DD/MM/YYYY (31/12/2024)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (12/31/2024)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (2024-12-31)</option>
                <option value="DD MMM YYYY">DD MMM YYYY (31 Dec 2024)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <select
                value={settings?.currency || 'GBP'}
                onChange={(e) => updateField('currency', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="GBP">GBP (British Pound)</option>
                <option value="EUR">EUR (Euro)</option>
                <option value="USD">USD (US Dollar)</option>
                <option value="CAD">CAD (Canadian Dollar)</option>
                <option value="AUD">AUD (Australian Dollar)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
