/**
 * PDF Rendering Service
 * Shared Puppeteer logic for rendering HTML to PDF
 */

import puppeteer from 'puppeteer'
import { existsSync } from 'fs'
import { execSync } from 'child_process'

/**
 * Resolve the Chromium executable path.
 * Checks env var, then searches common paths and PATH for chromium.
 * Also clears PUPPETEER_EXECUTABLE_PATH if it points to a missing binary,
 * preventing Puppeteer's internal resolution from using a broken path.
 */
function resolveExecutablePath(): string | undefined {
  // Check explicit env var
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH
  if (envPath && existsSync(envPath)) {
    return envPath
  }

  // Find system chromium via `which` (covers Nix-installed binaries)
  try {
    const whichPath = execSync('which chromium', { encoding: 'utf-8' }).trim()
    if (whichPath && existsSync(whichPath)) {
      // Clear the broken env var so Puppeteer doesn't use it internally
      delete process.env.PUPPETEER_EXECUTABLE_PATH
      return whichPath
    }
  } catch {
    // chromium not in PATH via `which`
  }

  // Try chromium-browser as alternative name
  try {
    const whichPath = execSync('which chromium-browser', { encoding: 'utf-8' }).trim()
    if (whichPath && existsSync(whichPath)) {
      delete process.env.PUPPETEER_EXECUTABLE_PATH
      return whichPath
    }
  } catch {
    // not found
  }

  // Check common installation paths
  const commonPaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ]
  for (const p of commonPaths) {
    if (existsSync(p)) {
      delete process.env.PUPPETEER_EXECUTABLE_PATH
      return p
    }
  }

  // Nothing found — clear broken env var so Puppeteer's internal
  // resolution doesn't try the non-existent path
  if (envPath) {
    console.warn(`[PDF] PUPPETEER_EXECUTABLE_PATH=${envPath} does not exist, clearing env var`)
    delete process.env.PUPPETEER_EXECUTABLE_PATH
  }

  return undefined
}

/**
 * Render HTML content to PDF using Puppeteer
 */
export async function renderHTMLToPDF(html: string): Promise<Buffer> {
  const executablePath = resolveExecutablePath()
  console.log(`[PDF] Using chromium at: ${executablePath ?? '(puppeteer bundled)'}`)
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
