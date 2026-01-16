/**
 * Error Handling Middleware
 * Catches unhandled errors and returns standardized responses
 */

import type { Context, Next } from 'hono'
import { ApiError, ErrorCodes, toApiError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

// Generate unique request ID
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Request context middleware - adds request ID and timing
 */
export async function requestContext(c: Context, next: Next) {
  const requestId = c.req.header('x-request-id') || generateRequestId()
  const startTime = Date.now()

  // Set request ID in context and response header
  c.set('requestId', requestId)
  c.header('X-Request-Id', requestId)

  try {
    await next()
  } finally {
    const duration = Date.now() - startTime

    // Log request completion
    logger.request(
      c.req.method,
      c.req.path,
      c.res.status,
      duration,
      {
        requestId,
        userId: (c.get('auth') as { user?: { id: string } })?.user?.id,
        orgId: (c.get('auth') as { orgId?: string })?.orgId,
      }
    )
  }
}

/**
 * Global error handler middleware
 */
export async function errorHandler(c: Context, next: Next) {
  try {
    await next()
  } catch (err) {
    const requestId = c.get('requestId') as string | undefined
    const apiError = toApiError(err)

    // Log the error
    if (apiError.statusCode >= 500) {
      logger.error('Unhandled server error', {
        requestId,
        path: c.req.path,
        method: c.req.method,
        statusCode: apiError.statusCode,
        errorCode: apiError.code,
      }, err instanceof Error ? err : undefined)
    } else {
      logger.warn('Request error', {
        requestId,
        path: c.req.path,
        method: c.req.method,
        statusCode: apiError.statusCode,
        errorCode: apiError.code,
      })
    }

    // Return standardized error response
    return c.json(apiError.toResponse(requestId), apiError.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500)
  }
}

/**
 * Not found handler for unmatched routes
 */
export function notFoundHandler(c: Context) {
  const requestId = c.get('requestId') as string | undefined
  const error = new ApiError(
    `Route not found: ${c.req.method} ${c.req.path}`,
    ErrorCodes.RESOURCE_NOT_FOUND,
    404
  )
  return c.json(error.toResponse(requestId), 404)
}
