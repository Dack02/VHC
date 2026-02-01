import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const LOGO = join(ROOT, 'ollosoftlogo.PNG')
const WEB_PUBLIC = join(ROOT, 'apps/web/public')
const MOBILE_PUBLIC = join(ROOT, 'apps/mobile/public')

async function generateFavicons() {
  console.log('Loading source logo...')

  // Get image metadata
  const metadata = await sharp(LOGO).metadata()
  const { width, height } = metadata
  console.log(`Source image: ${width}x${height}`)

  // Tight crop to just the laptop + hexagonal checkmark (no floating squares, no text)
  // These pixel coordinates are calibrated to the 1536x1024 source image
  const cropLeft = 155
  const cropTop = 395
  const cropWidth = 445
  const cropHeight = 248

  console.log(`Cropping to icon mark: ${cropLeft},${cropTop} ${cropWidth}x${cropHeight}`)

  const iconBuffer = await sharp(LOGO)
    .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
    .ensureAlpha()
    .png()
    .toBuffer()

  // Make it square with ~8% padding
  const iconMeta = await sharp(iconBuffer).metadata()
  const maxDim = Math.max(iconMeta.width, iconMeta.height)
  const padding = Math.round(maxDim * 0.08)

  const squareIcon = await sharp(iconBuffer)
    .resize(maxDim, maxDim, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    })
    .png()
    .toBuffer()

  // Ensure output directories exist
  await mkdir(WEB_PUBLIC, { recursive: true })
  await mkdir(MOBILE_PUBLIC, { recursive: true })

  // Generate PNG sizes
  const sizes = [
    { size: 16, name: 'favicon-16.png' },
    { size: 32, name: 'favicon-32.png' },
    { size: 180, name: 'apple-touch-icon.png', dest: MOBILE_PUBLIC },
    { size: 192, name: 'pwa-192x192.png', dest: MOBILE_PUBLIC },
    { size: 512, name: 'pwa-512x512.png', dest: MOBILE_PUBLIC },
  ]

  const generatedPngs = {}

  for (const { size, name, dest } of sizes) {
    const buf = await sharp(squareIcon)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer()

    generatedPngs[size] = buf

    if (dest) {
      const outPath = join(dest, name)
      await writeFile(outPath, buf)
      console.log(`  Generated: ${outPath}`)
    }
  }

  // Generate .ico files (32x32) for both web and mobile
  const icoBuffer = await pngToIco(generatedPngs[32])
  await writeFile(join(WEB_PUBLIC, 'favicon.ico'), icoBuffer)
  console.log(`  Generated: ${join(WEB_PUBLIC, 'favicon.ico')}`)
  await writeFile(join(MOBILE_PUBLIC, 'favicon.ico'), icoBuffer)
  console.log(`  Generated: ${join(MOBILE_PUBLIC, 'favicon.ico')}`)

  // Generate SVG favicon for web (embed the 512px PNG as base64 in SVG)
  const svg512 = await sharp(squareIcon)
    .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer()

  const base64 = svg512.toString('base64')
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <image width="512" height="512" href="data:image/png;base64,${base64}"/>
</svg>`

  await writeFile(join(WEB_PUBLIC, 'favicon.svg'), svgContent)
  console.log(`  Generated: ${join(WEB_PUBLIC, 'favicon.svg')}`)

  // Generate masked-icon.svg for mobile (same approach)
  await writeFile(join(MOBILE_PUBLIC, 'masked-icon.svg'), svgContent)
  console.log(`  Generated: ${join(MOBILE_PUBLIC, 'masked-icon.svg')}`)

  console.log('\nAll favicons generated successfully!')
}

generateFavicons().catch(err => {
  console.error('Error generating favicons:', err)
  process.exit(1)
})
