/**
 * Floating feedback FAB for the mobile PWA, mounted for authed users.
 * Carries data-feedback-ignore so it's excluded from screen captures.
 */

import { useState } from 'react'
import { FeedbackWidget } from './FeedbackWidget'

export function FeedbackButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-feedback-ignore="true"
        className="fixed bottom-4 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg active:scale-95"
        aria-label="Send feedback"
      >
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>
      {open && <FeedbackWidget onClose={() => setOpen(false)} />}
    </>
  )
}
