/* Service worker de spAIder — lo mínimo para que se pueda instalar como
 * aplicación.
 *
 * A propósito NO cachea nada: las pantallas se renderizan en el servidor y
 * dependen de la sesión, así que servir una copia guardada mostraría datos de
 * otro momento (o de otra cuenta). Todo va a la red; lo único que aporta este
 * fichero es hacer la app instalable y poder decir "sin conexión" con claridad.
 */

self.addEventListener("install", () => {
  // Activa esta versión sin esperar a que se cierren las pestañas abiertas.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Por si una versión anterior llegó a cachear algo.
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate" || request.method !== "GET") return;

  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch {
        return new Response(
          "<!doctype html><html lang=es><meta charset=utf-8>" +
            "<title>Sin conexión</title>" +
            "<style>body{font-family:system-ui,sans-serif;background:#F5F4EF;color:#111;" +
            "display:grid;place-items:center;height:100vh;margin:0;text-align:center}" +
            "p{max-width:32ch;line-height:1.5}</style>" +
            "<p>No hay conexión. spAIder necesita internet para trabajar; " +
            "vuelve a abrirlo cuando la recuperes.</p>",
          { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 },
        );
      }
    })(),
  );
});
