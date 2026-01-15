import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import Step1BusinessDetails from './steps/Step1BusinessDetails'
import Step2FirstSite from './steps/Step2FirstSite'
import Step3InviteTeam from './steps/Step3InviteTeam'
import Step4Notifications from './steps/Step4Notifications'
import Step5Ready from './steps/Step5Ready'

interface OnboardingStatus {
  organizationId: string
  organizationName: string
  onboardingCompleted: boolean
  currentStep: number
  hasSettings: boolean
  hasSites: boolean
  hasTeamMembers: boolean
  sitesCount: number
  teamMembersCount: number
}

const STEPS = [
  { id: 0, title: 'Business Details', description: 'Add your business information' },
  { id: 1, title: 'First Site', description: 'Set up your first location' },
  { id: 2, title: 'Invite Team', description: 'Add team members (optional)' },
  { id: 3, title: 'Notifications', description: 'Configure notifications (optional)' },
  { id: 4, title: 'Ready!', description: 'You\'re all set' }
]

export default function Onboarding() {
  const { user, session, refreshSession } = useAuth()
  const navigate = useNavigate()
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-primary">VHC</h1>
              <p className="text-sm text-gray-500">Welcome, {user?.firstName}!</p>
            </div>
            <button
              onClick={handleSkip}
              disabled={skipping}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              {skipping ? 'Skipping...' : 'Complete later'}
            </button>
          </div>
        </div>
      </header>

      {/* Progress Stepper */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <nav aria-label="Progress">
            <ol className="flex items-center">
              {STEPS.map((step, index) => (
                <li key={step.id} className={`relative ${index !== STEPS.length - 1 ? 'pr-8 sm:pr-20 flex-1' : ''}`}>
                  <div className="flex items-center">
                    <div
                      className={`relative flex h-8 w-8 items-center justify-center rounded-full ${
                        currentStep > index
                          ? 'bg-primary'
                          : currentStep === index
                          ? 'border-2 border-primary bg-white'
                          : 'border-2 border-gray-300 bg-white'
                      }`}
                    >
                      {currentStep > index ? (
                        <svg className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <span className={currentStep === index ? 'text-primary' : 'text-gray-500'}>
                          {index + 1}
                        </span>
                      )}
                    </div>
                    {index !== STEPS.length - 1 && (
                      <div className={`absolute top-4 w-full h-0.5 ${currentStep > index ? 'bg-primary' : 'bg-gray-300'}`} style={{ left: '2rem' }} />
                    )}
                  </div>
                  <div className="mt-2">
                    <span className={`text-xs font-medium ${currentStep >= index ? 'text-primary' : 'text-gray-500'}`}>
                      {step.title}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </div>

      {/* Step Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          {currentStep === 0 && (
            <Step1BusinessDetails
              token={session?.accessToken || ''}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}
          {currentStep === 1 && (
            <Step2FirstSite
              token={session?.accessToken || ''}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}
          {currentStep === 2 && (
            <Step3InviteTeam
              token={session?.accessToken || ''}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}
          {currentStep === 3 && (
            <Step4Notifications
              token={session?.accessToken || ''}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}
          {currentStep === 4 && (
            <Step5Ready
              status={status}
              onComplete={handleComplete}
            />
          )}
        </div>
      </div>
    </div>
  )
}
