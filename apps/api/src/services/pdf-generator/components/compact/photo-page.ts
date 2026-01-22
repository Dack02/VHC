/**
 * Photo Evidence Page Component
 * Page 2 showing photos grouped by finding name
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

  return groups
}

/**
 * Check if there are any photos to display
 */
export function hasPhotos(repairItems: RepairItemData[], results: ResultData[]): boolean {
  return extractPhotoGroups(repairItems, results).length > 0
}

/**
 * Render a single photo group
 */
function renderPhotoGroup(group: PhotoGroup): string {
  const statusClass = group.status === 'red' ? 'red' : 'amber'

  return `
    <div class="photo-group">
      <div class="photo-group-header">
        <span class="photo-group-name">${group.findingName}</span>
        <span class="photo-status-badge ${statusClass}">${group.status === 'red' ? 'Urgent' : 'Advisory'}</span>
      </div>
      <div class="photo-grid">
        ${group.photos.slice(0, 4).map(photo => `
          <div>
            <img src="${photo.url}" alt="${group.findingName}" class="photo-thumb" />
            ${photo.caption ? `<div class="photo-caption">${photo.caption}</div>` : ''}
          </div>
        `).join('')}
        ${group.photos.length > 4 ? `
          <div style="display: flex; align-items: center; justify-content: center; width: 80px; height: 80px; background: #f3f4f6; color: #6b7280; font-size: 9px;">
            +${group.photos.length - 4} more
          </div>
        ` : ''}
      </div>
    </div>
  `
}

/**
 * Render the photo evidence page
 */
export function renderPhotoPage(options: PhotoPageOptions): string {
  const { repairItems, results, reference, registration, siteName } = options

  const photoGroups = extractPhotoGroups(repairItems, results)

  // Don't render anything if no photos
  if (photoGroups.length === 0) return ''

  return `
    <div class="photo-page">
      <!-- Mini Header -->
      <div class="photo-page-header">
        <div>
          <div class="photo-page-title">Photo Evidence</div>
          <div class="photo-page-ref">${registration} &bull; ${reference}</div>
        </div>
      </div>

      <!-- Photo Groups -->
      ${photoGroups.map(group => renderPhotoGroup(group)).join('')}

      <!-- Footer -->
      <div class="compact-footer" style="margin-top: 20px;">
        <div></div>
        <div class="footer-contact">${siteName || ''}</div>
        <div class="footer-page">Page 2 of 2</div>
      </div>
    </div>
  `
}
