/**
 * PDF Rendering Service
 * Uses puppeteer-core (no bundled browser, no env-var magic) with
 * system-installed Chromium from Nix packages on Railway.
 */

import puppeteer from 'puppeteer-core'
import { existsSync, readdirSync } from 'fs'
import { execSync } from 'child_process'
import { join } from 'path'

/**
 * Find the Nix-installed chromium binary by searching the Nix store.
 * Nixpacks installs packages via nix-env, which places binaries in
 * /nix/store/<hash>-chromium-<ver>/bin/chromium.
 */
function findNixChromium(): string | undefined {
  try {
    const nixStore = '/nix/store'
    if (!existsSync(nixStore)) return undefined
    const entries = readdirSync(nixStore)
    // Look for the chromium package directory (not a wrapper)
    for (const entry of entries) {
      if (entry.includes('chromium') && !entry.includes('wrapper')) {
        const binPath = join(nixStore, entry, 'bin', 'chromium')
        if (existsSync(binPath)) return binPath
      }
    }
  } catch {
    // Nix store not accessible
  }
  return undefined
}

/**
 * Resolve the Chromium executable path.
 * puppeteer-core requires an explicit path — it will not auto-detect.
 */
function resolveExecutablePath(): string {
  // 1. PUPPETEER_EXECUTABLE_PATH env var (if it actually exists on disk)
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH
  if (envPath && existsSync(envPath)) {
    console.log(`[PDF] Using chromium from env var: ${envPath}`)
    return envPath
  }

  // 2. Nix profile paths
  const profilePaths = [
    '/root/.nix-profile/bin/chromium',
    '/nix/var/nix/profiles/default/bin/chromium',
  ]
  for (const p of profilePaths) {
    if (existsSync(p)) {
      console.log(`[PDF] Using Nix profile chromium: ${p}`)
      return p
    }
  }

  // 3. Search the Nix store directly
  const nixPath = findNixChromium()
  if (nixPath) {
    console.log(`[PDF] Using Nix store chromium: ${nixPath}`)
    return nixPath
  }

  // 4. Common system paths (skip snap wrappers by testing --version)
  const systemPaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ]
  for (const p of systemPaths) {
    if (existsSync(p)) {
      try {
        execSync(`"${p}" --version`, { encoding: 'utf-8', timeout: 5000 })
        console.log(`[PDF] Using system chromium: ${p}`)
        return p
      } catch {
        console.warn(`[PDF] Skipping ${p} (snap wrapper or broken)`)
      }
    }
  }

  throw new Error(
    '[PDF] No Chromium binary found. Searched: env var, Nix profile, Nix store, system paths.'
  )
}

/**
 * Render HTML content to PDF using Puppeteer
 */
export async function renderHTMLToPDF(html: string): Promise<Buffer> {
  const executablePath = resolveExecutablePath()
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
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
