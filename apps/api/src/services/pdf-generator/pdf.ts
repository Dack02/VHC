/**
 * PDF Rendering Service
 * Uses puppeteer-core + @sparticuz/chromium for container-ready PDF generation.
 * @sparticuz/chromium bundles a pre-compiled Chromium binary as an npm package,
 * so no system-level Chromium installation is needed.
 */

import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

/**
 * Render HTML content to PDF using Puppeteer
 */
export async function renderHTMLToPDF(html: string): Promise<Buffer> {
  const executablePath = await chromium.executablePath()
  console.log(`[PDF] Using chromium at: ${executablePath}`)

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true,
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
