// ============================================================
// DFL Staff Portal — service worker
// ============================================================
// ONE job: make phones pick up a release straight away.
//
// GitHub Pages serves every file with `Cache-Control: max-age=600`, so for up
// to 10 minutes after a deploy a phone keeps running the old /shared/*.js and
// pages from its HTTP cache — and an installed home-screen app can hang on to
// them longer. Staff saw "What's new" announce product photos they couldn't
// see, and a new menu item that wasn't there, until they force-closed the app.
//
// So for the site's own app code (pages, .js, .json, .css, manifests) we ask
// the server every time with `cache: 'no-cache'`. That is a conditional
// request: when nothing changed GitHub answers 304 with no body, so it costs
// a round trip, not a download. Nothing has to be version-stamped or bumped.
//
// Left completely alone (no respondWith, the browser handles them as if this
// file didn't exist): anything cross-origin — Supabase data, auth and storage,
// CDNs, fonts — every non-GET request, and images/other static files such as
// /product-images/, which don't change between releases and should stay cached.
//
// Offline: every successful fetch of app code also saves a copy in Cache
// Storage (~1 MB in all), and when the network fails we serve that copy, so a
// merch app opened with no signal still loads the last version seen. The
// network always wins when it answers; there is no precache.
//
// Registered by /hub.html and by /shared/user-menu.js (both field apps).
// Changing this file: the browser re-checks sw.js on every navigation and
// swaps in a new version straight away (skipWaiting + clients.claim).
// ============================================================

const CACHE = 'dfl-portal-v2';   // offline copies of app code; other caches are cleared

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

const APP_CODE = /\.(html|js|json|css|webmanifest)$/i;

function isAppCode(req, url) {
  if (req.method !== 'GET' || url.origin !== self.location.origin) return false;
  if (req.mode === 'navigate') return true;
  return url.pathname.endsWith('/') || APP_CODE.test(url.pathname);
}

// Offline copies are keyed by path alone, so ?view=log or a cache-busting
// ?x=123 doesn't pile up duplicates of the same file.
function offlineKey(url) { return url.origin + url.pathname; }

async function fresh(e, url) {
  const req = e.request;
  // A navigation Request can't be re-issued with new options, so rebuild it
  // from the URL. Same for everything else, for one code path.
  const init = { cache: 'no-cache', credentials: 'same-origin', redirect: 'follow' };
  try {
    const res = await fetch(req.url, init);
    // A redirected response can't answer a navigation directly (its redirect
    // mode is 'manual'), so hand the browser the redirect instead.
    if (res.redirected && req.mode === 'navigate') return Response.redirect(res.url, 302);
    // Keep the latest good copy for when there's no signal (~1 MB in total).
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      e.waitUntil(caches.open(CACHE).then(c => c.put(offlineKey(url), copy)).catch(() => {}));
    }
    return res;
  } catch (err) {
    // Offline or network error: the last copy we saw.
    const match = await caches.match(offlineKey(url));
    if (match) return match;
    throw err;
  }
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (!isAppCode(e.request, url)) return;   // browser default
  e.respondWith(fresh(e, url));
});
