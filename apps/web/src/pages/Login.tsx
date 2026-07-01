import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import GoogleAuthButton from '../components/GoogleAuthButton'

// Finalised login redesign (Designs/Login page redesign — "Ollo Inspect Login").
// Full-bleed brand gradient with the product story on the left and a quiet glass
// sign-in card on the right. Purely presentational — all auth logic below (super-admin
// bridge, onboarding redirect, Google OAuth, error/loading states) is unchanged.
const PAGE_GRADIENT =
  'radial-gradient(130% 130% at 12% -5%, #7C3AED 0%, #5B4BE0 36%, #1E3A8A 68%, #0F766E 100%)'
const SIGNIN_GRADIENT = 'linear-gradient(100deg, #7C3AED, #4F46E5 55%, #14B8A6)'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(email, password)

      const sessionStr = localStorage.getItem('vhc_session')
      const userStr = localStorage.getItem('vhc_user')
      const user = userStr ? JSON.parse(userStr) : null

      // Super admins logging in via the main app: bridge a session for the /admin
      // portal. The login response already carries the role, so no extra probe needed.
      if (user?.isSuperAdmin && sessionStr) {
        localStorage.setItem('vhc_super_admin_session', sessionStr)
        localStorage.setItem('vhc_super_admin', JSON.stringify({
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          isActive: true
        }))
        navigate('/')
        return
      }

      // Org admins who haven't finished onboarding go straight to the wizard.
      if (user?.isOrgAdmin && user.organization?.onboardingCompleted === false) {
        navigate('/onboarding')
        return
      }

      // Regular user - redirect to dashboard
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

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
            The health check platform for modern workshops.
          </h1>
          <p className="mt-5 max-w-[420px] text-[18px] leading-[1.55] text-white/80">
            Digital vehicle health checks your customers trust and your workshop runs on.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-3">
            <div className="flex items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ background: '#34D399', boxShadow: '0 0 0 4px rgba(52,211,153,0.22)' }}
              />
              <span className="text-sm font-semibold text-white/90">Live authorisations</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ background: '#FBBF24', boxShadow: '0 0 0 4px rgba(251,191,36,0.22)' }}
              />
              <span className="text-sm font-semibold text-white/90">Traffic-light reports</span>
            </div>
          </div>
        </div>

        {/* Sign-in card */}
        <div className="w-full max-w-[440px] flex-shrink-0 rounded-[22px] bg-white/[0.99] px-8 pb-10 pt-11 shadow-[0_40px_80px_-24px_rgba(10,4,40,0.55),0_0_0_1px_rgba(255,255,255,0.4)] sm:px-11">
          <img
            src="/ollo-inspect-logo.png"
            alt="Ollo Inspect"
            className="mx-auto mb-7 block h-10 w-auto"
          />
          <h2 className="text-center text-2xl font-extrabold tracking-[-0.01em] text-[#171A21]">
            Sign in to your account
          </h2>
          <p className="mt-1.5 mb-7 text-center text-[15px] text-[#6A7180]">
            Welcome back &mdash; let's get to work.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-1.5 block text-[13px] font-semibold text-[#3A404B]">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-[50px] w-full rounded-xl border-[1.5px] border-[#E2E5EA] bg-[#F7F8FA] px-4 text-[15px] text-[#171A21] outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15 disabled:opacity-60"
                placeholder="you@workshop.co.uk"
                required
                disabled={loading}
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="text-[13px] font-semibold text-[#3A404B]">
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className="text-[13px] font-semibold text-[#7C3AED] hover:underline"
                >
                  Forgot?
                </Link>
              </div>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-[50px] w-full rounded-xl border-[1.5px] border-[#E2E5EA] bg-[#F7F8FA] px-4 text-[15px] text-[#171A21] outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/15 disabled:opacity-60"
                placeholder="Enter your password"
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="h-[52px] w-full rounded-xl text-[16px] font-bold text-white shadow-[0_14px_28px_-8px_rgba(79,70,229,0.55)] transition hover:brightness-[1.06] disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: SIGNIN_GRADIENT }}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3.5">
            <div className="h-px flex-1 bg-[#E6E8EC]" />
            <span className="text-xs font-semibold text-[#9AA1AD]">or</span>
            <div className="h-px flex-1 bg-[#E6E8EC]" />
          </div>

          <GoogleAuthButton label="Continue with Google" disabled={loading} />

          <p className="mt-6 text-center text-[15px] text-[#6A7180]">
            No account yet?{' '}
            <Link to="/signup" className="font-bold text-[#7C3AED] hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
