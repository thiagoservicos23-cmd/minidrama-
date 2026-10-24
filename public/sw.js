/* Service worker do Mini Drama: abre o site instantaneamente nas visitas seguintes e guarda
   imagens. NUNCA mexe em: API (/api/*, exceto imagens das novelinhas), vídeo, pagamentos. */
const VERSION = "md-v9";
const SHELL = "shell-" + VERSION, IMG = "img-" + VERSION, FONT = "font-" + VERSION;
const MAX_IMG = 160;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, IMG, FONT].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map((k) => c.delete(k)));
}
const cacheable = (res) => res && (res.ok || res.type === "opaque");

// Responde com o que já tem guardado e atualiza em segundo plano.
async function staleWhileRevalidate(req, cacheName, key) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key || req);
  const network = fetch(req).then((res) => { if (cacheable(res)) cache.put(key || req, res.clone()); return res; }).catch(() => null);
  return cached || (await network) || new Response("Sem conexão. Tente de novo em instantes.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function cacheFirst(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (cacheable(res)) { cache.put(req, res.clone()); if (max) trim(cacheName, max); }
    return res;
  } catch (e) {
    return new Response("", { status: 504 });
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;     // vídeo (Range) e qualquer não-GET passam direto
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/plays/") && url.pathname.includes("/image/")) return e.respondWith(cacheFirst(req, IMG, MAX_IMG));
    if (url.pathname.startsWith("/api/")) return;                    // dados e pagamentos: sempre direto na rede
    if (req.mode === "navigate") return e.respondWith(staleWhileRevalidate(req, SHELL, "/"));
    return e.respondWith(staleWhileRevalidate(req, SHELL));
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") return e.respondWith(staleWhileRevalidate(req, FONT));
  if (url.hostname === "images.unsplash.com") return e.respondWith(cacheFirst(req, IMG, MAX_IMG));
  // Bunny (vídeo), SyncPay etc.: não interceptamos.
});
