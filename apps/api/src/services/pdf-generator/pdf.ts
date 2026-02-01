/**
 * PDF Rendering Service
 * Shared Puppeteer logic for rendering HTML to PDF
 */

import puppeteer from 'puppeteer'
import { existsSync } from 'fs'
import { execSync } from 'child_process'

/**
 * Check if a chromium binary is a real executable (not a snap wrapper).
 * Ubuntu's apt chromium package is a stub that requires snap, which doesn't
 * work in containers.
 */
function isRealChromium(binPath: string): boolean {
  if (!existsSync(binPath)) return false
  try {
    // Snap wrappers fail with exit code 1 and print "requires the chromium snap"
    execSync(`"${binPath}" --version`, { encoding: 'utf-8', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the Chromium executable path.
 * Checks Nix profile paths first (where nixpacks installs packages),
 * then env var, then common system paths. Validates each candidate
 * is a real binary (not a snap wrapper). Clears PUPPETEER_EXECUTABLE_PATH
 * if broken to prevent Puppeteer's internal resolution from using it.
 */
function resolveExecutablePath(): string | undefined {
  // Clear broken env var early so Puppeteer never falls back to it
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH
  if (envPath && !existsSync(envPath)) {
    console.warn(`[PDF] PUPPETEER_EXECUTABLE_PATH=${envPath} does not exist, clearing`)
    delete process.env.PUPPETEER_EXECUTABLE_PATH
  }

  // Nix profile paths (where nixpacks/nix-env installs binaries) — check first
  const nixPaths = [
    '/root/.nix-profile/bin/chromium',
    '/nix/var/nix/profiles/default/bin/chromium',
  ]
  for (const p of nixPaths) {
    if (existsSync(p)) {
      console.log(`[PDF] Found Nix chromium at ${p}`)
      delete process.env.PUPPETEER_EXECUTABLE_PATH
      return p
    }
  }

  // Env var (if it still exists and points to a real binary)
  if (envPath && isRealChromium(envPath)) {
    return envPath
  }

  // Search PATH — but validate it's not a snap wrapper
  for (const name of ['chromium', 'chromium-browser', 'google-chrome-stable']) {
    try {
      const whichPath = execSync(`which ${name}`, { encoding: 'utf-8' }).trim()
      if (whichPath && isRealChromium(whichPath)) {
        delete process.env.PUPPETEER_EXECUTABLE_PATH
        return whichPath
      }
    } catch {
      // not in PATH
    }
  }

  // Nothing found — fall back to Puppeteer's bundled browser
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
