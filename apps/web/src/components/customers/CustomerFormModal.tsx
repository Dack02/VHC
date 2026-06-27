/**
 * CustomerFormModal — the single, shared "create / edit customer" modal used
 * everywhere a customer is captured: the Customers list, and the New Jobsheet,
 * New Estimate and New Health Check flows.
 *
 * Layout follows the "Add Customer Modal — Option A (Sectioned compact)" design:
 * a 924px-wide card that fits on one screen, organised into three labelled
 * sections (Customer / Contact / Address) with a left label-rail and a two-column
 * field grid (see Designs/design_handoff_add_customer_modal/README.md).
 *
 * Fields: name (first/last), company name, email, mobile, landline phone, and a
 * structured UK address with a postcode "Find" lookup (which degrades gracefully
 * to a disabled no-op when no provider key is configured). Extra emails and
 * mobile numbers can be added via "Add another email or number"; they persist as
 * customer_contacts rows.
 *
 * The caller mounts it conditionally ({open && <CustomerFormModal …/>}) and is
 * handed the saved customer via onSaved — e.g. to link it to a vehicle.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { api } from '../../lib/api'

export interface SavedCustomer {
  id: string
  title?: string | null
  firstName: string
  lastName: string
  companyName?: string | null
  email: string | null
  mobile: string | null
  phone?: string | null
  address?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  town?: string | null
  county?: string | null
  postcode?: string | null
  externalId?: string | null
  contacts?: Array<{ contactType: 'email' | 'phone'; value: string; label?: string | null }>
}

interface CustomerFormModalProps {
  onClose: () => void
  /** Called with the saved customer after a successful create/update. */
  onSaved: (customer: SavedCustomer) => void
  /** Prefill the name when opened from a "+ Add new customer" search box. */
  initialName?: string
  /** Existing customer to edit. Omit for create. */
  customer?: SavedCustomer | null
  /** Site to associate a new customer with (jobsheet/estimate/HC flows). */
  siteId?: string
}

interface PostcodeAddress {
  formatted: string
  line1: string
  line2: string
  town: string
  county: string
  postcode: string
}

/** A unified "extra contact" row — an additional email or mobile number. */
type ExtraContact = { type: 'email' | 'phone'; value: string }

// Shared input treatment (height 42, 10px radius, dark focus ring). Hanken
// Grotesk is the app's default sans, so the design's typography comes for free.
const inputCls =
  'h-[42px] w-full box-border rounded-[10px] border border-[#e4e7ec] bg-white px-[14px] text-[15px] text-[#16191f] ' +
  'placeholder:text-[#aeb4be] focus:outline-none focus:border-[#16191f] focus:shadow-[0_0_0_3px_rgba(22,25,31,0.08)]'
const inputErrCls = inputCls.replace('border-[#e4e7ec]', 'border-[#d23f3f]')
const labelCls = 'mb-1.5 block text-[13px] font-semibold text-[#3a3f4a]'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Split a "First Last" string into first/last name parts. */
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
}

