import { useState, useEffect, useCallback } from 'react'
import { db } from '../lib/db'
import { api } from '../lib/api'
import { usePWA } from './usePWA'

// Stop re-sending a queued item (a result/status POST or a photo upload) that
// keeps being rejected by the server so a permanently-failing item (e.g. a
// 400/404) can't loop forever. The item is left in the queue (never deleted)
// to avoid silent data loss; it is simply no longer retried once the cap is
// reached.
const MAX_SYNC_RETRIES = 5

interface SyncStatus {
  isSyncing: boolean
  pendingCount: number
  lastSyncTime: Date | null
  error: string | null
}

export function useOfflineSync(token: string | undefined) {
  const { isOnline } = usePWA()
  const [status, setStatus] = useState<SyncStatus>({
    isSyncing: false,
    pendingCount: 0,
    lastSyncTime: null,
    error: null
  })

  // Check pending items count
  const checkPendingCount = useCallback(async () => {
    const queue = await db.getSyncQueue()
    const mediaQueue = await db.getQueuedMedia()
    setStatus((s) => ({
      ...s,
      pendingCount: queue.length + mediaQueue.length
    }))
  }, [])

  // Sync all pending items
  const sync = useCallback(async () => {
    if (!token || !isOnline || status.isSyncing) return

    setStatus((s) => ({ ...s, isSyncing: true, error: null }))

    try {
      // Process sync queue
      const queue = await db.getSyncQueue()

      for (const item of queue) {
        // Skip items that have exhausted their retries so a permanently-failing
        // item can't retry forever (matches the media-queue handling below).
        if (item.retries >= MAX_SYNC_RETRIES) {
          continue
        }

        try {
          if (item.type === 'result') {
            await api(`/api/v1/health-checks/${item.health_check_id}/results`, {
              method: 'POST',
              token,
              body: JSON.stringify(item.data)
            })
          } else if (item.type === 'status') {
            await api(`/api/v1/health-checks/${item.health_check_id}/status`, {
              method: 'POST',
              token,
              body: JSON.stringify(item.data)
            })
          }

          // Remove from queue on success
          if (item.id) {
            await db.removeSyncItem(item.id)
          }
        } catch (err) {
          console.error('Sync error for item:', item, err)
          // Increment retry count
          if (item.id) {
            await db.updateSyncItem(item.id, item.retries + 1)
          }
        }
      }

      // Process media queue
      const mediaQueue = await db.getQueuedMedia()

      for (const media of mediaQueue) {
        const retries = media.retries ?? 0

        // Skip items that have exhausted their retries. They stay in the
        // queue (the photo is never discarded) but are no longer uploaded,
        // so a permanently-failing item can't retry forever.
        if (retries >= MAX_SYNC_RETRIES) {
          continue
        }

        try {
          // Convert base64 to blob
          const response = await fetch(media.photo_data)
          const blob = await response.blob()

          const formData = new FormData()
          formData.append('file', blob, `photo_${Date.now()}.jpg`)

          const uploadResponse = await fetch(
            `${import.meta.env.VITE_API_URL}/api/v1/health-checks/${media.health_check_id}/results/${media.result_id}/media`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`
              },
              body: formData
            }
          )

          // fetch() only rejects on network errors, so a 4xx/5xx still
          // resolves here. Only drop the queued photo on a genuine 2xx —
          // otherwise a server-side rejection would silently delete a photo
          // that was never saved.
          if (!uploadResponse.ok) {
            throw new Error(`Media upload failed with status ${uploadResponse.status}`)
          }

          // Remove from queue on success
          await db.removeQueuedMedia(media.id)
        } catch (err) {
          console.error('Media sync error:', err)
          // Leave the photo queued and increment its retry count so it is
          // retried on a later sync (mirrors the sync-queue handling above).
          await db.updateQueuedMedia(media.id, retries + 1)
        }
      }

      setStatus((s) => ({
        ...s,
        isSyncing: false,
        lastSyncTime: new Date()
      }))

      await checkPendingCount()
    } catch (err) {
      setStatus((s) => ({
        ...s,
        isSyncing: false,
        error: err instanceof Error ? err.message : 'Sync failed'
      }))
    }
  }, [token, isOnline, status.isSyncing, checkPendingCount])

  // Auto-sync when coming online
  useEffect(() => {
    if (isOnline && !status.isSyncing) {
      checkPendingCount()

      // Delay sync slightly to ensure network is stable
      const timer = setTimeout(() => {
        sync()
      }, 2000)

      return () => clearTimeout(timer)
    }
  }, [isOnline])

  // Check pending count on mount
  useEffect(() => {
    checkPendingCount()
  }, [checkPendingCount])

  // Periodic sync when online
  useEffect(() => {
    if (!isOnline) return

    const interval = setInterval(() => {
      sync()
    }, 60000) // Sync every minute

    return () => clearInterval(interval)
  }, [isOnline, sync])

  return {
    ...status,
    sync,
    checkPendingCount
  }
}
