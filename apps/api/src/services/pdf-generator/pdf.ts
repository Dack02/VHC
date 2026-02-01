/**
 * PDF Rendering Service
 * Shared Puppeteer logic for rendering HTML to PDF
 */

import puppeteer from 'puppeteer'
import { existsSync } from 'fs'
import { execSync } from 'child_process'

/**
 * Resolve the Chromium executable path.
 * Priority:
 *  1. PUPPETEER_EXECUTABLE_PATH env var (if set and file exists)
 *  2. System chromium found via `which` (covers Nix-installed binaries)
 *  3. Puppeteer's bundled browser (undefined triggers default)
 */
function resolveExecutablePath(): string | undefined {
  // Check explicit env var
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH
  if (envPath && existsSync(envPath)) {
    return envPath
  }

  // Find system chromium (works with Nix packages on Railway)
  try {
    const whichPath = execSync('which chromium', { encoding: 'utf-8' }).trim()
    if (whichPath && existsSync(whichPath)) {
      return whichPath
    }
  } catch {
    // chromium not in PATH
  }

  // Fall back to Puppeteer's bundled browser
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
