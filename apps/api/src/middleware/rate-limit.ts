/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse using in-memory or Redis-based limiting
 */

import type { Context, Next } from 'hono'
import { Errors } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { logAudit } from '../services/audit.js'

// Environment detection
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV

// Rate limit multiplier for development (10x higher limits)
const DEV_MULTIPLIER = isDevelopment ? 10 : 1

interface RateLimitConfig {
  windowMs: number       // Time window in milliseconds
  maxRequests: number    // Max requests per window
  keyGenerator?: (c: Context) => string  // Custom key generator
  skipFailedRequests?: boolean  // Don't count failed requests
  skipSuccessfulRequests?: boolean  // Don't count successful requests
  handler?: (c: Context) => Response  // Custom handler when limit exceeded
  includePathInKey?: boolean  // Include request path in rate limit key for per-endpoint limiting
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
 * Get client IP from request headers
 */
function getClientIp(c: Context): string {
  const forwardedFor = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = c.req.header('x-real-ip')
  const cfConnectingIp = c.req.header('cf-connecting-ip') // Cloudflare

  return forwardedFor || realIp || cfConnectingIp || 'localhost'
}

/**
 * Default key generator - uses IP address
 * In development, uses 'localhost' for all local requests to simplify debugging
 * The rate limits themselves are much higher in dev, so this is acceptable
 */
function defaultKeyGenerator(c: Context): string {
  const ip = getClientIp(c)
  return `ratelimit:${ip}`
}

/**
 * Key generator that includes the request path
 * This creates separate buckets for each endpoint
 */
function pathBasedKeyGenerator(c: Context): string {
  const ip = getClientIp(c)
  // Normalize path: remove token/id segments to group similar endpoints
  const path = c.req.path
    .replace(/\/[a-f0-9-]{36}/g, '/:id') // UUID
    .replace(/\/[a-zA-Z0-9_-]{20,}/g, '/:token') // Tokens
  return `ratelimit:${ip}:${path}`
}

/**
 * Create rate limit middleware
 */
export function rateLimit(config: RateLimitConfig) {
  const {
    windowMs,
    maxRequests,
    keyGenerator = config.includePathInKey ? pathBasedKeyGenerator : defaultKeyGenerator,
    skipFailedRequests = false,
    skipSuccessfulRequests = false,
  } = config

  // Apply development multiplier to max requests
  const effectiveMaxRequests = maxRequests * DEV_MULTIPLIER

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
    if (entry.count >= effectiveMaxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)

      // Log rate limit exceeded
      logger.warn('Rate limit exceeded', {
        key,
        count: entry.count,
        limit: effectiveMaxRequests,
        retryAfter,
        isDevelopment,
      })

      // Audit log for security monitoring
      logAudit({
        action: 'security.rate_limit_exceeded',
        actorType: 'system',
        metadata: { key, count: entry.count, limit: effectiveMaxRequests },
        ipAddress: c.req.header('x-forwarded-for')?.split(',')[0]?.trim(),
        userAgent: c.req.header('user-agent'),
      })

      // Set rate limit headers
      c.header('X-RateLimit-Limit', effectiveMaxRequests.toString())
      c.header('X-RateLimit-Remaining', '0')
      c.header('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000).toString())
      c.header('Retry-After', retryAfter.toString())

      const error = Errors.rateLimitExceeded(retryAfter)
      return c.json(error.toResponse(), 429)
    }

    // Increment counter before processing (optimistic)
    entry.count++

    // Set rate limit headers
    c.header('X-RateLimit-Limit', effectiveMaxRequests.toString())
    c.header('X-RateLimit-Remaining', Math.max(0, effectiveMaxRequests - entry.count).toString())
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
 * Note: All limits are automatically multiplied by 10 in development
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

  // Public endpoints: 60 requests per minute (higher than before)
  // Uses path-based keys so different endpoints have separate buckets
  public: () => rateLimit({
    windowMs: 60 * 1000,
    maxRequests: 60,
    includePathInKey: true, // Each endpoint gets its own bucket
  }),

  // Customer actions (authorize/decline/signature): very high limits
  // These are critical one-time actions that should never be rate limited in practice
  // 200 per minute per endpoint per IP should handle any reasonable use case
  customerAction: () => rateLimit({
    windowMs: 60 * 1000,
    maxRequests: 200,
    includePathInKey: true, // Separate buckets for authorize vs decline vs signature
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

  // No rate limit - use for endpoints that should never be rate limited
  // This is a pass-through middleware that does nothing
  none: () => async (_c: Context, next: Next) => {
    await next()
  },
}
