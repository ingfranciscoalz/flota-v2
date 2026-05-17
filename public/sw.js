const CACHE = 'flota-v5'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => clients.claim())
))

self.addEventListener('fetch', e => {
  // Supabase API — siempre red
  if (e.request.url.includes('supabase.co')) return

  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()))
        }
        return res
      }).catch(() => cached)
      return cached || net
    })
  )
})
