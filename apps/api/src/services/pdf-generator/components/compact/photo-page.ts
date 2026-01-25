/**
 * Photo Evidence Page Component
 * Page 2+ showing photos grouped by finding name
 * 3 columns, 150x150px photos, max 15 per page (5 rows)
 */

import type { RepairItemData, ResultData } from '../../types.js'

interface PhotoGroup {
  findingName: string
  status: 'red' | 'amber'
  photos: {
    url: string
    caption?: string
  }[]
}

interface PhotoPageOptions {
  repairItems: RepairItemData[]
  results: ResultData[]
  reference: string
  registration: string
  siteName?: string
}

// Max photos per page (5 rows x 3 columns)
const MAX_PHOTOS_PER_PAGE = 15

/**
 * Extract photo groups from repair items and results
 */
export function extractPhotoGroups(repairItems: RepairItemData[], results: ResultData[]): PhotoGroup[] {
  const groups: PhotoGroup[] = []

  // Create a map of result IDs to their media
  const resultMediaMap = new Map<string, ResultData>()
  results.forEach(r => {
    if (r.media && r.media.length > 0) {
      resultMediaMap.set(r.id, r)
    }
  })

  // Group photos by finding (repair item)
  for (const item of repairItems) {
    // For group items, collect photos from children
    if (item.is_group && item.children && item.children.length > 0) {
      const allPhotos: { url: string; caption?: string }[] = []

      for (const child of item.children) {
        if (child.check_result_id) {
          const result = resultMediaMap.get(child.check_result_id)
          if (result?.media && result.media.length > 0) {
            for (const m of result.media) {
              allPhotos.push({
                url: m.url,
                caption: m.type === 'video' ? 'Video' : undefined
              })
            }
          }
        }
      }

      if (allPhotos.length > 0) {
        groups.push({
          findingName: item.title,
          status: item.rag_status as 'red' | 'amber',
          photos: allPhotos
        })
      }
    } else {
      // Non-group items: use direct check_result_id
      const result = resultMediaMap.get(item.check_result_id)

      if (result?.media && result.media.length > 0) {
        groups.push({
          findingName: item.title,
          status: item.rag_status as 'red' | 'amber',
          photos: result.media.map(m => ({
            url: m.url,
            caption: m.type === 'video' ? 'Video' : undefined
          }))
        })
      }
    }
  }

  return groups
}

/**
 * Check if there are any photos to display
 */
export function hasPhotos(repairItems: RepairItemData[], results: ResultData[]): boolean {
  return extractPhotoGroups(repairItems, results).length > 0
}

/**
 * Count total photos across all groups
 */
export function countTotalPhotos(repairItems: RepairItemData[], results: ResultData[]): number {
  const groups = extractPhotoGroups(repairItems, results)
  return groups.reduce((total, group) => total + group.photos.length, 0)
}

/**
 * Calculate total number of photo pages needed
 */
export function countPhotoPages(repairItems: RepairItemData[], results: ResultData[]): number {
  const totalPhotos = countTotalPhotos(repairItems, results)
  if (totalPhotos === 0) return 0
  return Math.ceil(totalPhotos / MAX_PHOTOS_PER_PAGE)
}

/**
 * Flatten all photos into a single array with finding context
 */
interface FlatPhoto {
  url: string
  caption?: string
  findingName: string
  status: 'red' | 'amber'
}

function flattenPhotos(groups: PhotoGroup[]): FlatPhoto[] {
  const photos: FlatPhoto[] = []
  for (const group of groups) {
    for (const photo of group.photos) {
      photos.push({
        url: photo.url,
        caption: photo.caption,
        findingName: group.findingName,
        status: group.status
      })
    }
  }
  return photos
}

/**
 * Render a single photo item
 */
function renderPhotoItem(photo: FlatPhoto): string {
  return `
    <div class="photo-item">
      <img src="${photo.url}" alt="${photo.findingName}" class="photo-thumb" />
      <div class="photo-caption">${photo.findingName}</div>
    </div>
  `
}

/**
 * Render a single photo page
 */
function renderSinglePhotoPage(
  photos: FlatPhoto[],
  pageNumber: number,
  totalPages: number,
  reference: string,
  registration: string,
  siteName?: string
): string {
  return `
    <div class="photo-page">
      <!-- Mini Header -->
      <div class="photo-page-header">
        <div>
          <div class="photo-page-title">Photo Evidence</div>
          <div class="photo-page-ref">${registration} &bull; ${reference}</div>
        </div>
      </div>

      <!-- Photo Grid -->
      <div class="photo-grid">
        ${photos.map(photo => renderPhotoItem(photo)).join('')}
      </div>

      <!-- Footer -->
      <div class="compact-footer" style="margin-top: 20px;">
        <div></div>
        <div class="footer-contact">${siteName || ''}</div>
        <div class="footer-page">Page ${pageNumber} of ${totalPages}</div>
      </div>
    </div>
  `
}

/**
 * Render all photo evidence pages (may be multiple if >15 photos)
 */
export function renderPhotoPage(options: PhotoPageOptions): string {
  const { repairItems, results, reference, registration, siteName } = options

  const photoGroups = extractPhotoGroups(repairItems, results)

  // Don't render anything if no photos
  if (photoGroups.length === 0) return ''

  // Flatten all photos
  const allPhotos = flattenPhotos(photoGroups)

  // Calculate total pages (page 1 is main report, photo pages start at 2)
  const numPhotoPages = Math.ceil(allPhotos.length / MAX_PHOTOS_PER_PAGE)
  const totalPages = 1 + numPhotoPages // 1 for main report + photo pages

  // Generate all photo pages
  const pages: string[] = []

  for (let i = 0; i < numPhotoPages; i++) {
    const startIdx = i * MAX_PHOTOS_PER_PAGE
    const endIdx = Math.min(startIdx + MAX_PHOTOS_PER_PAGE, allPhotos.length)
    const pagePhotos = allPhotos.slice(startIdx, endIdx)
    const pageNumber = 2 + i // Photo pages start at page 2

    pages.push(renderSinglePhotoPage(
      pagePhotos,
      pageNumber,
      totalPages,
      reference,
      registration,
      siteName
    ))
  }

  return pages.join('\n')
}
