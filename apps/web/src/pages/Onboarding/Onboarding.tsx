import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import StepPlan from './steps/StepPlan'
import Step1BusinessDetails from './steps/Step1BusinessDetails'
import StepTemplate from './steps/StepTemplate'
import Step2FirstSite from './steps/Step2FirstSite'
import StepPricing from './steps/StepPricing'
import Step3InviteTeam from './steps/Step3InviteTeam'
import Step4Notifications from './steps/Step4Notifications'
import StepDailySms from './steps/StepDailySms'
import StepTechnicianApp from './steps/StepTechnicianApp'
import Step5Ready from './steps/Step5Ready'

interface OnboardingStatus {
  organizationId: string
  organizationName: string
  onboardingCompleted: boolean
  currentStep: number
  hasSettings: boolean
  hasSites: boolean
  hasTeamMembers: boolean
  hasTemplates: boolean
  sitesCount: number
  teamMembersCount: number
  templatesCount: number
  planName?: string | null
  trialEndsAt?: string | null
  subscriptionStatus?: string | null
}

const STEPS = [
  { id: 0, title: 'Plan', description: 'Choose your plan' },
  { id: 1, title: 'Business', description: 'Your business details' },
  { id: 2, title: 'Template', description: 'Inspection template' },
  { id: 3, title: 'Site', description: 'Your first location' },
  { id: 4, title: 'Pricing', description: 'Labour & VAT' },
  { id: 5, title: 'Team', description: 'Invite your team' },
  { id: 6, title: 'Notifications', description: 'Customer comms' },
  { id: 7, title: 'Daily SMS', description: 'Daily overview' },
  { id: 8, title: 'Technician App', description: 'Get techs on mobile' },
  { id: 9, title: 'Ready!', description: 'You\'re all set' }
]

