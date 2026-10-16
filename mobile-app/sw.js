const CACHE='monitor-mobile-1.17.18';
const FILES=['./','./index.html','./adapter.js','./config.js','./dashboard.js','./dashboard-fs-switch.js','./fs-switch.js','./icon.svg','./icon-192.png','./icon-512.png','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('monitor-mobile-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(new URL(event.request.url).origin!==self.location.origin||event.request.method!=='GET')return;event.respondWith(fetch(event.request,{cache:'no-cache'}).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;}).catch(()=>caches.match(event.request)));});
