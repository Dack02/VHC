/**
 * Collects silent diagnostics attached to every feedback report (mobile):
 * current route, app version/build, browser + device, viewport, recent console
 * errors, and timezone. Token-like query params are stripped; no auth tokens,
 * storage, or cookies are collected.
 */

import { getRecentErrors } from './consoleBuffer'
import type { FeedbackDiagnostics } from './feedbackTypes'

// Injected at build time by Vite `define` (see vite.config.ts).
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''

function stripTokens(url: string): string {
  try {
    const u = new URL(url)
    for (const key of [...u.searchParams.keys()]) {
      if (/token|key|secret|password|auth/i.test(key)) u.searchParams.set(key, '[redacted]')
    }
    return u.toString()
  } catch {
    return url
  }
}

export function collectDiagnostics(route?: string): FeedbackDiagnostics {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const scr = typeof window !== 'undefined' ? window.screen : undefined
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1

  return {
    route: route || (typeof window !== 'undefined' ? window.location.pathname + window.location.search : ''),
    url: typeof window !== 'undefined' ? stripTokens(window.location.href) : '',
    appVersion: APP_VERSION,
    build: BUILD_TIME,
    browser: nav?.userAgent || '',
    device: [nav?.platform, scr ? `${scr.width}x${scr.height}` : '', `dpr${dpr}`].filter(Boolean).join(' '),
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
    consoleErrors: getRecentErrors(),
    timestamp: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}
