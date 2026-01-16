/**
 * Standardized API Error Handling
 * Provides consistent error responses across all endpoints
 */

// Error codes for client categorization
export const ErrorCodes = {
  // Authentication errors (1xxx)
  AUTH_TOKEN_MISSING: 'AUTH_1001',
  AUTH_TOKEN_INVALID: 'AUTH_1002',
  AUTH_TOKEN_EXPIRED: 'AUTH_1003',
  AUTH_USER_NOT_FOUND: 'AUTH_1004',
  AUTH_USER_DEACTIVATED: 'AUTH_1005',
  AUTH_INVALID_CREDENTIALS: 'AUTH_1006',

  // Authorization errors (2xxx)
  AUTHZ_FORBIDDEN: 'AUTHZ_2001',
  AUTHZ_ROLE_REQUIRED: 'AUTHZ_2002',
  AUTHZ_ORG_MISMATCH: 'AUTHZ_2003',
  AUTHZ_SITE_MISMATCH: 'AUTHZ_2004',

  // Validation errors (3xxx)
  VALIDATION_REQUIRED_FIELD: 'VAL_3001',
  VALIDATION_INVALID_FORMAT: 'VAL_3002',
  VALIDATION_INVALID_TYPE: 'VAL_3003',
  VALIDATION_OUT_OF_RANGE: 'VAL_3004',
  VALIDATION_INVALID_ENUM: 'VAL_3005',

  // Resource errors (4xxx)
  RESOURCE_NOT_FOUND: 'RES_4001',
  RESOURCE_ALREADY_EXISTS: 'RES_4002',
  RESOURCE_CONFLICT: 'RES_4003',
  RESOURCE_DELETED: 'RES_4004',

  // Limit errors (5xxx)
  LIMIT_USER_EXCEEDED: 'LIMIT_5001',
  LIMIT_SITE_EXCEEDED: 'LIMIT_5002',
  LIMIT_HEALTH_CHECK_EXCEEDED: 'LIMIT_5003',
  LIMIT_STORAGE_EXCEEDED: 'LIMIT_5004',
  LIMIT_RATE_EXCEEDED: 'LIMIT_5005',

  // Business logic errors (6xxx)
  BUSINESS_INVALID_STATUS_TRANSITION: 'BUS_6001',
  BUSINESS_OPERATION_NOT_ALLOWED: 'BUS_6002',
  BUSINESS_PREREQUISITE_NOT_MET: 'BUS_6003',

  // External service errors (7xxx)
  EXTERNAL_SUPABASE_ERROR: 'EXT_7001',
  EXTERNAL_TWILIO_ERROR: 'EXT_7002',
  EXTERNAL_RESEND_ERROR: 'EXT_7003',
  EXTERNAL_STORAGE_ERROR: 'EXT_7004',

  // Server errors (9xxx)
  SERVER_INTERNAL_ERROR: 'SRV_9001',
  SERVER_DATABASE_ERROR: 'SRV_9002',
  SERVER_CONFIGURATION_ERROR: 'SRV_9003',
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]

// Standard error response interface
export interface ApiErrorResponse {
  error: string
  code: ErrorCode
  details?: Record<string, unknown>
  requestId?: string
}

// Custom API Error class
export class ApiError extends Error {
  public readonly code: ErrorCode
  public readonly statusCode: number
  public readonly details?: Record<string, unknown>

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number = 500,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }

  toResponse(requestId?: string): ApiErrorResponse {
    return {
      error: this.message,
      code: this.code,
      ...(this.details && { details: this.details }),
      ...(requestId && { requestId }),
    }
  }
}

