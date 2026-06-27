import { createContext, useContext } from 'react'

/**
 * Carries the "quote is locked because it has been sent" state down to the deeply-nested
 * repair-item rows. When `locked` and an admin has not toggled `override`, quote-editing
 * controls are disabled; when `override` is on, edits are sent with `override: true` so the
 * server's post-send lock lets them through.
 */
export interface QuoteEditLockState {
  locked: boolean       // quote has been sent → editing is locked
  canOverride: boolean  // current user (org/site admin) may override the lock
  override: boolean      // admin has toggled "unlock to edit" ON
}

const QuoteEditLockContext = createContext<QuoteEditLockState>({
  locked: false,
  canOverride: false,
  override: false
})

export const QuoteEditLockProvider = QuoteEditLockContext.Provider

export function useQuoteEditLock(): QuoteEditLockState {
  return useContext(QuoteEditLockContext)
}

/** Convenience: editing the quote is blocked right now (locked and not overridden). */
export function useQuoteEditingBlocked(): boolean {
  const { locked, override } = useQuoteEditLock()
  return locked && !override
}
