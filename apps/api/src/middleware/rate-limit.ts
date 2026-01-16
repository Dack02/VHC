/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse using in-memory or Redis-based limiting
 */

import type { Context, Next } from 'hono'
import { Errors } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { logAudit } from '../services/audit.js'

interface RateLimitConfig {
  windowMs: number       // Time window in milliseconds
  maxRequests: number    // Max requests per window
  keyGenerator?: (c: Context) => string  // Custom key generator
  skipFailedRequests?: boolean  // Don't count failed requests
  skipSuccessfulRequests?: boolean  // Don't count successful requests
  handler?: (c: Context) => Response  // Custom handler when limit exceeded
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

// In-memory store (for single-instance deployments)
// For production with multiple instances, replace with Redis
const store = new Map<string, RateLimitEntry>()

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) {
      store.delete(key)
    }
  }
}, 60000) // Clean every minute

/**
 * Default key generator - uses IP address
 */
function defaultKeyGenerator(c: Context): string {
  // Try to get IP from various sources
  const forwardedFor = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = c.req.header('x-real-ip')
  const cfConnectingIp = c.req.header('cf-connecting-ip') // Cloudflare

  // In development, use a combination of user-agent and origin to differentiate clients
  // This isn't perfect but prevents all local requests from sharing the same bucket
  if (!forwardedFor && !realIp && !cfConnectingIp) {
    const userAgent = c.req.header('user-agent') || 'unknown-ua'
    const origin = c.req.header('origin') || c.req.header('referer') || 'unknown-origin'
    // Create a simple hash-like identifier for local dev
    const localId = `local:${Buffer.from(userAgent + origin).toString('base64').slice(0, 16)}`
    return `ratelimit:${localId}`
  }

  const ip = forwardedFor || realIp || cfConnectingIp || 'unknown'
  return `ratelimit:${ip}`
}

/**
 * Create rate limit middleware
 */
export function rateLimit(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = defaultKeyGenerator,
    skipFailedRequests = false,
    skipSuccessfulRequests = false,
  } = config

  return async (c: Context, next: Next) => {
    const key = keyGenerator(c)
    const now = Date.now()

    // Get or create entry
    let entry = store.get(key)
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs }
      store.set(key, entry)
    }

    // Check limit before processing
    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)

      // Log rate limit exceeded
      logger.warn('Rate limit exceeded', {
        key,
        count: entry.count,
        limit: maxRequests,
        retryAfter,
      })

      // Audit log for security monitoring
      logAudit({
        action: 'security.rate_limit_exceeded',
        actorType: 'system',
        metadata: { key, count: entry.count, limit: maxRequests },
        ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim(),
        userAgent: c.req.header('user-agent'),
      })

      // Set rate limit headers
      c.header('X-RateLimit-Limit', maxRequests.toString())
      c.header('X-RateLimit-Remaining', '0')
      c.header('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000).toString())
      c.header('Retry-After', retryAfter.toString())

      const error = Errors.rateLimitExceeded(retryAfter)
      return c.json(error.toResponse(), 429)
    }

    // Increment counter before processing (optimistic)
    entry.count++

    // Set rate limit headers
    c.header('X-RateLimit-Limit', maxRequests.toString())
    c.header('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count).toString())
    c.header('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000).toString())

    // Process request
    await next()

    // Adjust count based on response status if configured
    const status = c.res.status

    if (skipFailedRequests && status >= 400) {
      entry.count = Math.max(0, entry.count - 1)
    }

    if (skipSuccessfulRequests && status < 400) {
      entry.count = Math.max(0, entry.count - 1)
    }
  }
}

/**
 * Pre-configured rate limiters for common use cases
 */
export const RateLimiters = {
  // Standard API rate limit: 100 requests per minute
  standard: () => rateLimit({
    windowMs: 60 * 1000,
    maxRequests: 100,
  }),

  // Auth endpoints: 30 requests per minute (allows for token refresh + login attempts)
  auth: () => rateLimit({
    windowMs: 60 * 1000,
    maxRequests: 30,
    skipSuccessfulRequests: true, // Only count failed attempts
  }),

  // Public endpoints: 30 requests per minute
  public: () => rateLimit({
    windowMs: 60 * 1000,
    maxRequests: 30,
  }),

  // File uploads: 10 per minute
  upload: () => rateLimit({
    windowMs: 60 * 1000,
    maxRequests: 10,
  }),

  // Webhook endpoints: 5 per second
  webhook: () => rateLimit({
    windowMs: 1000,
    maxRequests: 5,
  }),

  // Export/report generation: 5 per minute
  export: () => rateLimit({
    windowMs: 60 * 1000,
    maxRequests: 5,
  }),

  // Custom: per-user rate limit
  perUser: (maxRequests: number, windowMs: number) => rateLimit({
    windowMs,
    maxRequests,
    keyGenerator: (c: Context) => {
      const auth = c.get('auth') as { user?: { id: string } } | undefined
      if (auth?.user?.id) {
        return `ratelimit:user:${auth.user.id}`
      }
      // Fall back to IP if no user
      return defaultKeyGenerator(c)
    },
  }),

  // Custom: per-organization rate limit
  perOrg: (maxRequests: number, windowMs: number) => rateLimit({
    windowMs,
    maxRequests,
    keyGenerator: (c: Context) => {
      const auth = c.get('auth') as { orgId?: string } | undefined
      if (auth?.orgId) {
        return `ratelimit:org:${auth.orgId}`
      }
      // Fall back to IP if no org
      return defaultKeyGenerator(c)
    },
  }),
}
