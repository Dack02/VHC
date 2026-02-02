// VHC Web Push Service Worker

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'VHC', body: event.data.text() }
  }

  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon.ico',
    badge: payload.badge || '/favicon.ico',
    tag: payload.tag || 'vhc-notification',
    data: payload.data || {},
    requireInteraction: false
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'VHC', options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data || {}
  const urlPath = data.actionUrl || '/notifications'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing window
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            url: urlPath,
            notificationId: data.notificationId
          })
          return
        }
      }
      // No existing window — open a new one
      return clients.openWindow(urlPath)
    })
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe(event.oldSubscription.options)
      .then((newSubscription) => {
        // Re-register with the API
        return fetch('/api/v1/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: newSubscription.toJSON() })
        })
      })
  )
})