export default function Onboarding() {
  const { user, session, refreshSession } = useAuth()
  const navigate = useNavigate()
  const orgId = user?.organization?.id || ''
  const [currentStep, setCurrentStep] = useState(0)
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [skipping, setSkipping] = useState(false)

  useEffect(() => {
    fetchStatus()
  }, [])

  const fetchStatus = async () => {
    if (!session?.accessToken) return

    try {
      const data = await api<OnboardingStatus>('/api/v1/onboarding/status', {
        token: session.accessToken
      })
      setStatus(data)
      setCurrentStep(data.currentStep)

      // If already completed, redirect to dashboard
      if (data.onboardingCompleted) {
        navigate('/')
      }
    } catch (error) {
      console.error('Failed to fetch onboarding status:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSkip = async () => {
    if (!session?.accessToken) return

    setSkipping(true)
    try {
      await api('/api/v1/onboarding/skip', {
        method: 'POST',
        token: session.accessToken
      })

      // Refresh user data to get updated onboarding status
      await refreshSession()
      navigate('/')
    } catch (error) {
      console.error('Failed to skip onboarding:', error)
    } finally {
      setSkipping(false)
    }
  }

  const handleComplete = async () => {
    if (!session?.accessToken) return

    try {
      await api('/api/v1/onboarding/complete', {
        method: 'POST',
        token: session.accessToken
      })

      // Refresh user data
      await refreshSession()
      navigate('/')
    } catch (error) {
      console.error('Failed to complete onboarding:', error)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  const progressPct = Math.round(((currentStep + 1) / STEPS.length) * 100)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile header — compact progress bar (hidden on desktop) */}
      <header className="lg:hidden sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="px-4 py-3.5">
          <div className="flex items-center justify-between">
            <img src="/ollo-inspect-logo.png" alt="Ollo Inspect" className="h-7" />
            <button
              onClick={handleSkip}
              disabled={skipping}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              {skipping ? 'Skipping...' : 'Complete later'}
            </button>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-primary">{STEPS[currentStep]?.title}</span>
              <span className="text-gray-400">Step {currentStep + 1} of {STEPS.length}</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-12">
        <div className="lg:flex lg:gap-12">
          {/* Sidebar — vertical stepper (desktop only) */}
          <aside className="hidden lg:block lg:w-72 lg:shrink-0">
            <div className="sticky top-12">
              <img src="/ollo-inspect-logo.png" alt="Ollo Inspect" className="h-8" />
              <p className="mt-3 text-sm text-gray-500">
                Welcome, {user?.firstName}! Let&apos;s get you set up.
              </p>

              <nav aria-label="Progress" className="mt-8">
                <ol>
                  {STEPS.map((step, index) => {
                    const isCompleted = currentStep > index
                    const isCurrent = currentStep === index
                    const isNavigable = index <= currentStep
                    return (
                      <li key={step.id} className="relative pb-7 last:pb-0">
                        {index !== STEPS.length - 1 && (
                          <div
                            className={`absolute left-4 top-4 -ml-px mt-0.5 h-full w-0.5 ${isCompleted ? 'bg-primary' : 'bg-gray-200'}`}
                            aria-hidden="true"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => isNavigable && setCurrentStep(index)}
                          disabled={!isNavigable}
                          aria-current={isCurrent ? 'step' : undefined}
                          className={`group relative flex w-full items-start text-left ${isNavigable ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                          <span className="flex h-9 items-center" aria-hidden="true">
                            <span
                              className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${
                                isCompleted
                                  ? 'border-primary bg-primary text-white'
                                  : isCurrent
                                  ? 'border-primary bg-white text-primary ring-4 ring-indigo-100'
                                  : 'border-gray-200 bg-white text-gray-400 group-hover:border-gray-300'
                              }`}
                            >
                              {isCompleted ? (
                                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              ) : (
                                <span className="text-sm font-semibold">{index + 1}</span>
                              )}
                            </span>
                          </span>
                          <span className="ml-4 flex min-w-0 flex-col pt-1">
                            <span
                              className={`text-sm transition-colors ${
                                isCurrent
                                  ? 'font-semibold text-primary'
                                  : isCompleted
                                  ? 'font-medium text-gray-700 group-hover:text-primary'
                                  : 'font-medium text-gray-400'
                              }`}
                            >
                              {step.title}
                            </span>
                            <span className={`text-xs ${isCurrent ? 'text-gray-500' : 'text-gray-400'}`}>
                              {step.description}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </nav>

              <button
                onClick={handleSkip}
                disabled={skipping}
                className="mt-8 text-sm text-gray-400 hover:text-gray-600 disabled:opacity-50"
              >
                {skipping ? 'Skipping...' : 'Complete later'}
              </button>
            </div>
          </aside>

          {/* Step content */}
          <main className="mt-6 min-w-0 flex-1 lg:mt-0">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 sm:p-6 lg:p-8">
              {currentStep === 0 && (
                <StepPlan
                  token={session?.accessToken || ''}
                  onNext={handleNext}
                />
              )}
              {currentStep === 1 && (
                <Step1BusinessDetails
                  token={session?.accessToken || ''}
                  orgId={orgId}
                  onNext={handleNext}
                  onBack={handleBack}
                />
              )}
              {currentStep === 2 && (
                <StepTemplate
                  token={session?.accessToken || ''}
                  onNext={handleNext}
                  onBack={handleBack}
                />
              )}
              {currentStep === 3 && (
                <Step2FirstSite
                  token={session?.accessToken || ''}
                  onNext={handleNext}
                  onBack={handleBack}
                />
              )}
              {currentStep === 4 && (
                <StepPricing
                  token={session?.accessToken || ''}
                  onNext={handleNext}
                  onBack={handleBack}
                />
              )}
              {currentStep === 5 && (
                <Step3InviteTeam
                  token={session?.accessToken || ''}
                  onNext={handleNext}
                  onBack={handleBack}
                />
              )}
              {currentStep === 6 && (
                <Step4Notifications
                  token={session?.accessToken || ''}
                  onNext={handleNext}
                  onBack={handleBack}
                />
              )}
              {currentStep === 7 && (
                <StepDailySms
                  token={session?.accessToken || ''}
                  orgId={orgId}
                  onNext={handleNext}
                  onBack={handleBack}
                />
              )}
              {currentStep === 8 && (
                <StepTechnicianApp
                  onNext={handleNext}
                  onBack={handleBack}
                />
              )}
              {currentStep === 9 && (
                <Step5Ready
                  status={status}
                  onComplete={handleComplete}
                />
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
