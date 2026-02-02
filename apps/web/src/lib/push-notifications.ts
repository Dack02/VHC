import { api } from './api'

const SW_PATH = '/sw.js'

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function getPushPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null

  try {
    const registration = await navigator.serviceWorker.register(SW_PATH)
    return registration
  } catch (err) {
    console.error('[Push] Service worker registration failed:', err)
    return null
  }
}

export async function subscribeToPush(token: string): Promise<boolean> {
  if (!isPushSupported()) return false

  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return false

    const registration = await navigator.serviceWorker.ready

    // Fetch the VAPID public key from the API
    const { publicKey } = await api<{ publicKey: string }>('/api/v1/push/vapid-public-key', {
      retry: false
    })

    const keyBytes = urlBase64ToUint8Array(publicKey)
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes.buffer as ArrayBuffer
    })

    const subJson = subscription.toJSON()

    await api('/api/v1/push/subscribe', {
      method: 'POST',
      token,
      body: {
        subscription: {
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys?.p256dh,
            auth: subJson.keys?.auth
          }
        },
        appType: 'web'
      }
    })

    return true
  } catch (err) {
    console.error('[Push] Subscribe failed:', err)
    return false
  }
}

export async function unsubscribeFromPush(token: string): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()

    if (subscription) {
      const endpoint = subscription.endpoint

      await subscription.unsubscribe()

      await api('/api/v1/push/unsubscribe', {
        method: 'POST',
        token,
        body: { endpoint }
      })
    }

    return true
  } catch (err) {
    console.error('[Push] Unsubscribe failed:', err)
    return false
  }
}

export async function hasActivePushSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    return !!subscription
  } catch {
    return false
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
