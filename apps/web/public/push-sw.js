/* Fase 18: Web Push for the PWA's service worker (imported by the Workbox-generated sw.js). Public: no data here. */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'TCG Pocket', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})

/*
 * Fase 41: share target (manifest `share_target`). Android's «Compartir» posts the tracker's CSV, a deck's text file
 * or a deck pasted as text here; it waits in the Cache Storage until the import screen picks it up (nothing leaves
 * the phone), and the app opens on that screen.
 */
const SHARE_CACHE = 'shared-files'

function isCsv(file) {
  return /\.csv$/i.test(file.name || '') || /csv/i.test(file.type || '')
}

/** `Response.redirect` takes no base URL: a bare path throws, so every destination is absolute. */
function here(path) {
  return new URL(path, self.location.origin).href
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || url.pathname !== '/compartir') return
  event.respondWith(
    (async () => {
      const form = await event.request.formData()
      const cache = await caches.open(SHARE_CACHE)
      const file = form.get('file')
      if (file && typeof file !== 'string' && file.size > 0 && isCsv(file)) {
        await cache.put(
          '/compartido/archivo',
          new Response(file, {
            headers: { 'content-type': file.type || 'text/csv', 'x-file-name': encodeURIComponent(file.name || 'compartido.csv') },
          }),
        )
        return Response.redirect(here('/coleccion/importar?compartido=1'), 303)
      }
      const parts = []
      if (file && typeof file !== 'string' && file.size > 0) parts.push(await file.text())
      for (const key of ['title', 'text', 'url']) {
        const value = form.get(key)
        if (typeof value === 'string' && value.trim()) parts.push(value.trim())
      }
      if (parts.length > 0) {
        await cache.put(
          '/compartido/texto',
          new Response(parts.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
        )
        return Response.redirect(here('/mazos/importar?compartido=1'), 303)
      }
      return Response.redirect(here('/partidas'), 303)
    })(),
  )
})
