/**
 * Approval Confirmation PDF Styles
 * Styles specific to the customer approval confirmation PDF
 */

export function getApprovalConfirmationStyles(primaryColor: string): string {
  return `
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 11px;
      line-height: 1.5;
      color: #1f2937;
      background: #ffffff;
      padding: 20mm;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid ${primaryColor};
    }

    .logo {
      max-height: 48px;
      max-width: 180px;
    }

    .title-section {
      text-align: right;
    }

    .title {
      font-size: 20px;
      font-weight: 700;
      color: ${primaryColor};
      margin-bottom: 4px;
    }

    .subtitle {
      font-size: 12px;
      color: #6b7280;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-bottom: 24px;
    }

    .info-box {
      background: #f9fafb;
      border-radius: 6px;
      padding: 16px;
    }

    .info-label {
      font-size: 10px;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 4px;
    }

    .info-value {
      font-size: 13px;
      font-weight: 600;
      color: #1f2937;
    }

    .section {
      margin-bottom: 20px;
    }

    .section-header {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
      padding: 10px 12px;
      border-radius: 4px;
      margin-bottom: 12px;
    }

    .section-header.approved {
      background: #dcfce7;
      color: #166534;
    }

    .section-header.declined {
      background: #fef2f2;
      color: #991b1b;
    }

    .item-list {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      overflow: hidden;
    }

    .item {
      padding: 12px;
      border-bottom: 1px solid #e5e7eb;
    }

    .item:last-child {
      border-bottom: none;
    }

    .item-name {
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 2px;
    }

    .item-option {
      font-size: 10px;
      color: #6b7280;
    }

    .item-price {
      font-weight: 600;
      color: ${primaryColor};
      text-align: right;
    }

    .item-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .item-reason {
      font-size: 10px;
      color: #dc2626;
      margin-top: 4px;
    }

    .total-box {
      background: ${primaryColor};
      color: white;
      padding: 16px;
      border-radius: 6px;
      margin-top: 20px;
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .total-label {
      font-size: 14px;
      font-weight: 500;
    }

    .total-value {
      font-size: 20px;
      font-weight: 700;
    }

    .confirmation-text {
      margin-top: 24px;
      padding: 16px;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      font-size: 12px;
      color: #166534;
    }

    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 10px;
      color: #9ca3af;
    }
  `
}
