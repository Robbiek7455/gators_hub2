const CACHE = 'gators-hub-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './players.json', './schedule.json', './opponents.json', './opponents_scout.json', './standings.json', './team.json'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=> c.addAll(ASSETS)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=> Promise.all(keys.filter(k=>k!==CACHE).map(k=> caches.delete(k)))));
});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if(url.origin === location.origin){
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r=> r || fetch(e.request)));
  } else {
    // network-first for cross-origin (SR/UF/AllOrigins)
    e.respondWith(fetch(e.request).catch(()=> caches.match(e.request)));
  }
});
