/**
 * Service workern cachar skalet, så att appen startar med dålig täckning.
 *
 * API-anrop är network-first med fallback till senaste svaret: en inställd träning får aldrig
 * ligga kvar som aktuell bara för att den finns i cachen, men en vecka ska gå att läsa i
 * tunnelbanan. Cachade svar märks i gränssnittet med tiden de hämtades — det arbetet är kvar.
 */
const SKAL = "sport-skal-v1";
const API = "sport-api-v1";

self.addEventListener("install", (händelse) => {
  händelse.waitUntil(
    caches.open(SKAL).then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/ikon.svg"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (händelse) => {
  händelse.waitUntil(
    caches.keys().then((nycklar) =>
      Promise.all(nycklar.filter((n) => n !== SKAL && n !== API).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (händelse) => {
  const begäran = händelse.request;
  if (begäran.method !== "GET") return;

  const url = new URL(begäran.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    händelse.respondWith(
      fetch(begäran)
        .then((svar) => {
          const kopia = svar.clone();
          caches.open(API).then((cache) => cache.put(begäran, kopia));
          return svar;
        })
        .catch(() => caches.match(begäran).then((träff) => träff ?? Response.error()))
    );
    return;
  }

  händelse.respondWith(
    caches.match(begäran).then(
      (träff) =>
        träff ??
        fetch(begäran).then((svar) => {
          if (svar.ok && svar.type === "basic") {
            const kopia = svar.clone();
            caches.open(SKAL).then((cache) => cache.put(begäran, kopia));
          }
          return svar;
        })
    )
  );
});
