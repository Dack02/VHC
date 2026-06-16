/**
 * Floating "Feedback" launcher, mounted once in DashboardLayout for all authed
 * users. carries data-feedback-ignore so it's excluded from screen captures.
 */

import { useState } from 'react'
import FeedbackWidget from './FeedbackWidget'

export default function FeedbackButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-feedback-ignore="true"
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-lg transition hover:opacity-90"
        aria-label="Send feedback"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        Feedback
      </button>
      {open && <FeedbackWidget onClose={() => setOpen(false)} />}
    </>
  )
}
