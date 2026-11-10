// תתבוס — service worker: שומר את האפליקציה כדי שתיפתח בלי אינטרנט
const CACHE = 'tatbus-v1'
self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest'])).catch(() => {}))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  )
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  if (req.mode === 'navigate') {
    // תמיד מנסה גרסה חדשה, ואם אין רשת — מהמטמון
    e.respondWith(
      fetch(req)
        .then((r) => {
          const cp = r.clone()
          caches.open(CACHE).then((c) => c.put('./index.html', cp))
          return r
        })
        .catch(() => caches.match('./index.html'))
    )
    return
  }
  e.respondWith(
    caches.match(req).then(
      (m) =>
        m ||
        fetch(req).then((r) => {
          if (r.ok) {
            const cp = r.clone()
            caches.open(CACHE).then((c) => c.put(req, cp))
          }
          return r
        })
    )
  )
})
