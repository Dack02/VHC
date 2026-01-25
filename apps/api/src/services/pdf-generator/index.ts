/**
 * PDF Generator Service
 * Public exports for PDF generation
 */

export { generateHealthCheckPDF } from './generators/health-check.js'
export { generateCompactHealthCheckPDF, generateCompactHealthCheckHTML } from './generators/health-check-compact.js'
export { generateApprovalConfirmationPDF } from './generators/approval-confirmation.js'
export { generateWorkAuthoritySheetPDF, generateWorkAuthoritySheetHTML } from './generators/work-authority-sheet.js'
export { fetchWorkAuthorityData, generateDocumentNumber } from './work-authority-sheet.js'
export type {
  HealthCheckPDFData,
  ApprovalConfirmationPDFData,
  WorkAuthoritySheetData,
  WorkAuthorityVariant,
  WorkSection,
  LabourLine,
  PartsLine,
  PricingSummary
} from './types.js'
