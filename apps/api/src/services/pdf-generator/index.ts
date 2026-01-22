/**
 * PDF Generator Service
 * Public exports for PDF generation
 */

export { generateHealthCheckPDF } from './generators/health-check.js'
export { generateCompactHealthCheckPDF, generateCompactHealthCheckHTML } from './generators/health-check-compact.js'
export { generateApprovalConfirmationPDF } from './generators/approval-confirmation.js'
export type { HealthCheckPDFData, ApprovalConfirmationPDFData } from './types.js'
