import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import GoogleAuthButton from '../components/GoogleAuthButton'

// Signup redesign — the "Ollo Inspect Signup" twin of the login page (Designs — same
// finalised brand shell): full-bleed radial brand gradient with the product story on the
// left (desktop only) and a white glass card on the right. Purely presentational — all
// signup logic (config fetch, Google OAuth, terms gate, submit/success/closed states) is
// unchanged. Shares the gradient values with Login.tsx by copy.
const PAGE_GRADIENT =
  'radial-gradient(130% 130% at 12% -5%, #7C3AED 0%, #5B4BE0 36%, #1E3A8A 68%, #0F766E 100%)'
const SUBMIT_GRADIENT = 'linear-gradient(100deg, #7C3AED, #4F46E5 55%, #14B8A6)'

// Shared field styling so every input in the card reads identically.
const INPUT_CLASS =
  'h-12 w-full rounded-xl border-[1.5px] border-[#E2E5EA] bg-[#F7F8FA] px-4 text-[15px] text-[#171A21] outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15 disabled:opacity-60'
const LABEL_CLASS = 'mb-1.5 block text-[13px] font-semibold text-[#3A404B]'

interface SignupConfig {
  enabled: boolean
  platformName: string
  termsUrl: string | null
  privacyUrl: string | null
}

// Module scope (not nested in Signup) so these aren't recreated each render — otherwise
// the card would remount on every keystroke and inputs would lose focus.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative min-h-screen w-full overflow-hidden flex items-center justify-center p-6 sm:p-12"
      style={{ background: PAGE_GRADIENT }}
    >
      {/* Decorative rings & glow */}
      <div aria-hidden="true" className="pointer-events-none absolute -left-[180px] -bottom-[220px] h-[640px] w-[640px] rounded-full border-2 border-white/[0.09]" />
      <div aria-hidden="true" className="pointer-events-none absolute -left-[60px] -bottom-[100px] h-[420px] w-[420px] rounded-full border-2 border-white/[0.09]" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-[160px] -top-[160px] h-[560px] w-[560px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.38), transparent 70%)' }}
      />

      {/* Content row */}
      <div className="relative z-10 flex w-full max-w-[1120px] items-center justify-center gap-16 lg:justify-between lg:gap-[72px]">

        {/* Brand messaging — desktop only */}
        <div className="hidden min-w-0 max-w-[480px] flex-1 lg:block">
          <div className="mb-7 text-[15px] font-bold uppercase tracking-[0.2em] text-white/80">
            Ollo Inspect
          </div>
          <h1 className="text-balance text-[44px] font-extrabold leading-[1.1] tracking-[-0.025em] text-white xl:text-[52px]">
            Set your workshop up in minutes.
          </h1>
          <p className="mt-5 max-w-[420px] text-[18px] leading-[1.55] text-white/80">
            Create your account and start sending digital vehicle health checks customers actually trust.
          </p>

          <div className="mt-10 flex flex-col gap-4">
            <FeatureRow>No card required to get started</FeatureRow>
            <FeatureRow>Traffic-light reports &amp; live authorisations</FeatureRow>
          </div>
        </div>

        {/* Card */}
        <div className="w-full max-w-[460px] flex-shrink-0 rounded-[22px] bg-white/[0.99] px-8 pb-9 pt-10 shadow-[0_40px_80px_-24px_rgba(10,4,40,0.55),0_0_0_1px_rgba(255,255,255,0.4)] sm:px-11">
          {children}
        </div>
      </div>
    </div>
  )
}

function FeatureRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full bg-white/[0.16]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold text-white/90">{children}</span>
    </div>
  )
}

function Logo() {
  return (
    <img
      src="/ollo-inspect-logo.png"
      alt="Ollo Inspect"
      className="mx-auto mb-6 block h-9 w-auto"
    />
  )
}

function BackToSignIn() {
  return (
    <div className="mt-6 text-center">
      <Link to="/login" className="text-[15px] font-bold text-[#7C3AED] hover:underline">
        Back to sign in
      </Link>
    </div>
  )
}

