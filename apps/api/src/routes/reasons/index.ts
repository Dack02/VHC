/**
 * VHC Reasons API Routes
 *
 * This module provides endpoints for managing predefined inspection reasons.
 * The reasons system supports:
 * - Item-specific reasons (tied to a template_item_id)
 * - Type-based reasons (tied to a reason_type, shared across all items of that type)
 * - AI generation of reasons using Claude
 * - Reason submissions from technicians for manager review
 * - Usage tracking and approval rate analytics
 *
 * Key concepts:
 * - Reasons are grouped by category (safety, wear, maintenance, advisory, positive)
 * - Each reason has a default RAG status (red, amber, green)
 * - Customer descriptions are shown in the customer portal
 * - Technical descriptions are for internal use
 *
 * @module routes/reasons
 */

import { Hono } from 'hono'
import { authMiddleware } from '../../middleware/auth.js'

// Import sub-routers
import itemReasonsRouter from './item-reasons.js'
import checkResultReasonsRouter from './check-result-reasons.js'
import submissionsRouter from './submissions.js'
import templateStatsRouter from './template-stats.js'
import aiRouter from './ai.js'
import reasonTypesRouter from './reason-types.js'

const reasons = new Hono()

// Apply auth middleware to all routes
reasons.use('*', authMiddleware)

// Mount sub-routers
// NOTE: All sub-routers define their own paths, so we mount at root level
//
// Route organization:
// - item-reasons.js: /template-items/:id/reasons, /reasons/by-type/:type, /item-reasons/:id, /reasons/recently-used
// - check-result-reasons.js: /check-results/:id/reasons, /check-result-reasons/:id
// - submissions.js: /reason-submissions, /organizations/:id/reason-submissions
// - template-stats.js: /reason-categories, /organizations/:id/settings/reason-tone, /templates/:id/reasons-summary, /organizations/:id/reason-stats
// - ai.js: /template-items/:id/reasons/generate, /reasons/by-type/:type/generate, /templates/:id/generate-all-reasons, /organizations/:id/ai-usage
// - reason-types.js: /reason-types, /reason-types/:id
//
// Order matters for parameterized routes - more specific routes should come first

// AI routes (includes generate endpoints that overlap with item-reasons paths)
// Must come before item-reasons to catch /template-items/:id/reasons/generate
reasons.route('/', aiRouter)

// Item reasons core CRUD and queries
reasons.route('/', itemReasonsRouter)

// Check result reasons (linking reasons to health check results)
reasons.route('/', checkResultReasonsRouter)

// Reason submissions (technician submissions for manager approval)
reasons.route('/', submissionsRouter)

// Template stats, categories, and org settings
reasons.route('/', templateStatsRouter)

// Reason types management
reasons.route('/', reasonTypesRouter)

export default reasons
