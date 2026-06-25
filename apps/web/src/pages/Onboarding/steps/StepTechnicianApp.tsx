import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

interface Props {
  onNext: () => void
  onBack: () => void
}

/**
 * Resolve the technician (mobile PWA) URL. Prefer the explicit build-time var
 * (VITE_MOBILE_URL, set per Railway environment); otherwise derive it from the
 * dashboard host — the technician app lives on the `m.` subdomain of the web
 * app (inspect.ollosoft.io -> m.inspect.ollosoft.io, dev.* -> m.dev.*). Falls
 * back to the local dev port last.
 */
function resolveMobileUrl(): string {
  const explicit = import.meta.env.VITE_MOBILE_URL
  if (explicit) return explicit

  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:5182'
    }
    if (!hostname.startsWith('m.')) {
      return `${protocol}//m.${hostname}`
    }
  }

  return 'http://localhost:5182'
}

const MOBILE_URL = resolveMobileUrl()

export default function StepTechnicianApp({ onNext, onBack }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(MOBILE_URL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable (insecure context) — the field is selectable as a fallback
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Get the Technician App</h2>
        <p className="text-gray-500 mt-1">
          Technicians carry out inspections in the Ollo Inspect mobile app. Have them open the link
          below on their phone, sign in with the details from their invite, and add it to their home
          screen — it installs and runs just like a native app.
        </p>
      </div>

      <div className="flex flex-col md:flex-row items-center gap-8 bg-gray-50 rounded-xl p-6 mb-6">
        {/* QR code (white padding provides the scan quiet-zone) */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm shrink-0">
          <QRCodeSVG value={MOBILE_URL} size={176} level="M" className="block" />
        </div>

        {/* Instructions + URL */}
        <div className="flex-1 w-full">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Scan to open on a phone</h3>
          <p className="text-sm text-gray-500 mb-4">
            Point the phone camera at the code, or share this link with your team:
          </p>

          <div className="flex items-stretch gap-2">
            <input
              type="text"
              readOnly
              value={MOBILE_URL}
              onFocus={(e) => e.target.select()}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm whitespace-nowrap"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <a
            href={MOBILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-4 text-sm text-primary hover:underline"
          >
            Open the technician app
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        </div>
      </div>

      {/* Install tip */}
      <div className="bg-blue-50 p-4 rounded-lg mb-6">
        <h4 className="text-sm font-medium text-blue-900 mb-1">Add to home screen</h4>
        <p className="text-sm text-blue-800">
          On iPhone, open the link in Safari, tap <strong>Share</strong> then{' '}
          <strong>Add to Home Screen</strong>. On Android, open it in Chrome, tap the{' '}
          <strong>⋮</strong> menu then <strong>Install app</strong>. It then runs full-screen, just
          like a native app.
        </p>
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
          type="button"
          onClick={onNext}
          className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
