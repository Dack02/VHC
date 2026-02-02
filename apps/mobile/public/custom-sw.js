// VHC Mobile Push Notification Service Worker Extension

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
    icon: payload.icon || '/pwa-192x192.png',
    badge: payload.badge || '/pwa-192x192.png',
    tag: payload.tag || 'vhc-notification',
    data: payload.data || {},
    requireInteraction: false
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'VHC', options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = event.notification.data || {}
  const urlPath = data.actionUrl || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
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
      return clients.openWindow(urlPath)
    })
  )
})