export default function CustomerFormModal({
  onClose,
  onSaved,
  initialName,
  customer,
  siteId
}: CustomerFormModalProps) {
  const { session } = useAuth()
  const token = session?.accessToken
  const toast = useToast()
  const isEdit = Boolean(customer?.id)

  const prefillName = !customer && initialName ? splitName(initialName) : null

  const [form, setForm] = useState({
    firstName: customer?.firstName ?? prefillName?.firstName ?? '',
    lastName: customer?.lastName ?? prefillName?.lastName ?? '',
    companyName: customer?.companyName ?? '',
    email: customer?.email ?? '',
    mobile: customer?.mobile ?? '',
    phone: customer?.phone ?? '',
    addressLine1: customer?.addressLine1 ?? '',
    addressLine2: customer?.addressLine2 ?? '',
    town: customer?.town ?? '',
    county: customer?.county ?? '',
    postcode: customer?.postcode ?? ''
  })

  // Additional emails / mobiles (beyond the primary fields above), kept as a
  // single ordered list so one "Add another email or number" button drives both.
  const [extraContacts, setExtraContacts] = useState<ExtraContact[]>(
    (customer?.contacts ?? []).map((c) => ({ type: c.contactType, value: c.value }))
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string; email?: string }>({})

  // Postcode lookup
  const [lookupEnabled, setLookupEnabled] = useState(false)
  const [looking, setLooking] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [results, setResults] = useState<PostcodeAddress[] | null>(null)

  const modalRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  const setField = useCallback(
    (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value })),
    []
  )

  // Initial focus + restore focus to the trigger element on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null
    firstFieldRef.current?.focus()
    return () => trigger?.focus?.()
  }, [])

  // Esc-to-close and Tab focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Is the postcode lookup configured? (controls whether "Find" is actionable)
  useEffect(() => {
    if (!token) return
    let cancelled = false
    api<{ configured: boolean; enabled: boolean }>('/api/v1/postcode-lookup/status', { token })
      .then((s) => {
        if (!cancelled) setLookupEnabled(Boolean(s.configured && s.enabled))
      })
      .catch(() => {
        if (!cancelled) setLookupEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const handleFindAddress = async () => {
    if (!token || !lookupEnabled || !form.postcode.trim()) return
    setLooking(true)
    setLookupError('')
    setResults(null)
    try {
      const res = await api<{ success: boolean; addresses: PostcodeAddress[]; error?: string; errorCode?: string }>(
        `/api/v1/postcode-lookup/${encodeURIComponent(form.postcode.trim())}`,
        { token }
      )
      if (!res.success) {
        setLookupError(res.error || 'No addresses found')
        return
      }
      if (!res.addresses.length) {
        setLookupError('No addresses found for that postcode')
        return
      }
      setResults(res.addresses)
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Postcode lookup failed')
    } finally {
      setLooking(false)
    }
  }

  const handleSelectAddress = (a: PostcodeAddress) => {
    setForm((f) => ({
      ...f,
      addressLine1: a.line1 || '',
      addressLine2: a.line2 || '',
      town: a.town || '',
      county: a.county || '',
      postcode: a.postcode || f.postcode
    }))
    setResults(null)
    setLookupError('')
  }

  const updateExtra = (index: number, value: string) =>
    setExtraContacts((list) => list.map((c, i) => (i === index ? { ...c, value } : c)))
  const updateExtraType = (index: number, type: ExtraContact['type']) =>
    setExtraContacts((list) => list.map((c, i) => (i === index ? { ...c, type } : c)))
  const removeExtra = (index: number) =>
    setExtraContacts((list) => list.filter((_, i) => i !== index))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return

    const nextErrors: typeof errors = {}
    if (!form.firstName.trim()) nextErrors.firstName = 'First name is required'
    if (!form.lastName.trim()) nextErrors.lastName = 'Last name is required'
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim()))
      nextErrors.email = 'Enter a valid email address'
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    setSaving(true)
    setError('')

    const additionalContacts = extraContacts
      .map((c) => ({ ...c, value: c.value.trim() }))
      .filter((c) => c.value)
      .map((c) =>
        c.type === 'email'
          ? { contactType: 'email' as const, value: c.value }
          : { contactType: 'phone' as const, value: c.value, label: 'mobile' }
      )

    const body = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      companyName: form.companyName.trim() || undefined,
      email: form.email.trim() || undefined,
      mobile: form.mobile.trim() || undefined,
      phone: form.phone.trim() || undefined,
      addressLine1: form.addressLine1.trim() || undefined,
      addressLine2: form.addressLine2.trim() || undefined,
      town: form.town.trim() || undefined,
      county: form.county.trim() || undefined,
      postcode: form.postcode.trim() || undefined,
      additionalContacts,
      ...(isEdit ? {} : { siteId: siteId || undefined })
    }

    try {
      const saved = await api<SavedCustomer>(
        isEdit ? `/api/v1/customers/${customer!.id}` : '/api/v1/customers',
        { method: isEdit ? 'PATCH' : 'POST', token, body }
      )
      toast.success(isEdit ? 'Customer updated' : 'Customer added')
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save customer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(16,20,28,0.45)] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit customer' : 'Add new customer'}
        className="flex max-h-[92vh] w-[924px] max-w-full flex-col overflow-hidden rounded-[18px] border border-[rgba(16,20,28,0.05)] bg-white shadow-[0_28px_70px_-24px_rgba(16,20,28,0.34),0_8px_24px_-14px_rgba(16,20,28,0.18)]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-[#eef0f3] px-[30px] pb-5 pt-[22px]">
          <div>
            <h2 className="text-[19px] font-bold leading-tight tracking-[-0.015em] text-[#16191f]">
              {isEdit ? 'Edit customer' : 'Add new customer'}
            </h2>
            <p className="mt-[3px] text-[13px] text-[#8a909c]">
              Create a record for jobs, invoices and reminders.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-transparent hover:bg-[#f3f5f7]"
          >
            <svg className="h-5 w-5" fill="none" stroke="#9aa0ab" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {error && (
            <div className="mx-[30px] mt-4 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Section 1 — Customer */}
          <section className="grid grid-cols-1 gap-9 border-b border-[#f3f5f7] px-[30px] py-[22px] sm:grid-cols-[190px_1fr]">
            <div>
              <h3 className="text-[15px] font-bold text-[#16191f]">Customer</h3>
              <p className="mt-1 text-[12.5px] text-[#9aa0ab]">Their name and business.</p>
            </div>
            <div className="grid grid-cols-1 gap-x-[18px] gap-y-[14px] sm:grid-cols-2">
              <div>
                <label className={labelCls}>
                  First name<span className="text-[#d23f3f]"> *</span>
                </label>
                <input
                  ref={firstFieldRef}
                  type="text"
                  value={form.firstName}
                  onChange={(e) => setField('firstName', e.target.value)}
                  className={errors.firstName ? inputErrCls : inputCls}
                  placeholder="Jordan"
                />
                {errors.firstName && (
                  <p className="mt-1 text-[12.5px] text-[#d23f3f]">{errors.firstName}</p>
                )}
              </div>
              <div>
                <label className={labelCls}>
                  Last name<span className="text-[#d23f3f]"> *</span>
                </label>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => setField('lastName', e.target.value)}
                  className={errors.lastName ? inputErrCls : inputCls}
                  placeholder="Whitfield"
                />
                {errors.lastName && (
                  <p className="mt-1 text-[12.5px] text-[#d23f3f]">{errors.lastName}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>
                  Company name<span className="font-medium text-[#aeb4be]"> · optional</span>
                </label>
                <input
                  type="text"
                  value={form.companyName}
                  onChange={(e) => setField('companyName', e.target.value)}
                  className={inputCls}
                  placeholder="e.g. Whitfield Logistics Ltd"
                />
              </div>
            </div>
          </section>

          {/* Section 2 — Contact */}
          <section className="grid grid-cols-1 gap-9 border-b border-[#f3f5f7] px-[30px] py-[22px] sm:grid-cols-[190px_1fr]">
            <div>
              <h3 className="text-[15px] font-bold text-[#16191f]">Contact</h3>
              <p className="mt-1 text-[12.5px] text-[#9aa0ab]">How you'll reach them.</p>
            </div>
            <div className="grid grid-cols-1 gap-x-[18px] gap-y-[14px] sm:grid-cols-2">
              <div>
                <label className={labelCls}>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                  className={errors.email ? inputErrCls : inputCls}
                  placeholder="name@company.co.uk"
                />
                {errors.email && (
                  <p className="mt-1 text-[12.5px] text-[#d23f3f]">{errors.email}</p>
                )}
              </div>
              <div>
                <label className={labelCls}>Mobile</label>
                <input
                  type="tel"
                  value={form.mobile}
                  onChange={(e) => setField('mobile', e.target.value)}
                  className={inputCls}
                  placeholder="07700 900000"
                />
              </div>
              <div>
                <label className={labelCls}>
                  Phone<span className="font-medium text-[#aeb4be]"> · landline</span>
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                  className={inputCls}
                  placeholder="0161 000 0000"
                />
              </div>
              {/* Add another email / number (bottom-aligned ghost button) */}
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setExtraContacts([...extraContacts, { type: 'email', value: '' }])}
                  className="flex h-[42px] items-center gap-1.5 text-[13px] font-semibold text-[#16191f] hover:text-[#3a3f4a]"
                >
                  <svg className="h-[15px] w-[15px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
                  </svg>
                  Add another email or number
                </button>
              </div>

              {/* Extra contact rows (each an email or mobile) */}
              {extraContacts.map((c, i) => (
                <div key={i} className="flex items-center gap-2 sm:col-span-2">
                  <select
                    value={c.type}
                    onChange={(e) => updateExtraType(i, e.target.value as ExtraContact['type'])}
                    className="h-[42px] w-[110px] shrink-0 box-border rounded-[10px] border border-[#e4e7ec] bg-white px-[10px] text-[14px] text-[#16191f] focus:outline-none focus:border-[#16191f] focus:shadow-[0_0_0_3px_rgba(22,25,31,0.08)]"
                  >
                    <option value="email">Email</option>
                    <option value="phone">Mobile</option>
                  </select>
                  <input
                    type={c.type === 'email' ? 'email' : 'tel'}
                    value={c.value}
                    onChange={(e) => updateExtra(i, e.target.value)}
                    className={inputCls}
                    placeholder={c.type === 'email' ? 'name@company.co.uk' : '07700 900000'}
                  />
                  <button
                    type="button"
                    onClick={() => removeExtra(i)}
                    aria-label="Remove"
                    className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] text-[#9aa0ab] hover:bg-[#f3f5f7] hover:text-[#d23f3f]"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Section 3 — Address */}
          <section className="grid grid-cols-1 gap-9 px-[30px] py-[22px] sm:grid-cols-[190px_1fr]">
            <div>
              <h3 className="text-[15px] font-bold text-[#16191f]">Address</h3>
              <p className="mt-1 text-[12.5px] text-[#9aa0ab]">For invoices and collection.</p>
            </div>
            <div className="grid grid-cols-1 gap-x-[18px] gap-y-[14px] sm:grid-cols-2">
              <div>
                <label className={labelCls}>Postcode</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.postcode}
                    onChange={(e) => setField('postcode', e.target.value.toUpperCase())}
                    className={`${inputCls} uppercase`}
                    placeholder="SW1A 1AA"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && lookupEnabled) {
                        e.preventDefault()
                        handleFindAddress()
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleFindAddress}
                    disabled={!lookupEnabled || looking || !form.postcode.trim()}
                    title={lookupEnabled ? 'Find address from postcode' : 'Postcode lookup is not configured'}
                    className="h-[42px] shrink-0 rounded-[10px] border border-[#d7dbe0] bg-[#f6f7f9] px-4 text-[13px] font-bold text-[#16191f] hover:bg-[#eef0f3] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {looking ? 'Finding…' : 'Find'}
                  </button>
                </div>
                {lookupError && <p className="mt-1 text-[12.5px] text-amber-700">{lookupError}</p>}
                {results && results.length > 0 && (
                  <div className="mt-2 max-h-48 overflow-auto rounded-[10px] border border-[#e4e7ec] bg-white shadow-sm">
                    {results.map((a, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSelectAddress(a)}
                        className="block w-full border-b border-[#f3f5f7] px-3 py-2 text-left text-sm text-[#16191f] last:border-0 hover:bg-[#f6f7f9]"
                      >
                        {a.formatted}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>Town / City</label>
                <input
                  type="text"
                  value={form.town}
                  onChange={(e) => setField('town', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Address line 1</label>
                <input
                  type="text"
                  value={form.addressLine1}
                  onChange={(e) => setField('addressLine1', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>
                  Address line 2<span className="font-medium text-[#aeb4be]"> · optional</span>
                </label>
                <input
                  type="text"
                  value={form.addressLine2}
                  onChange={(e) => setField('addressLine2', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>County</label>
                <input
                  type="text"
                  value={form.county}
                  onChange={(e) => setField('county', e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
          </section>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-between border-t border-[#eef0f3] bg-[#fafbfc] px-[30px] py-4">
            <p className="text-[12.5px] text-[#9aa0ab]">
              <span className="text-[#d23f3f]">*</span> Required fields
            </p>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="h-[42px] rounded-[10px] border border-[#d7dbe0] bg-white px-5 text-[14px] font-semibold text-[#3a3f4a] hover:bg-[#f6f7f9]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-[42px] rounded-[10px] bg-[#16191f] px-[22px] text-[14px] font-bold text-white hover:bg-black disabled:opacity-50"
              >
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add customer'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