// Pre-built error factories for common cases
export const Errors = {
  // Authentication
  tokenMissing: () => new ApiError(
    'Authorization token is required',
    ErrorCodes.AUTH_TOKEN_MISSING,
    401
  ),
  tokenInvalid: () => new ApiError(
    'Invalid authorization token',
    ErrorCodes.AUTH_TOKEN_INVALID,
    401
  ),
  tokenExpired: () => new ApiError(
    'Authorization token has expired',
    ErrorCodes.AUTH_TOKEN_EXPIRED,
    401
  ),
  userNotFound: () => new ApiError(
    'User not found',
    ErrorCodes.AUTH_USER_NOT_FOUND,
    401
  ),
  userDeactivated: () => new ApiError(
    'User account has been deactivated',
    ErrorCodes.AUTH_USER_DEACTIVATED,
    403
  ),
  invalidCredentials: () => new ApiError(
    'Invalid email or password',
    ErrorCodes.AUTH_INVALID_CREDENTIALS,
    401
  ),

  // Authorization
  forbidden: (message = 'Access denied') => new ApiError(
    message,
    ErrorCodes.AUTHZ_FORBIDDEN,
    403
  ),
  roleRequired: (roles: string[]) => new ApiError(
    `One of these roles is required: ${roles.join(', ')}`,
    ErrorCodes.AUTHZ_ROLE_REQUIRED,
    403,
    { requiredRoles: roles }
  ),
  orgMismatch: () => new ApiError(
    'Resource belongs to a different organization',
    ErrorCodes.AUTHZ_ORG_MISMATCH,
    403
  ),
  siteMismatch: () => new ApiError(
    'Resource belongs to a different site',
    ErrorCodes.AUTHZ_SITE_MISMATCH,
    403
  ),

  // Validation
  requiredField: (field: string) => new ApiError(
    `${field} is required`,
    ErrorCodes.VALIDATION_REQUIRED_FIELD,
    400,
    { field }
  ),
  requiredFields: (fields: string[]) => new ApiError(
    `Missing required fields: ${fields.join(', ')}`,
    ErrorCodes.VALIDATION_REQUIRED_FIELD,
    400,
    { fields }
  ),
  invalidFormat: (field: string, expected: string) => new ApiError(
    `${field} has invalid format. Expected: ${expected}`,
    ErrorCodes.VALIDATION_INVALID_FORMAT,
    400,
    { field, expected }
  ),
  invalidType: (field: string, expected: string) => new ApiError(
    `${field} must be of type ${expected}`,
    ErrorCodes.VALIDATION_INVALID_TYPE,
    400,
    { field, expected }
  ),
  outOfRange: (field: string, min?: number, max?: number) => new ApiError(
    `${field} must be ${min !== undefined ? `at least ${min}` : ''}${min !== undefined && max !== undefined ? ' and ' : ''}${max !== undefined ? `at most ${max}` : ''}`,
    ErrorCodes.VALIDATION_OUT_OF_RANGE,
    400,
    { field, min, max }
  ),
  invalidEnum: (field: string, validValues: string[]) => new ApiError(
    `${field} must be one of: ${validValues.join(', ')}`,
    ErrorCodes.VALIDATION_INVALID_ENUM,
    400,
    { field, validValues }
  ),

  // Resources
  notFound: (resource: string) => new ApiError(
    `${resource} not found`,
    ErrorCodes.RESOURCE_NOT_FOUND,
    404,
    { resource }
  ),
  alreadyExists: (resource: string, field?: string) => new ApiError(
    `${resource} already exists${field ? ` with this ${field}` : ''}`,
    ErrorCodes.RESOURCE_ALREADY_EXISTS,
    409,
    { resource, field }
  ),
  conflict: (message: string) => new ApiError(
    message,
    ErrorCodes.RESOURCE_CONFLICT,
    409
  ),
  deleted: (resource: string) => new ApiError(
    `${resource} has been deleted`,
    ErrorCodes.RESOURCE_DELETED,
    410,
    { resource }
  ),

  // Limits
  userLimitExceeded: (current: number, limit: number) => new ApiError(
    `User limit exceeded (${current}/${limit})`,
    ErrorCodes.LIMIT_USER_EXCEEDED,
    403,
    { current, limit }
  ),
  siteLimitExceeded: (current: number, limit: number) => new ApiError(
    `Site limit exceeded (${current}/${limit})`,
    ErrorCodes.LIMIT_SITE_EXCEEDED,
    403,
    { current, limit }
  ),
  healthCheckLimitExceeded: (current: number, limit: number) => new ApiError(
    `Monthly health check limit exceeded (${current}/${limit})`,
    ErrorCodes.LIMIT_HEALTH_CHECK_EXCEEDED,
    403,
    { current, limit }
  ),
  storageLimitExceeded: (current: number, limit: number) => new ApiError(
    `Storage limit exceeded (${current}MB/${limit}MB)`,
    ErrorCodes.LIMIT_STORAGE_EXCEEDED,
    403,
    { current, limit }
  ),
  rateLimitExceeded: (retryAfter?: number) => new ApiError(
    'Too many requests. Please try again later.',
    ErrorCodes.LIMIT_RATE_EXCEEDED,
    429,
    retryAfter ? { retryAfter } : undefined
  ),

  // Business Logic
  invalidStatusTransition: (from: string, to: string, validTransitions: string[]) => new ApiError(
    `Cannot transition from ${from} to ${to}`,
    ErrorCodes.BUSINESS_INVALID_STATUS_TRANSITION,
    400,
    { from, to, validTransitions }
  ),
  operationNotAllowed: (operation: string, reason: string) => new ApiError(
    `${operation} is not allowed: ${reason}`,
    ErrorCodes.BUSINESS_OPERATION_NOT_ALLOWED,
    400,
    { operation, reason }
  ),
  prerequisiteNotMet: (requirement: string) => new ApiError(
    `Prerequisite not met: ${requirement}`,
    ErrorCodes.BUSINESS_PREREQUISITE_NOT_MET,
    400,
    { requirement }
  ),

  // External Services
  supabaseError: (message: string) => new ApiError(
    `Database error: ${message}`,
    ErrorCodes.EXTERNAL_SUPABASE_ERROR,
    500
  ),
  twilioError: (message: string) => new ApiError(
    `SMS service error: ${message}`,
    ErrorCodes.EXTERNAL_TWILIO_ERROR,
    500
  ),
  resendError: (message: string) => new ApiError(
    `Email service error: ${message}`,
    ErrorCodes.EXTERNAL_RESEND_ERROR,
    500
  ),
  storageError: (message: string) => new ApiError(
    `Storage service error: ${message}`,
    ErrorCodes.EXTERNAL_STORAGE_ERROR,
    500
  ),

  // Server
  internal: (message = 'An unexpected error occurred') => new ApiError(
    message,
    ErrorCodes.SERVER_INTERNAL_ERROR,
    500
  ),
  database: (message: string) => new ApiError(
    `Database error: ${message}`,
    ErrorCodes.SERVER_DATABASE_ERROR,
    500
  ),
  configuration: (message: string) => new ApiError(
    `Configuration error: ${message}`,
    ErrorCodes.SERVER_CONFIGURATION_ERROR,
    500
  ),
}

// Helper to convert unknown errors to ApiError
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error
  }

  if (error instanceof Error) {
    return new ApiError(
      error.message,
      ErrorCodes.SERVER_INTERNAL_ERROR,
      500
    )
  }

  return new ApiError(
    'An unexpected error occurred',
    ErrorCodes.SERVER_INTERNAL_ERROR,
    500
  )
}
