/**
 * PDF Rendering Service
 * Shared Puppeteer logic for rendering HTML to PDF
 */

import puppeteer from 'puppeteer'
import { existsSync } from 'fs'

/**
 * Resolve the Chromium executable path.
 * Uses PUPPETEER_EXECUTABLE_PATH if set and the file exists,
 * otherwise falls back to Puppeteer's bundled browser.
 */
function resolveExecutablePath(): string | undefined {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH
  if (envPath && existsSync(envPath)) {
    return envPath
  }
  return undefined
}

/**
 * Render HTML content to PDF using Puppeteer
 */
export async function renderHTMLToPDF(html: string): Promise<Buffer> {
  const executablePath = resolveExecutablePath()
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(executablePath && { executablePath })
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      }
    })

    return Buffer.from(pdfBuffer)
  } finally {
    await browser.close()
  }
}
