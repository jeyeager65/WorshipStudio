// Exists purely to satisfy Android's installability requirement that a service worker be
// registered — this is a live control surface, not an offline-capable app, so it deliberately
// does no caching. A stale mirror of "what was live an hour ago" would be actively misleading,
// worse than the page just failing to load without a connection.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
