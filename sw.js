// Service worker: zorgt dat ART ook zonder internet opstart.
// Eerst het netwerk proberen (dan krijg je altijd de nieuwste versie), anders de opgeslagen kopie.
const CACHE = "art-v20";
const BESTANDEN = [
  "./", "./index.html", "./style.css", "./manifest.webmanifest",
  "./js/main.js", "./js/landen.js", "./js/matrix.js", "./js/editor.js", "./js/afdrukvel.js", "./js/cameramap.js",
  "./js/gezicht.js", "./js/mediapipe.js", "./js/kwaliteit.js", "./js/uitknippen.js", "./js/db.js",
  "./js/achtergronden.js", "./js/bibliotheek.js", "./js/studio.js", "./js/config.js", "./js/wolk.js", "./js/wachtrij.js", "./js/bewerker.js", "./js/uitsnede.js", "./js/hulp.js",
  "./vendor/supabase/supabase.js",
  "./vendor/mediapipe/vision_bundle.mjs", "./vendor/mediapipe/face_landmarker.task", "./vendor/mediapipe/selfie_multiclass_256x256.tflite",
  "./vendor/mediapipe/wasm/vision_wasm_internal.js", "./vendor/mediapipe/wasm/vision_wasm_internal.wasm",
  "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BESTANDEN)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (new URL(req.url).pathname.startsWith("/testfoto/")) return;
  e.respondWith(
    fetch(req)
      .then((antw) => {
        if (antw.ok) { const kopie = antw.clone(); caches.open(CACHE).then((c) => c.put(req, kopie)); }
        return antw;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("./index.html") : undefined)))
  );
});
