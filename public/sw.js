const CACHE = 'flota-v7'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => clients.claim())
))

self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // Supabase API — siempre red, nunca cache
  if (url.hostname.includes('supabase.co')) return

  // Navegación (HTML / index.html) — NETWORK-FIRST
  // Así siempre cargás la versión más nueva apenas hay conexión
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(req, copy))
        }
        return res
      }).catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
    )
    return
  }

  // Resto (JS/CSS hasheados, imágenes) — cache-first con revalidación en background
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then(c => c.put(req, copy))
        }
        return res
      }).catch(() => cached)
      return cached || net
    })
  )
})

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'Flota', body: 'Tenés turnos pendientes de cobro', tag: 'flota-reminder' }
  try { if (e.data) data = { ...data, ...e.data.json() } } catch (_) {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag,
      renotify: true,
      data: { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = e.notification.data?.url || '/'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const existing = cs.find(c => c.url.startsWith(self.registration.scope))
      if (existing) return existing.focus()
      return clients.openWindow(url)
    })
  )
})
