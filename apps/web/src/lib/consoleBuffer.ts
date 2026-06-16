/**
 * Recent-console-errors ring buffer for the feedback widget.
 *
 * Installed once at app boot (main.tsx). Wraps console.error/console.warn and
 * listens for window errors / unhandled rejections, keeping the last ~20
 * messages so a bug report can carry recent errors automatically. Messages are
 * truncated and scrubbed of token-like substrings before storage.
 */

import type { FeedbackConsoleError } from './feedbackTypes'

const MAX_ENTRIES = 20
const buffer: FeedbackConsoleError[] = []
let installed = false

function scrub(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, '[jwt]')
    .replace(/((?:api[_-]?key|token|secret|password)["':=\s]+)[A-Za-z0-9._-]+/gi, '$1[redacted]')
}

function truncate(text: string, max = 500): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  try { return JSON.stringify(arg) } catch { return String(arg) }
}

function push(level: string, args: unknown[]): void {
  try {
    const message = truncate(scrub(args.map(stringifyArg).join(' ')))
    buffer.push({ level, message, ts: new Date().toISOString() })
    if (buffer.length > MAX_ENTRIES) buffer.shift()
  } catch {
    // Never throw from the logging path.
  }
}

export function installConsoleBuffer(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)

  console.error = (...args: unknown[]) => { push('error', args); origError(...args) }
  console.warn = (...args: unknown[]) => { push('warn', args); origWarn(...args) }

  window.addEventListener('error', (e) => {
    push('error', [e.message, e.filename ? `(${e.filename}:${e.lineno}:${e.colno})` : ''])
  })
  window.addEventListener('unhandledrejection', (e) => {
    push('error', ['Unhandled rejection:', (e as PromiseRejectionEvent).reason])
  })
}

export function getRecentErrors(): FeedbackConsoleError[] {
  return buffer.slice()
}
