/* Service worker do Mini Drama: abre o site instantaneamente nas visitas seguintes e guarda
   imagens. NUNCA mexe em: API (/api/*, exceto imagens das novelinhas), vídeo, pagamentos. */
const VERSION = "md-v14";
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

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Imagens locais das novelinhas: guarda no cache de imagens (até MAX_IMG).
  if (url.origin === location.origin && url.pathname.startsWith("/api/plays/image/")) {
    e.respondWith(staleWhileRevalidate(e.request, IMG).then((r) => { trim(IMG, MAX_IMG); return r; }));
    return;
  }

  // Fontes do Google Fonts.
  if (url.origin.includes("fonts.gstatic.com") || url.origin.includes("fonts.googleapis.com")) {
    e.respondWith(staleWhileRevalidate(e.request, FONT));
    return;
  }

  // Demais chamadas à API, vídeos (.m3u8, .mp4), Plyr e tracking: sempre rede direta.
  if (url.pathname.startsWith("/api/") || url.pathname.includes(".m3u8") || url.pathname.includes(".mp4")) {
    return;
  }

  // Arquivos estáticos do app (shell).
  if (url.origin === location.origin && (url.pathname === "/" || url.pathname.endsWith(".html") || url.pathname.endsWith(".webmanifest") || url.pathname.startsWith("/icons/"))) {
    e.respondWith(staleWhileRevalidate(e.request, SHELL, url.pathname === "/" ? "/" : undefined));
  }
});
