/**
 * Structured Logging Service
 * Provides consistent, JSON-formatted logs for production monitoring
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

interface LogContext {
  requestId?: string
  userId?: string
  orgId?: string
  method?: string
  path?: string
  statusCode?: number
  duration?: number
  [key: string]: unknown
}

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  service: string
  environment: string
  context?: LogContext
  error?: {
    name: string
    message: string
    stack?: string
    code?: string
  }
}

class Logger {
  private service: string
  private environment: string
  private minLevel: LogLevel

  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
  }

  constructor() {
    this.service = process.env.SERVICE_NAME || 'vhc-api'
    this.environment = process.env.NODE_ENV || 'development'
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) ||
      (this.environment === 'production' ? 'info' : 'debug')
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.minLevel]
  }

  private formatEntry(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.service,
      environment: this.environment,
    }

    if (context && Object.keys(context).length > 0) {
      entry.context = context
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: this.environment !== 'production' ? error.stack : undefined,
        code: (error as { code?: string }).code,
      }
    }

    return entry
  }

  private output(entry: LogEntry): void {
    const json = JSON.stringify(entry)

    // In production, output JSON. In dev, use console methods for colors
    if (this.environment === 'production') {
      if (entry.level === 'error' || entry.level === 'fatal') {
        console.error(json)
      } else {
        console.log(json)
      }
    } else {
      // Development: pretty print
      const color = {
        debug: '\x1b[90m',   // gray
        info: '\x1b[36m',    // cyan
        warn: '\x1b[33m',    // yellow
        error: '\x1b[31m',   // red
        fatal: '\x1b[35m',   // magenta
      }[entry.level]
      const reset = '\x1b[0m'

      const contextStr = entry.context
        ? ` ${JSON.stringify(entry.context)}`
        : ''
      const errorStr = entry.error
        ? `\n  Error: ${entry.error.message}${entry.error.stack ? `\n${entry.error.stack}` : ''}`
        : ''

      console.log(
        `${color}[${entry.level.toUpperCase()}]${reset} ${entry.timestamp} - ${entry.message}${contextStr}${errorStr}`
      )
    }
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      this.output(this.formatEntry('debug', message, context))
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      this.output(this.formatEntry('info', message, context))
    }
  }

  warn(message: string, context?: LogContext, error?: Error): void {
    if (this.shouldLog('warn')) {
      this.output(this.formatEntry('warn', message, context, error))
    }
  }

  error(message: string, context?: LogContext, error?: Error): void {
    if (this.shouldLog('error')) {
      this.output(this.formatEntry('error', message, context, error))
    }
  }

  fatal(message: string, context?: LogContext, error?: Error): void {
    if (this.shouldLog('fatal')) {
      this.output(this.formatEntry('fatal', message, context, error))
    }
  }

  // HTTP request logging helper
  request(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    context?: Omit<LogContext, 'method' | 'path' | 'statusCode' | 'duration'>
  ): void {
    const level: LogLevel =
      statusCode >= 500 ? 'error' :
      statusCode >= 400 ? 'warn' :
      'info'

    const message = `${method} ${path} ${statusCode} ${duration}ms`

    this.output(this.formatEntry(level, message, {
      method,
      path,
      statusCode,
      duration,
      ...context,
    }))
  }

  // Create a child logger with preset context
  child(context: LogContext): ChildLogger {
    return new ChildLogger(this, context)
  }
}

class ChildLogger {
  private parent: Logger
  private context: LogContext

  constructor(parent: Logger, context: LogContext) {
    this.parent = parent
    this.context = context
  }

  debug(message: string, context?: LogContext): void {
    this.parent.debug(message, { ...this.context, ...context })
  }

  info(message: string, context?: LogContext): void {
    this.parent.info(message, { ...this.context, ...context })
  }

  warn(message: string, context?: LogContext, error?: Error): void {
    this.parent.warn(message, { ...this.context, ...context }, error)
  }

  error(message: string, context?: LogContext, error?: Error): void {
    this.parent.error(message, { ...this.context, ...context }, error)
  }

  fatal(message: string, context?: LogContext, error?: Error): void {
    this.parent.fatal(message, { ...this.context, ...context }, error)
  }
}

// Export singleton instance
export const logger = new Logger()

// Export types for use in other modules
export type { LogLevel, LogContext, LogEntry }