export default function Signup() {
  const [config, setConfig] = useState<SignupConfig | null>(null)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [form, setForm] = useState({
    organizationName: '',
    adminFirstName: '',
    adminLastName: '',
    adminEmail: ''
  })
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    api<SignupConfig>('/api/v1/auth/signup-config')
      .then(setConfig)
      .catch(() => setConfig({ enabled: false, platformName: 'Vehicle Health Check', termsUrl: null, privacyUrl: null }))
      .finally(() => setLoadingConfig(false))
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!acceptTerms) {
      setError('Please accept the terms to continue')
      return
    }

    setLoading(true)
    try {
      await api('/api/v1/auth/signup', {
        method: 'POST',
        body: { ...form, acceptTerms }
      })
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (loadingConfig) {
    return (
      <Shell>
        <Logo />
        <p className="py-6 text-center text-[15px] text-[#6A7180]">Loading&hellip;</p>
      </Shell>
    )
  }

  if (!config?.enabled) {
    return (
      <Shell>
        <Logo />
        <h2 className="text-center text-2xl font-extrabold tracking-[-0.01em] text-[#171A21]">
          Signups are closed
        </h2>
        <p className="mt-2 text-center text-[15px] leading-relaxed text-[#6A7180]">
          Self-service signups are currently closed. Please contact us to get your organisation set up.
        </p>
        <BackToSignIn />
      </Shell>
    )
  }

  if (submitted) {
    return (
      <Shell>
        <Logo />
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <svg className="h-7 w-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-center text-2xl font-extrabold tracking-[-0.01em] text-[#171A21]">
          Almost there!
        </h2>
        <p className="mt-2 text-center text-[15px] leading-relaxed text-[#6A7180]">
          Check <strong className="font-semibold text-[#3A404B]">{form.adminEmail}</strong> for a link to
          set your password and finish setting up your account.
        </p>
        <BackToSignIn />
      </Shell>
    )
  }

  return (
    <Shell>
      <Logo />
      <h2 className="text-center text-2xl font-extrabold tracking-[-0.01em] text-[#171A21]">
        Create your account
      </h2>
      <p className="mt-1.5 mb-6 text-center text-[15px] text-[#6A7180]">
        Start your free workshop setup.
      </p>

      <GoogleAuthButton label="Sign up with Google" disabled={loading} />

      <div className="my-5 flex items-center gap-3.5">
        <div className="h-px flex-1 bg-[#E6E8EC]" />
        <span className="text-xs font-semibold text-[#9AA1AD]">or</span>
        <div className="h-px flex-1 bg-[#E6E8EC]" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="organizationName" className={LABEL_CLASS}>
            Business name
          </label>
          <input
            id="organizationName"
            name="organizationName"
            type="text"
            autoComplete="organization"
            value={form.organizationName}
            onChange={handleChange}
            className={INPUT_CLASS}
            placeholder="ABC Motors Ltd"
            required
            disabled={loading}
          />
        </div>

        <div className="grid grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="adminFirstName" className={LABEL_CLASS}>
              First name
            </label>
            <input
              id="adminFirstName"
              name="adminFirstName"
              type="text"
              autoComplete="given-name"
              value={form.adminFirstName}
              onChange={handleChange}
              className={INPUT_CLASS}
              placeholder="Alex"
              required
              disabled={loading}
            />
          </div>
          <div>
            <label htmlFor="adminLastName" className={LABEL_CLASS}>
              Last name
            </label>
            <input
              id="adminLastName"
              name="adminLastName"
              type="text"
              autoComplete="family-name"
              value={form.adminLastName}
              onChange={handleChange}
              className={INPUT_CLASS}
              placeholder="Turner"
              required
              disabled={loading}
            />
          </div>
        </div>

        <div>
          <label htmlFor="adminEmail" className={LABEL_CLASS}>
            Work email
          </label>
          <input
            id="adminEmail"
            name="adminEmail"
            type="email"
            autoComplete="email"
            value={form.adminEmail}
            onChange={handleChange}
            className={INPUT_CLASS}
            placeholder="you@yourbusiness.com"
            required
            disabled={loading}
          />
        </div>

        <label className="flex items-start gap-2.5 text-[14px] leading-relaxed text-[#6A7180]">
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            className="mt-0.5 h-[17px] w-[17px] flex-shrink-0 accent-[#7C3AED]"
            disabled={loading}
          />
          <span>
            I agree to the
            {config.termsUrl ? (
              <> <a href={config.termsUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#7C3AED] hover:underline">Terms of Service</a></>
            ) : ' Terms of Service'}
            {config.privacyUrl && (
              <> and <a href={config.privacyUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#7C3AED] hover:underline">Privacy Policy</a></>
            )}
          </span>
        </label>

        <button
          type="submit"
          disabled={loading}
          className="h-[52px] w-full rounded-xl text-[16px] font-bold text-white shadow-[0_14px_28px_-8px_rgba(79,70,229,0.55)] transition hover:brightness-[1.06] disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: SUBMIT_GRADIENT }}
        >
          {loading ? 'Creating account…' : 'Create account'}
        </button>

        <p className="text-center text-[15px] text-[#6A7180]">
          Already have an account?{' '}
          <Link to="/login" className="font-bold text-[#7C3AED] hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </Shell>
  )
}
